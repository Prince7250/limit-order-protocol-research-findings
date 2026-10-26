# Repository inventory

## Scope and classification

This inventory is for commit `50bd1300315606a3d32e9021898374c9d0dc2335`. It excludes dependency trees and transient/generated Hardhat directories (`node_modules/`, `artifacts/`, `cache/`, coverage output), which are ignored by Git. Deployment JSON files are generated deployment records: they are retained as deployment evidence but are not source code.

Status vocabulary: **reviewed** means source was read for this checkpoint; **indexed** means it was classified but does not warrant independent behavioral analysis (generated or prose).

## Root, configuration, and automation

| Paths | Kind / purpose | Status / security relevance |
|---|---|---|
| `AGENTS.md` | Repository operating instructions | reviewed; directs non-parallel CI test command |
| `README.md`, `description.md`, `dev.md`, `native-swap.md`, `CONTRIBUTING.md`, `LICENSE.md` | Documentation / operational guidance | reviewed; `README.md` is the authoritative warning that `master` is unaudited. `native-swap.md` has stale implementation details; see security review. |
| `package.json`, `yarn.lock` | Node dependency graph and commands | reviewed / indexed; lockfile is the reproducibility record. |
| `hardhat.config.js` | Hardhat compiler, network, docgen, test-plugin configuration | reviewed; Solidity `0.8.30`, optimizer runs `1,000,000`, `viaIR`, Cancun unless network overrides. |
| `Makefile`, `config/constants.js`, `config/constants.json` | Deployment automation and per-chain addresses/salts | reviewed; deployment configuration is a trust boundary. |
| `.github/workflows/test.yml`, `.github/workflows/publish.yml`, `.github/actions/setup/action.yml` | CI / release automation | reviewed; CI uses Node 22 and `yarn test:ci`; publish uses OIDC. |
| `.solhint.json`, `.eslintrc`, `.gitignore` | Static-analysis and workspace policy | reviewed. |

## Production Solidity: main protocol and utilities

| File | Main exports / callers | Purpose and relevance | Status |
|---|---|---|---|
| `contracts/LimitOrderProtocol.sol` | `LimitOrderProtocol` | Concrete owner-controlled, pausable EIP-712 entry contract. | reviewed |
| `contracts/OrderMixin.sol` | `OrderMixin` | Fill/cancel/state-machine implementation; most security-critical file. | reviewed |
| `contracts/OrderLib.sol` | `OrderLib` | EIP-712 order hashing, extension validation, dynamic amount dispatch. | reviewed |
| `contracts/utils/EIP712Alien.sol` | `EIP712Alien` | EIP-712 implementation with a caller-selected verifying-contract address, used by native-order helpers. | reviewed |

## Libraries

| File | Export | Role | Status |
|---|---|---|---|
| `contracts/libraries/AmountCalculatorLib.sol` | linear amount math | Floor maker-side / ceil taker-side proportional pricing. | reviewed |
| `contracts/libraries/BitInvalidatorLib.sol` | bitmap invalidator | Single-fill/mass cancellation state. | reviewed |
| `contracts/libraries/Errors.sol` | ETH errors | Shared native-currency reverts. | reviewed |
| `contracts/libraries/ExtensionLib.sol` | extension decoder | Parses packed offsets and extension fields. | reviewed |
| `contracts/libraries/MakerTraitsLib.sol` | maker-trait decoder | Flags, expiry, sender restriction, nonce/epoch/series. | reviewed |
| `contracts/libraries/OffsetsLib.sol` | offset slicer | Bounds checks packed extension segments. | reviewed |
| `contracts/libraries/RemainingInvalidatorLib.sol` | remaining invalidator | Multiple-fill accounting encoded as bitwise complement. | reviewed |
| `contracts/libraries/TakerTraitsLib.sol` | taker-trait decoder | Amount mode, limits, permits, target and arg lengths. | reviewed |

## Interfaces

| File | Export | Purpose | Status |
|---|---|---|---|
| `contracts/interfaces/IAmountGetter.sol` | `IAmountGetter` | Dynamic maker/taker amount API. | reviewed |
| `contracts/interfaces/ICreate3Deployer.sol` | `ICreate3Deployer` | Factory deployment integration. | reviewed |
| `contracts/interfaces/IOrderMixin.sol` | `IOrderMixin` | Core order struct, errors, events, and public fill/cancel API. | reviewed |
| `contracts/interfaces/IOrderRegistrator.sol` | `IOrderRegistrator` | Signed-order announcement API. | reviewed |
| `contracts/interfaces/IPermit2TransferFrom.sol` | `IPermit2TransferFrom` | Narrow Permit2 SignatureTransfer interface. | reviewed |
| `contracts/interfaces/IPermit2WitnessTransferFrom.sol` | `IPermit2WitnessTransferFrom` | Narrow Permit2 witness-transfer interface. | reviewed |
| `contracts/interfaces/IPostInteraction.sol`, `IPreInteraction.sol`, `ITakerInteraction.sol` | callback interfaces | Signed extension callback ABI. | reviewed |

## Helpers and extensions

