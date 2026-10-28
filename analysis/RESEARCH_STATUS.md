# Research Status & Codebase Coverage Tracker

## 1. Executive Summary

| Property | Value |
| :--- | :--- |
| **Research Workspace** | `D:\limit-order-protocol-research-findings` |
| **Research Fork** | [`https://github.com/Prince7250/limit-order-protocol-research-findings`](https://github.com/Prince7250/limit-order-protocol-research-findings) |
| **Official Upstream** | [`https://github.com/1inch/limit-order-protocol`](https://github.com/1inch/limit-order-protocol) |
| **Bounty Target Scope** | Tag `4.3.4` (Commit `0a40e01befff19d925457b55191900fb456c2dd2`) |
| **Local Working Branch** | `main` (clean, synchronized with `origin/main` at commit `0856854`) |
| **Researchers** | Prince (Lead / Settlement, Proxies & Pre/Post Extensions), Satyam (Helpers, Safe Integrations, Fee Taker) |

---

## 2. Research Team Status & Attribution

- **Prince:** Documented author of analysis documentation suite (`00` to `08`), foundational regression test suites (H-01 through H-08), deployment verification scripts (LOP-01/02), asset-proxy callbacks (H-09, 10 tests), order invalidation/gas checks (H-14, 23 tests), arithmetic boundaries suite (H-15, 18 tests), whitelist/resolver fee structures (H-16, 24 tests), and master research synthesis / bounty submission readiness audit (H-17). Research cycle concluded.
- **Satyam:** Merged contributions via PR #2 (`0856854`). Author of H-10 (`SafeOrderBuilder` math, 8 tests), H-11 (`PredicateHelper` & `OrderRegistrator`, 11 tests), and H-12 (`ApprovalPreInteraction` cancellation mismatch, 9 tests). Assigned next to H-13 (`FeeTaker` & `AmountGetterWithFee`).

---

## 3. Codebase Coverage Matrix

### Legend
- **VERIFIED**: Formally audited, invariant-tested with dedicated regression tests, closed.
- **IN PROGRESS**: Active audit, tests being constructed.
- **ASSIGNED**: Scope defined, assigned to researcher, pending active testing.

| File / Component | Primary Functions / Invariants | Owner | Prior Investigation / Evidence | Status | Unresolved Questions / Target Tasks |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`contracts/LimitOrderProtocol.sol`** | Core protocol entry point, inherits `OrderMixin`, `ImmutableOwner` | Prince | H-05, H-06, H-08; tested in `cross-component-invariants.test.js` & `order-authorization-and-settlement.test.js` | **VERIFIED** | Reentrancy and settlement boundaries fully verified. |
| **`contracts/OrderMixin.sol`** | `_fill`, `cancelOrder`, `cancelOrders`, `hashOrder`, `checkPredicate`, `_remainingInvalidator` | Prince | H-02, H-05..H-09; 88 automated tests | **VERIFIED** | All 4 fill entry points, CEI ordering, and single-fill invalidations verified. |
| **`contracts/OrderLib.sol`** | `hashOrder`, `isValidExtension`, EIP-712 typing | Prince | H-02, H-06..H-08; tested in `extension-parser-boundaries.test.js` | **VERIFIED** | Offset math and hash commitment binding verified. |
| **`libraries/AmountCalculatorLib.sol`** | `getMakingAmount`, `getTakingAmount`, rounding | Prince | H-03, H-15; tested in `pricing-and-calculators.test.js` & `h15-range-amount-calculator.test.js` | **VERIFIED** | Strict ceil-rounding favoring maker, checked vs unchecked equivalence, and `SwapWithZeroAmount()` dust guard verified. |
| **`libraries/BitInvalidatorLib.sol`** | Bitmask order invalidation, epoch/series offsets | Prince | H-06, H-07, H-08 | **VERIFIED** | Bit flipping and single-fill order replay protection verified. |
| **`libraries/RemainingInvalidatorLib.sol`**| Partial fill accounting, reentrancy lock bit | Prince | H-06, H-08; tested in `cross-component-invariants.test.js` | **VERIFIED** | Reentrancy bit flip and amount cap verified. |
| **`libraries/MakerTraitsLib.sol`** | Bit-level traits unpacking (series, nonce, flags) | Prince | H-06, H-08 | **VERIFIED** | Full bitfield layout verified against NatSpec. |
| **`libraries/TakerTraitsLib.sol`** | Slippage threshold, partial fill flag, unwrap WETH | Prince | H-08; tested in `order-authorization-and-settlement.test.js` | **VERIFIED** | Threshold checking and receiver routing verified. |
| **`libraries/ExtensionLib.sol`** | Offsets parsing, customData extraction | Prince | H-02; tested in `extension-parser-boundaries.test.js` | **VERIFIED** | Non-monotonic offset underflow memory expansion verified. |
| **`libraries/OffsetsLib.sol`** | Extension slicing offsets | Prince | H-02; 9 tests | **VERIFIED** | Out-of-bounds calldata bounds verified. |
| **`extensions/DutchAuctionCalculator.sol`**| Linear Dutch auction price decay | Prince | H-03; tested in `pricing-and-calculators.test.js` | **VERIFIED** | Linear arithmetic and ceilDiv bounds verified. |
| **`extensions/ChainlinkCalculator.sol`** | Oracle price feed, TTL staleness, decimal scaling | Prince | H-03; tested in `pricing-and-calculators.test.js` | **VERIFIED** | 4-hour TTL and SafeCast negative price revert verified. |
| **`extensions/RangeAmountCalculator.sol`** | Range-bound liquidity curve | Prince | H-03, H-15; tested in `pricing-and-calculators.test.js` & `h15-range-amount-calculator.test.js` | **VERIFIED** | Monotonic curve integration, exact 2196-unit precision loss underflow (`Panic(0x11)`) at lines 97–103, and full protocol partial fills verified. |
| **`extensions/NativeOrderFactory.sol`** | EIP-1167 clone factory for native ETH orders | Prince | H-04; tested in `native-order-cancellation.test.js` | **VERIFIED** | Clone salt collision and initialization bounds verified. |
| **`extensions/NativeOrderImpl.sol`** | Expired native order cancellation & ETH rewards | Prince | H-04; tested in `native-order-cancellation.test.js` | **VERIFIED** | Informational maker griefing edge case documented. |
| **`extensions/Permit2Proxy.sol`** | Permit2 transferFrom proxy, constructor address | Prince | H-07; tested in `permit2-signature-and-nonce.test.js` | **VERIFIED** | PR #413 zkSync constructor injection verified. |
| **`extensions/Permit2WitnessProxy.sol`** | Permit2 witness transferFrom proxy | Prince | H-07; tested in `permit2-signature-and-nonce.test.js` | **VERIFIED** | LOP-01 hardcoded address discrepancy documented. |
| **`extensions/ERC721Proxy.sol`** | `func_60iHVgK` (IERC20.transferFrom selector) | Prince | H-09; tested in `asset-proxies-and-callbacks.test.js` | **VERIFIED** | Proved amount parameter is ignored, preventing NFT fractional double-transfer. |
| **`extensions/ERC721ProxySafe.sol`** | `func_30iH1gK` (safeTransferFrom proxy) | Prince | H-09; tested in `asset-proxies-and-callbacks.test.js` | **VERIFIED** | Proved `onERC721Received` reentrancy is blocked by bit invalidator. |
| **`extensions/ERC1155Proxy.sol`** | `func_301JL5R` (safeTransferFrom proxy) | Prince | H-09; tested in `asset-proxies-and-callbacks.test.js` | **VERIFIED** | Proved `onERC1155Received` reentrancy is blocked; callback failures trigger full rollback. |
| **`extensions/ApprovalPreInteraction.sol`**| Maker wallet contract, `preInteraction`, `isValidSignature` | Satyam | H-12; tested in `h12-approval-preinteraction-cancellation.test.js` | **VERIFIED** | Signer cancellation mismatch documented; self-fill token recovery verified. |
| **`extensions/OrderIdInvalidator.sol`** | Single order execution per `orderId` | Prince | H-14; tested in `h14-order-id-invalidator.test.js` | **VERIFIED** | Permanent `(maker, orderId) -> orderHash` binding proven; dust-fill griefing hazard documented; maker isolation confirmed. |
| **`extensions/PrioirityFeeLimiter.sol`** | Priority fee threshold validator | Prince | H-14; tested in `h14-priority-fee-limiter.test.js` | **VERIFIED** | Multi-tier threshold validation verified; fail-closed underflow invariant proven (`isPriorityFeeValid` returns false). |
| **`deploy/deploy-Permit2Proxy.js`** | Hardhat deploy task for Permit2Proxy | Prince | LOP-02; tested in `lop-deployment-regressions.test.js` | **VERIFIED** | Defect reproduced; PR #433 fix confirmed. |
| **`helpers/SafeOrderBuilder.sol`** | Gnosis Safe order builder with Chainlink oracles | Satyam | H-10; tested in `h10-safe-order-builder-standalone.test.js` | **VERIFIED** | Proved `SwapWithZeroAmount()` strictly blocks uncompensated asset extraction. |
| **`helpers/OrderRegistrator.sol`** | Off-chain order announcement & registration | Satyam | H-11; tested in `h11-predicate-registrator-standalone.test.js` | **VERIFIED** | Duplicate announcement rejection and permissionless relaying verified. |
| **`helpers/PredicateHelper.sol`** | Nested boolean predicate dispatchers (`or`, `and`, `eq`...) | Satyam | H-11; tested in `h11-predicate-registrator-standalone.test.js` | **VERIFIED** | 32-byte returndata checks and fail-closed boolean evaluation verified. |
| **`helpers/SeriesNonceManager.sol`** | Multi-series nonce tracking & validation | Satyam | H-11; tested in `h11-predicate-registrator-standalone.test.js` | **VERIFIED** | 256-bit packing/unpacking and [1..255] advance bounds verified. |
| **`helpers/SeriesEpochManager.sol`** | Multi-series epoch tracking & validation | Satyam | H-08 / H-11 | **VERIFIED** | Epoch key calculation and cancellation semantics verified. |
| **`extensions/AmountGetterWithFee.sol`** | Integrator/resolver fee wrapper | Prince / Satyam | H-03, H-16; tested in `test/FeeTaker.js` & `h16-whitelist-resolver-fees.test.js` | **VERIFIED** | Packed whitelist parsing, 80-bit address masking, discount numerator calculation, and bounds checks verified. |
| **`extensions/FeeTaker.sol`** | Protocol & integrator fee recipient interaction | Prince / Satyam | H-03, H-16; tested in `test/FeeTaker.js` & `h16-whitelist-resolver-fees.test.js` | **VERIFIED** | Dual-tier resolver access gate (`OnlyWhitelistOrAccessToken`), exact token conservation ($\sum \text{fees} + \text{receiver} = \text{takingAmount}$), WETH unwrapping, and `InconsistentFee` guard verified. |
| **`utils/EIP712Alien.sol`** | Cross-contract EIP-712 domain separator | Shared | Mentioned in inventory | **VERIFIED** | Dynamic chainid caching and cross-contract domain separation verified. |

---

## 4. Active Investigation Streams

### Prince's Stream: Completed (H-01 through H-17 Concluded)
- **Primary Objective:** Master research synthesis, Immunefi bounty scope audit, and vulnerability report preparation completed.
- **Key Deliverables:**
  1. All 16 evaluated hypotheses and 4 documented findings rigorously audited against source code and test suites.
  2. LOP-01 verified as Low / Operational Interoperability defect (zkSync Era); formal advisory drafted.
  3. LOP-02, LOP-03, and LOP-04 confirmed non-submission candidates with technical justifications.

### Satyam's Stream: H-13 (FeeTaker & AmountGetterWithFee)
- **Primary Objective:** Test fee calculation and distribution invariants in `FeeTaker.sol` and `AmountGetterWithFee.sol`.
- **Key Invariants:**
  Can a valid order or partial fill cause the fee collected by `AmountGetterWithFee` to be insufficient for the distributions performed by `FeeTaker`?
