# Research Status & Codebase Coverage Tracker

## 1. Executive Summary

| Property | Value |
| :--- | :--- |
| **Research Workspace** | `D:\limit-order-protocol-research-findings` |
| **Research Fork** | [`https://github.com/Prince7250/limit-order-protocol-research-findings`](https://github.com/Prince7250/limit-order-protocol-research-findings) |
| **Official Upstream** | [`https://github.com/1inch/limit-order-protocol`](https://github.com/1inch/limit-order-protocol) |
| **Bounty Target Scope** | Tag `4.3.4` (Commit `0a40e01befff19d925457b55191900fb456c2dd2`) |
| **Local Working Branch** | `main` (clean, synchronized with `origin/main`) |
| **Researchers** | Prince (Lead / Settlement & Proxies), Satyam (Helpers, Predicates & Safe Integrations) |

---

## 2. Research Team Status & Attribution

- **Prince:** Documented and verified lead author of analysis documentation suite (`00` to `08`, `PROGRESS.md`), six custom regression test suites (73 unit tests), and deployment verification scripts. Currently leading H-09 (Asset Proxy Reentrancy & ERC1155 Callbacks).
- **Satyam:** Research partner. Independent notes and historical test scripts are currently **awaiting contribution details**. Work assigned for H-10 (SafeOrderBuilder & Helper Predicates) and H-11 (Registrator & Volatility). Satyam's contribution records will be incorporated dynamically into this tracker upon provision.

---

## 3. Codebase Coverage Matrix

### Legend
- **VERIFIED**: Formally audited, invariant-tested with dedicated regression tests, closed.
- **IN PROGRESS**: Active audit, tests being constructed.
- **ASSIGNED**: Scope defined, assigned to researcher, pending active testing.
- **AWAITING DETAILS**: Assigned to Satyam, awaiting historical notes/findings integration.

| File / Component | Primary Functions / Invariants | Owner | Prior Investigation / Evidence | Status | Unresolved Questions / Target Tasks |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`contracts/LimitOrderProtocol.sol`** | Core protocol entry point, inherits `OrderMixin`, `ImmutableOwner` | Prince | H-05, H-06, H-08; tested in `cross-component-invariants.test.js` & `order-authorization-and-settlement.test.js` | **VERIFIED** | None. Reentrancy and settlement boundaries verified. |
| **`contracts/OrderMixin.sol`** | `_fill`, `cancelOrder`, `cancelOrders`, `hashOrder`, `checkPredicate`, `_remainingInvalidator` | Prince | H-02, H-05, H-06, H-08; 73 automated tests | **VERIFIED** | All 4 fill entry points, CEI ordering, and single-fill invalidations verified. |
| **`contracts/OrderLib.sol`** | `hashOrder`, `isValidExtension`, EIP-712 typing | Prince | H-02, H-06, H-07, H-08; tested in `extension-parser-boundaries.test.js` | **VERIFIED** | Offset math and hash commitment binding verified. |
| **`libraries/AmountCalculatorLib.sol`** | `getMakingAmount`, `getTakingAmount`, rounding | Prince | H-03; tested in `pricing-and-calculators.test.js` | **VERIFIED** | Strict ceil-rounding favoring maker verified via fuzz tests. |
| **`libraries/BitInvalidatorLib.sol`** | Bitmask order invalidation, epoch/series offsets | Prince | H-06, H-07, H-08 | **VERIFIED** | Bit flipping and single-fill order replay protection verified. |
| **`libraries/RemainingInvalidatorLib.sol`**| Partial fill accounting, reentrancy lock bit | Prince | H-06, H-08; tested in `cross-component-invariants.test.js` | **VERIFIED** | Reentrancy bit flip and amount cap verified. |
| **`libraries/MakerTraitsLib.sol`** | Bit-level traits unpacking (series, nonce, flags) | Prince | H-06, H-08 | **VERIFIED** | Full bitfield layout verified against NatSpec. |
| **`libraries/TakerTraitsLib.sol`** | Slippage threshold, partial fill flag, unwrap WETH | Prince | H-08; tested in `order-authorization-and-settlement.test.js` | **VERIFIED** | Threshold checking and receiver routing verified. |
| **`libraries/ExtensionLib.sol`** | Offsets parsing, customData extraction | Prince | H-02; tested in `extension-parser-boundaries.test.js` | **VERIFIED** | Non-monotonic offset underflow memory expansion verified. |
| **`libraries/OffsetsLib.sol`** | Extension slicing offsets | Prince | H-02; 9 tests | **VERIFIED** | Out-of-bounds calldata bounds verified. |
| **`extensions/DutchAuctionCalculator.sol`**| Linear Dutch auction price decay | Prince | H-03; tested in `pricing-and-calculators.test.js` | **VERIFIED** | Linear arithmetic and ceilDiv bounds verified. |
| **`extensions/ChainlinkCalculator.sol`** | Oracle price feed, TTL staleness, decimal scaling | Prince | H-03; tested in `pricing-and-calculators.test.js` | **VERIFIED** | 4-hour TTL and SafeCast negative price revert verified. |
| **`extensions/RangeAmountCalculator.sol`** | Range-bound liquidity curve | Prince | H-03; tested in `pricing-and-calculators.test.js` | **VERIFIED** | Monotonic price increase verified; dust underflow documented. |
| **`extensions/NativeOrderFactory.sol`** | EIP-1167 clone factory for native ETH orders | Prince | H-04; tested in `native-order-cancellation.test.js` | **VERIFIED** | Clone salt collision and initialization bounds verified. |
| **`extensions/NativeOrderImpl.sol`** | Expired native order cancellation & ETH rewards | Prince | H-04; tested in `native-order-cancellation.test.js` | **VERIFIED** | Informational maker griefing edge case documented. |
| **`extensions/Permit2Proxy.sol`** | Permit2 transferFrom proxy, constructor address | Prince | H-07; tested in `permit2-signature-and-nonce.test.js` | **VERIFIED** | PR #413 zkSync constructor injection verified. |
| **`extensions/Permit2WitnessProxy.sol`** | Permit2 witness transferFrom proxy | Prince | H-07; tested in `permit2-signature-and-nonce.test.js` | **VERIFIED** | LOP-01 hardcoded address discrepancy documented. |
| **`extensions/ERC721Proxy.sol`** | `func_60iHVgK` (IERC20.transferFrom selector) | Prince | None (identified in code inventory) | **IN PROGRESS** (H-09) | Verify `amount` truncation and partial fill interaction. |
| **`extensions/ERC721ProxySafe.sol`** | `func_30iH1gK` (safeTransferFrom proxy) | Prince | None | **IN PROGRESS** (H-09) | Verify `onERC721Received` reentrancy surface. |
| **`extensions/ERC1155Proxy.sol`** | `func_301JL5R` (safeTransferFrom proxy) | Prince | None | **IN PROGRESS** (H-09) | Verify `onERC1155Received` hook during taker/maker transfer. |
| **`extensions/ApprovalPreInteraction.sol`**| Maker wallet contract, `preInteraction`, `isValidSignature` | Prince | Mentioned in inventory | **ASSIGNED** (H-09) | Verify allowance race conditions and non-standard ERC20s. |
| **`extensions/OrderIdInvalidator.sol`** | Single order execution per `orderId` | Prince | Mentioned in inventory | **ASSIGNED** (H-09) | Verify denial of service or permanent order locking via dust fills. |
| **`extensions/PrioirityFeeLimiter.sol`** | Priority fee threshold validator | Prince | Mentioned in inventory | **ASSIGNED** (H-09) | Verify `tx.gasprice - baseFee` underflow on L2 networks. |
| **`deploy/deploy-Permit2Proxy.js`** | Hardhat deploy task for Permit2Proxy | Prince | LOP-02; tested in `lop-deployment-regressions.test.js` | **VERIFIED** | Defect reproduced; PR #433 fix confirmed. |
| **`helpers/SafeOrderBuilder.sol`** | Gnosis Safe order builder with Chainlink oracles | Satyam | Mentioned in inventory | **AWAITING DETAILS** (H-10) | Investigate missing `latestAnswer > 0` validation and Safe delegatecall storage layout. |
| **`helpers/OrderRegistrator.sol`** | Off-chain order announcement & registration | Satyam | Mentioned in inventory; PR #431 diff analyzed | **AWAITING DETAILS** (H-10) | Investigate front-running registration & 4.3.4 vs HEAD differences. |
| **`helpers/PredicateHelper.sol`** | Nested boolean predicate dispatchers (`or`, `and`, `eq`...) | Satyam | Mentioned in inventory | **AWAITING DETAILS** (H-10) | Investigate non-32-byte returns, staticcall gas consumption, and slice errors. |
| **`helpers/SeriesNonceManager.sol`** | Multi-series nonce tracking & validation | Satyam | Mentioned in inventory | **AWAITING DETAILS** (H-10) | Investigate packed `timestampBelowAndNonceEquals` bounds. |
| **`helpers/SeriesEpochManager.sol`** | Multi-series epoch tracking & validation | Satyam | H-08 (cancellation tested) | **AWAITING DETAILS** (H-10) | Investigate bit-truncation on `uint96 series` in key hash. |
| **`extensions/AmountGetterWithFee.sol`** | Integrator/resolver fee wrapper | Satyam | H-03 (pricing verified); diff with HEAD analyzed | **AWAITING DETAILS** (H-11) | Investigate `orderHash` parameter binding differences. |
| **`extensions/FeeTaker.sol`** | Protocol & integrator fee recipient interaction | Satyam | H-03 (fee logic verified) | **AWAITING DETAILS** (H-11) | Investigate post-interaction ETH transfer & unwrap paths. |
| **`utils/EIP712Alien.sol`** | Cross-contract EIP-712 domain separator | Satyam | Mentioned in inventory | **AWAITING DETAILS** (H-11) | Investigate chain ID cache invalidation on hard forks. |

---

## 4. Active Investigation Streams

### Prince's Stream: H-09 (Asset Proxies & Callback Reentrancy)
- **Primary Objective:** Test whether `ERC1155Proxy.sol` and `ERC721ProxySafe.sol` callbacks enable reentrancy or state desynchronization.
- **Key Invariant:** During `_fill`, maker asset is transferred first (Step 6), then `takerInteraction` is executed (Step 7), then taker asset is transferred (Step 8). If an asset proxy executes a safe transfer with a receiver hook, does that hook execute before state finalization?
- **Deliverables:** New automated test suite `analysis/tests/asset-proxies-and-callbacks.test.js`.

### Satyam's Stream: H-10 (SafeOrderBuilder & Helper Predicates)
- **Primary Objective:** Test oracle sanity checks in `SafeOrderBuilder.sol` and predicate evaluation safety in `PredicateHelper.sol`.
- **Key Invariant:** `SafeOrderBuilder.buildAndSignOrder` computes `takingAmount` via `mulDiv(uint256(latestAnswer), ...)`. If `latestAnswer <= 0`, does the lack of `SafeCast` allow zero-taking orders or underflow revert?
- **Deliverables:** Reconstruct Satyam's contribution notes and build `analysis/tests/safe-order-builder-and-predicates.test.js`.
