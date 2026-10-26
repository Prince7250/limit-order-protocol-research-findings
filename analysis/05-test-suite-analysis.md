# Test-suite analysis

## Test harness

The project uses Hardhat 2.23, ethers v6, Chai, hardhat-deploy, hardhat-tracer, and gas reporter. `hardhat.config.js` compiles dependency mocks for token and Safe testing. `test/helpers/fixtures.js` deploys a local LOP, ERC-20 test tokens, WETH mock, custom-decimals token, and selected helper contracts. `test/helpers/orderUtils.js` constructs traits, packed extensions, typed-data order signatures, and encoded fill arguments.

The project instructions require `yarn test:ci`, not parallel `yarn test`, because two tracer-dependent WIP tests fail under parallel execution. CI invokes `yarn lint`, `yarn test:ci`, and coverage in three jobs (`.github/workflows/test.yml`).

## Commands actually attempted

| Command | Exit | Evidence |
|---|---:|---|
| `yarn test:ci` | 1 | PowerShell reported `yarn` is not recognized; test runner never launched. |
| environment check | n/a | Node/npm/npx/corepack are installed, but `node_modules` is absent. |

No test is reported as passed or failed in this analysis. Installing dependencies was intentionally not performed, so no lockfile or local setup state was changed.

## Coverage by file

| Test file(s) | Behaviors covered |
|---|---|
| `test/LimitOrderProtocol.js` | Signatures, threshold directions, rounding, zeros, WETH unwrapping, ERC-721 proxy, trait rules, ERC-2612/Permit2, dynamic calculators, native-order lifecycle, remaining and bitmap invalidation, epoch changes, private orders, predicates, extension validation, expiry, ETH payment, and pause. It is the principal behavioral suite. |
| `test/Interactions.js` | Recursive matchers, order-hash checking, `OrderIdInvalidator`, and multi-fill callback behavior. |
| `test/Eip712.js`, `test/helpers/eip712.js` | Domain separator and ERC-2612 typed permit construction. |
| `test/Extensions.js`, `test/examples/LimitOrderProtocol-example.js` | Custom extension-data parsing and basic/predicate/interaction/ERC-721/getter examples. |
| `test/ApprovalPreInteractionExample.js`, `test/MakerContract.js` | Contract maker / EIP-1271-style preapproval paths. |
| `test/ChainLinkExample.js`, `test/DutchAuctionCalculator.js`, `test/RangeAmountCalculator.js`, `test/RangeLimitOrders.js` | Dynamic-pricing implementation examples and partial fills. |
| `test/FeeTaker.js` | Zero fee, whitelisted/non-whitelisted fee, custom receiver, ERC-20 and ETH fee distribution. |
| `test/OrderRegistrator.js`, `test/SafeOrderBuilder.js` | Order announcement, duplicate prevention, relayed registration, Safe presigning and MultiSend. |
| `test/Permit2Proxy.js`, `test/WitnessProxyExample.js` | Basic Permit2 signature-transfer and witness proxy examples. |
| `test/PriorityFeeLimiter.js`, `test/SeriesEpochManager.js`, `test/MeasureGas.js` | Helper boundary examples and gas snapshots. |

## Mocks and what they prove

`WrappedTokenMock` supports WETH-like deposit/withdraw and EIP-2612 permits; `AggregatorMock` gives a fresh fixed Chainlink price. `MakerContract`, `TakerContract`, `InteractionMock`, `RecursiveMatcher`, `HashChecker`, and `OrderIdInvalidator` exercise EIP-1271/callback/recursive behavior. They model selected adversarial cases but do not simulate fee-on-transfer, rebasing, return-false/no-return, reentrant ERC-20, hostile ETH fallback, malformed EIP-1271, or malformed extension-offset contracts comprehensively.

## Gap matrix

| Component | Existing tests | Missing cases | Security importance | Suggested test |
|---|---|---|---|---|
| `OrderMixin` arg parsing | normal encoded args and extension mismatch | fuzz all 24-bit lengths, truncated target, overlapping/trailing args | High | Foundry/Hardhat property test asserting no state update on every parser failure. |
| `ExtensionLib` / `OffsetsLib` | custom-data happy paths | non-monotonic offsets, each boundary at `0`, `length`, `length+1`, max values | High | Fuzz `extension` and assert either correct slice or custom error, never an unintended call. |
| Fill reentrancy | recursive matcher behavior | malicious first-fill permit token; pre/taker/post callback reentering the same order in both invalidator modes | High | Add malicious token/callback tests that attempt nested fills/cancellations and check exact balances/state. |
| Token transfer semantics | standard OpenZeppelin tokens, WETH, proxies | fee-on-transfer/rebasing/false-return/no-return/reentrant ERC-20 | High integration | Document unsupported semantics; add regression fixtures for expected safe failure behavior. |
| EIP-1271 | maker contract/Safe examples | bad magic values, reverts, short signatures, stateful validation, native clone malformed signature bytes | High | Fuzz contract signatures and assert no state changes on invalid response. |
| Math | selected rounding examples | fuzz large amounts near `uint256` boundaries and price ratios | High | Invariants: successful fill never exceeds remaining; threshold inequalities hold. |
| Permit2 proxies | EVM happy-path examples | replay/partial behavior, wrong Permit2 target, zkSync constructor/deployment path | High for new helpers | Integration test parametrized with EVM and zkSync Permit2 addresses; reject wrong target at construction. |
| Native orders | broad happy/failure lifecycle | resolver reward larger than clone balance; reentrant maker/resolver recipient; clone signature truncation | High for new code | Unit plus invariant tests around cancellation and clone address binding. |
| `FeeTaker` | fee/receiver/ETH cases | malformed fee payload lengths, ERC-20 accounting mismatch, reentrant fee recipient | Medium | Boundary/fuzz tests; assert fee recipients cannot affect LOP state. |
| Deployment scripts | no direct suite found | wrong-chain guard for `deploy-Permit2Proxy.js`; missing constants; zkSync witnesses | Medium | Stub HRE config and assert every script either deploys correct constructor args or exits. |
| Pause | basic pause/owner checks | cancellation and read APIs during pause explicitly asserted | Low | Document desired semantics and test them. |

## Recommended verification order once dependencies are available

1. `yarn hardhat compile`
2. `yarn test:ci`
3. targeted tests for Permit2 and native orders
4. `yarn coverage`
5. a fuzz/invariant suite for calldata parser, fill accounting, and callbacks

The first two are correctness gates. Passing them would not replace chain-specific bytecode/constructor verification or a review of external dependencies.
