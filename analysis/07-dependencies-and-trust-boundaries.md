# Dependencies and trust boundaries

## Declared dependencies

`package.json` pins exact package versions rather than version ranges. `yarn.lock` resolves their transitive graph; it was not expanded line-by-line because it is generated dependency metadata.

| Dependency | Version | Role in this repository | Inspection boundary |
|---|---:|---|---|
| `@1inch/solidity-utils` | 6.9.4 | `ECDSA`, `AddressLib`, SafeERC20/UniERC20, WETH and Permit-and-call mixins, Hardhat setup/deployment utilities. | Imports and called APIs reviewed; library implementation not audited here. |
| `@openzeppelin/contracts` | 5.1.0 | EIP-712, ECDSA-adjacent types, ERC-20/721/1155 interfaces, Ownable, Pausable, Math, Clones. | Imported APIs reviewed; OpenZeppelin source not independently audited. |
| `@chainlink/contracts` | 0.8.0 | Oracle interface consumed by `ChainlinkCalculator` and Safe builder. | Interface assumptions reviewed; feeds are external trust sources. |
| `@gnosis.pm/safe-contracts` | 1.3.0 | Safe storage/contract/multisend test and builder support. | Interface/inheritance use reviewed; Safe code not audited. |
| `@uniswap/permit2-sdk` | 1.3.0 (dev) | Chain-dependent Permit2 deployment address and typed permit construction in tests/scripts. | SDK address selection is a deployment trust boundary. |
| `hardhat`, `hardhat-deploy`, ethers, chai, matcher/tracer/coverage/docgen tooling | exact dev versions | Compilation, deployment, testing, tracing, documentation. | Tooling only; not protocol runtime. |

The project adds Yarn resolutions for `elliptic`, `form-data`, and `handlebars`, which is a positive reproducibility/hygiene control. The lockfile plus exact package declarations provides a repeatable dependency set once Yarn is installed.

## Compiler and build trust

`hardhat.config.js` selects Solidity `0.8.30`, optimizer enabled with `runs: 1_000_000`, `viaIR: true`, and Cancun by default (or configured per-network hardfork). This combination materially affects bytecode, optimizer behavior, and gas; a deployed instance must be compared against compilation with exactly these settings. The broad pragma range in many library/interface files is not itself the compile target because Hardhat compiles them under this top-level configuration.

`hardhat-dependency-compiler` pulls in token mocks and Gnosis dependencies during test compilation. Those contracts are test inputs, not deployed LOP runtime components.

## On-chain trust boundaries

| Boundary | Why it matters | Control / residual risk |
|---|---|---|
| Maker signature / EIP-1271 wallet | Authorizes exact order and extension. | Domain includes chain/LOP; contract wallets define their own signature semantics. |
| Maker-signed extension | Chooses arbitrary predicate/getter/callback/proxy code. | Hash commitment prevents substitution; maker can still choose faulty/malicious code. |
| ERC-20 / ERC-721 / ERC-1155 / WETH | Asset transfer and callback behavior. | Atomic calls and return-value checks; balance-delta/fee/rebase behavior is not normalized. |
| Permit2 | Grants signature-authorized token transfer. | Nonces/deadlines are Permit2's responsibility; target address must be chain-correct. |
| Chainlink feed | Dynamic pricing/freshness. | Code rejects `updatedAt` older than four hours and negative answers via `toUint256`; it does not validate every feed-specific condition. |
| Safe | Order presigning and Safe builder. | Safe owners/modules/fallback handler are independent authority. |
| LOP owner | May pause/unpause filling. | Governance/key-management trust; no LOP upgrade mechanism is present. |
| FeeTaker owner | Can rescue funds held in FeeTaker. | Fees intentionally route through it only when its address is order receiver. |
| NativeOrderFactory owner | Can rescue funds held by factory. | Active escrow is expected in clones, not factory; constructor/deployment still matters. |
| Deployment configs | Router, WETH, Permit2, access token, Create3, and salts per chain. | Wrong address creates chain-specific failure or worse; source review cannot validate config truth. |

## Deployment and release boundary

The repository documentation names tag `4.3.2` as audited. The current checkout is 56 commits after `4.3.4` and contains additions including NativeOrderFactory/NativeOrderImpl and Permit2Proxy. A deployment manifest means a past hardhat-deploy run recorded data; it does not establish that the current source produced that bytecode, that constructor arguments are correct, or that an audit covered it.

For an authorized deployment review, verify: git commit/tag; solc compiler settings; deployed runtime bytecode; constructor immutables; LOP/WETH/Permit2/access-token addresses; Create3 deployer and salt; chain ID; and ownership. Do this independently for every chain.