| Files | Primary responsibility | Status |
|---|---|---|
| `contracts/helpers/PredicateHelper.sol` | Composable static-call predicates. | reviewed |
| `contracts/helpers/SeriesEpochManager.sol` | Per-maker series/epoch cancellation state inherited by LOP. | reviewed |
| `contracts/helpers/SeriesNonceManager.sol` | Standalone nonce/timestamp predicate helper. | reviewed |
| `contracts/helpers/OrderRegistrator.sol` | Validates and announces a signed order once. | reviewed |
| `contracts/helpers/SafeOrderBuilder.sol` | Safe-specific presigning helper with oracle-adjusted terms. | reviewed |
| `contracts/extensions/AmountGetterBase.sol`, `AmountGetterWithFee.sol` | Base dynamic pricing plus fee-aware pricing. | reviewed |
| `contracts/extensions/ApprovalPreInteraction.sol` | EIP-1271 maker wrapper that grants per-fill approval. | reviewed |
| `contracts/extensions/ChainlinkCalculator.sol`, `DutchAuctionCalculator.sol`, `RangeAmountCalculator.sol` | Oracle-, time-, and range-based amount getters. | reviewed |
| `contracts/extensions/ERC1155Proxy.sol`, `ERC721Proxy.sol`, `ERC721ProxySafe.sol` | Selector-compatible non-ERC20 transfer proxies. | reviewed |
| `contracts/extensions/FeeTaker.sol` | Fee receiver, distributor, and fee-aware amount getter. | reviewed |
| `contracts/extensions/ImmutableOwner.sol` | Immutable access-control base for proxies. | reviewed |
| `contracts/extensions/NativeOrderFactory.sol`, `NativeOrderImpl.sol` | Native-asset WETH escrow via deterministic EIP-1167 clones. | reviewed |
| `contracts/extensions/OrderIdInvalidator.sol` | Maker/order-ID exclusivity pre-interaction. | reviewed |
| `contracts/extensions/Permit2Proxy.sol`, `Permit2WitnessProxy.sol` | Selector-compatible Permit2 transfers. | reviewed |
| `contracts/extensions/PrioirityFeeLimiter.sol` | Predicate for EIP-1559 priority fee policy (filename typo is source reality). | reviewed |

## Test-only Solidity

| Files | Purpose | Status |
|---|---|---|
| `contracts/mocks/AggregatorMock.sol`, `ArbitraryPredicateMock.sol`, `CallsSimulator.sol` | Oracle/predicate/simulation doubles. | reviewed |
| `contracts/mocks/CompatibilityFallbackHandler.sol` | Adapted Gnosis Safe fallback handler for test compilation. | reviewed |
| `contracts/mocks/ExtensionMock.sol`, `HashChecker.sol`, `InteractionMock.sol` | Extension decoding and callback/interaction test fixtures. | reviewed |
| `contracts/mocks/MakerContract.sol`, `RecursiveMatcher.sol`, `TakerContract.sol` | Contract-maker and recursive-fill adversarial/composability fixtures. | reviewed |
| `contracts/mocks/WrappedTokenMock.sol` | Test WETH/ERC-2612 implementation. | reviewed |

## JavaScript deployment and test code

| Paths | Purpose | Status |
|---|---|---|
| `deploy/deploy.js`, `deploy/deploy-helpers.js`, `deploy/deploy-fee-taker.js`, `deploy/deploy-native-order-factory.js`, `deploy/deploy-Permit2Proxy.js`, `deploy/deploy-Permit2WitnessProxy.js` | Hardhat-deploy scripts. All default to `skip = true`; scripts are sensitive to configured chain addresses and salts. | reviewed |
| `test/helpers/eip712.js`, `fixtures.js`, `nonce.js`, `orderUtils.js`, `utils.js` | Fixture deployment, traits/extension/signature construction, tracing helpers. | reviewed |
| `test/LimitOrderProtocol.js` | Primary protocol suite: signatures, thresholds, cancellation, permit(s), native orders, predicates, ETH, pause. | reviewed |
| `test/Interactions.js`, `Extensions.js`, `Eip712.js`, `MakerContract.js` | Callback, extension, EIP-712 and EIP-1271 behavior. | reviewed |
| `test/ApprovalPreInteractionExample.js`, `ChainLinkExample.js`, `DutchAuctionCalculator.js`, `FeeTaker.js`, `Permit2Proxy.js`, `WitnessProxyExample.js` | Extension and Permit2 examples/coverage. | reviewed |
| `test/PriorityFeeLimiter.js`, `RangeAmountCalculator.js`, `RangeLimitOrders.js`, `SafeOrderBuilder.js`, `SeriesEpochManager.js`, `MeasureGas.js`, `test/examples/LimitOrderProtocol-example.js` | Specialized calculator/helper, gas, and educational tests. | reviewed |

## Generated/deployment records and generated documentation

`deployments/<network>/*.json` and optional `.chainId` files are hardhat-deploy manifests for the networks present in the checkout: `arbitrum`, `aurora`, `avax`, `base`, `bsc`, `fantom`, `klaytn`, `kovan`, `linea`, `mainnet`, `matic`, `optimistic`, `sonic`, `unichain`, `xdai`, and `zksync`. They contain addresses, ABIs, receipts, and bytecode metadata. They are **not proof** that every current source file is deployed or audited. In particular, there is no checked-in `Permit2WitnessProxy` deployment record.

`docs/**/*.md` is Solidity-docgen output for source interfaces/contracts. It is useful as an index but does not replace source review; `native-swap.md` is manually written and has drifted from the current code.

## Per-file notes index

The detailed notes live below `analysis/files/`, preserving the source path in the filename. See `analysis/00-master-handbook.md` for the reading order and `analysis/PROGRESS.md` for evidence limitations.
