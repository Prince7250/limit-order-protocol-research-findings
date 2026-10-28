# Researcher Status: Prince

## 1. Current Assignment & Hypothesis

| Property | Value |
| :--- | :--- |
| **Researcher** | Prince (Primary Researcher / Lead) |
| **Active Hypothesis** | **H-17: Research Synthesis and Bounty Submission Readiness Audit** |
| **Domain** | Protocol Invariant Verification, Evidence Audit, Bounty Scope Review, Submission Readiness |
| **Target Release** | Git Tag `4.3.4` (Commit `0a40e01befff19d925457b55191900fb456c2dd2`) |
| **Task Status** | **Completed and supported by evidence** (178 custom automated tests passing across workspace) |

---

## 2. Source Files & Function Coverage

| File | Target Functions | Prior Investigation | Formal Task Status | Notes & Invariant Checks |
| :--- | :--- | :--- | :--- | :--- |
| [`contracts/extensions/ERC1155Proxy.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/ERC1155Proxy.sol) | `func_301JL5R` | Inventory note | **Completed and supported by evidence** | Tested `onERC1155Received` hook during `_fill`. Proved single-fill reentrancy reverts with `BitInvalidatedOrder()`. Partial-fill reentrancy is strictly capped to `remainingMakingAmount`. |
| [`contracts/extensions/ERC721ProxySafe.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/ERC721ProxySafe.sol) | `func_30iH1gK` | Inventory note | **Completed and supported by evidence** | Proved `onERC721Received` hook triggers before taker settlement, and reentrancy is prevented by bit invalidation. |
| [`contracts/extensions/ERC721Proxy.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/ERC721Proxy.sol) | `func_60iHVgK` | Inventory note | **Completed and supported by evidence** | Proved non-safe `transferFrom` bypasses receiver callbacks; verified `amount` parameter is ignored and prevents double-transfer of NFTs. |
| [`contracts/OrderMixin.sol`](file:///d:/limit-order-protocol-research-findings/contracts/OrderMixin.sol) | `_fill`, `_callTransferFromWithSuffix`, `_makeCalls` | H-02, H-05..H-09 | **Completed and supported by evidence** | Reentrancy bit flip, CEI ordering, and atomic rollback on callback failure verified across 10 tests. |
| [`contracts/extensions/ImmutableOwner.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/ImmutableOwner.sol) | `onlyImmutableOwner` | Inventory note | **Completed and supported by evidence** | Verified direct calls revert with `IOAccessDenied()`. |
| [`contracts/extensions/OrderIdInvalidator.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/OrderIdInvalidator.sol) | `preInteraction` | Inventory note | **Completed and supported by evidence** | Verified permanent `(maker, orderId) -> orderHash` binding. Proved dust-fill locks ID against competing quotes; confirmed no reset/clear function exists. Namespaced per maker. (9 tests) |
| [`contracts/extensions/PrioirityFeeLimiter.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/PrioirityFeeLimiter.sol) | `isPriorityFeeValid` | Inventory note | **Completed and supported by evidence** | Verified 3 gas fee tiers (< 10.6 gwei @ 70%, 10.6-104.1 gwei @ 50%, >= 104.1 gwei @ 65%). Proved mathematical fail-closed invariant: `tx.gasprice < baseFee` underflows to $\approx 2^{256}$, returning `false` and reverting fill with `PredicateIsNotTrue()`. (14 tests) |
| [`contracts/extensions/RangeAmountCalculator.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/RangeAmountCalculator.sol) | `getRangeTakerAmount`, `getRangeMakerAmount` | H-03 (pricing verified) | **Completed and supported by evidence** | Reproduced exact `Panic(0x11)` on dust taking amounts due to integer division truncation in line 102 `(...) / k * 1e18`. Verified fail-safe revert. Validated curve monotonicity, high-precision reference matching, and round-trip consistency. (18 tests) |
| [`contracts/libraries/AmountCalculatorLib.sol`](file:///d:/limit-order-protocol-research-findings/contracts/libraries/AmountCalculatorLib.sol) | `getMakingAmount`, `getTakingAmount` | H-03 (linear pricing) | **Completed and supported by evidence** | Proved both directions strictly favor the maker (flooring makingAmount, ceiling takingAmount). Demonstrated rounding accumulation across partial fills. Verified 128-bit optimization vs checked fallback and downstream `SwapWithZeroAmount()` defense. |
| [`contracts/extensions/AmountGetterWithFee.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/AmountGetterWithFee.sol) | `_getMakingAmount`, `_getTakingAmount`, `_parseFeeData`, `_isWhitelistedGetterImpl` | H-03 | **Completed and supported by evidence** (H-16) | Verified packed whitelist parsing (1 byte size, 10 bytes per address), 80-bit address masking, discount numerator calculation, bounds checks (`InvalidWhitelistDiscountNumerator`, `InvalidIntegratorShare`), and calldata truncation reverts. (24 tests) |
| [`contracts/extensions/FeeTaker.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/FeeTaker.sol) | `postInteraction`, `_getFeeAmounts`, `_sendEth` | Initial review | **Completed and supported by evidence** (H-16) | Proved resolver gate: whitelisted or `_ACCESS_TOKEN.balanceOf > 0` required (`OnlyWhitelistOrAccessToken`). Proved strict token conservation ($\sum \text{fees} + \text{receiver} = \text{takingAmount}$). Verified `unwrapWeth` ETH forwarding, `EthTransferFailed` revert, and `InconsistentFee` guard when `receiver != FeeTaker`. |

---

## 3. Tasks Completed and Supported by Evidence (Do Not Repeat)

The following areas are closed and supported by passing tests; they should not be re-investigated:

1. **H-01 (Fee-on-transfer / rebasing tokens):** Closed based on documented evidence (Immunefi program exclusion).
2. **H-02 (Extension parser offsets):** Closed based on documented evidence (9 tests in `extension-parser-boundaries.test.js`).
3. **H-03 (Pricing and calculators):** Completed and supported by evidence (21 tests in `pricing-and-calculators.test.js`).
4. **H-04 (Native order cancellation):** Completed and supported by evidence (6 tests in `native-order-cancellation.test.js`).
5. **H-05 (Governance & pausing):** Closed based on documented evidence (verified pause sovereignty).
6. **H-06 (Cross-component settlement):** Completed and supported by evidence (6 tests in `cross-component-invariants.test.js`).
7. **H-07 (Permit2 signature & nonces):** Completed and supported by evidence (15 tests in `permit2-signature-and-nonce.test.js`).
8. **H-08 (Authorization vs settlement):** Completed and supported by evidence (16 tests in `order-authorization-and-settlement.test.js`).
9. **H-09 (Asset-proxy callbacks & reentrancy):** Completed and supported by evidence (10 tests in `asset-proxies-and-callbacks.test.js`).
10. **H-14 (OrderIdInvalidator & PriorityFeeLimiter):** Completed and supported by evidence (23 tests across `h14-order-id-invalidator.test.js` and `h14-priority-fee-limiter.test.js`).
11. **H-15 (RangeAmountCalculator & AmountCalculatorLib):** Completed and supported by evidence (18 tests in `analysis/tests/h15-range-amount-calculator.test.js`).
12. **H-16 (Whitelist Discounts & Resolver Fee Structures):** Completed and supported by evidence (24 tests in `analysis/tests/h16-whitelist-resolver-fees.test.js`).
13. **H-17 (Research Synthesis & Bounty Readiness Audit):** Completed and supported by evidence (Cross-hypothesis synthesis, Immunefi policy mapping, and LOP-01..LOP-04 audit complete).
14. **LOP-01 & LOP-02 (Permit2 deployment & address defects):** Completed and supported by evidence (2 tests in `lop-deployment-regressions.test.js`).

---

## 4. Key Empirical Findings for H-17 (Bounty Submission Readiness)

1. **Immunefi Smart Contracts Scope Compliance:**
   - Under the Primacy of Rules, Critical/High bounties require demonstrated direct theft or permanent freezing of user funds.
   - Core settlement contracts implement flawless defensive architecture: CEI ordering, reentrancy guards, maker-favoring rounding, and fail-safe execution halts.
2. **Finding Classification Summary:**
   - **LOP-01 (Permit2WitnessProxy.sol:22):** Operational / Interoperability Defect on zkSync Era (`324`). Non-exploitable for funds theft; cause of transaction reverts when using zkSync-specific SDK signatures. Reportable as Low / Operational advisory.
   - **LOP-02 (deploy/deploy-Permit2Proxy.js:15):** Deployment Script Tooling Defect. Bypasses chain ID mismatch check in local scripts. Excluded from Immunefi smart contracts scope as build/tooling issue; already resolved upstream in PR #433. Do NOT submit.
   - **LOP-03 (RangeAmountCalculator.sol:97-103):** Informational Arithmetic Boundary. Division truncation causes `Panic(0x11)` on dust taker amounts ($\le 173$ wei). Acts as a fail-safe execution halt. No funds stolen or permanently locked. Do NOT submit.
   - **LOP-04 (NativeOrderImpl.sol:154):** Informational Griefing Edge Case. Rejecting contract maker reverts resolver cancellation. Strictly isolated to maker's own clone (self-griefing); mitigated by off-chain simulation. Do NOT submit.

---

## 5. Recommended Next Action for Prince

**Coordinate with Satyam & Finalize Research Archive:**
- Present consolidated audit report to user.
- Await Satyam's final notes on H-13.
- Maintain regression test harness across the repository.
