# Researcher Status: Satyam

## 1. Current Assignment & Hypotheses

| Property | Value |
| :--- | :--- |
| **Researcher** | Satyam (Co-Researcher) |
| **Active Hypotheses** | **H-10: SafeOrderBuilder Oracle Validation & Volatility Math (LOP-C01)**<br/>**H-11: Order Registrators, Predicates & Nonce Managers** |
| **Domain** | Helper Contracts, Gnosis Safe Integrations, Oracle Price Scaling, Predicates |
| **Target Release** | Git Tag `4.3.4` (Commit `0a40e01befff19d925457b55191900fb456c2dd2`) |
| **Task Status** | **Requires additional verification** (H-10) / **Not started** (H-11) |
| **Contribution Status** | **Blocked / Awaiting Artifacts** (Pending provision of Satyam's past notes/scripts) |

> [!IMPORTANT]
> Satyam's previous independent research, draft notes, or local tests have not yet been synchronized into the Git history of this repository. This file serves as his dedicated active workspace ledger, and will incorporate his historical records upon provision of a branch name, commit hash, or draft document.

---

## 2. Source Files & Function Coverage

| File | Target Functions | Prior Investigation | Formal Task Status | Notes & Invariant Checks |
| :--- | :--- | :--- | :--- | :--- |
| [`contracts/helpers/SafeOrderBuilder.sol`](file:///d:/limit-order-protocol-research-findings/contracts/helpers/SafeOrderBuilder.sol) | `buildAndSignOrder`, `_getMessageHash` | Code inventory & source trace | **Requires additional verification** (H-10) | Investigate missing `latestAnswer > 0` validation. Note: `OrderMixin.sol:334` contains `if (makingAmount * takingAmount == 0) revert SwapWithZeroAmount()`. Test whether zero-amount swap is strictly blocked. |
| [`contracts/extensions/ChainlinkCalculator.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/ChainlinkCalculator.sol) | `_getSpreadedAmount`, `doublePrice` | H-03 (Verified by Prince) | **Completed and supported by evidence** | Baseline comparison: ChainlinkCalculator's `SafeCast` negative price revert vs SafeOrderBuilder's unchecked cast. |
| [`contracts/helpers/OrderRegistrator.sol`](file:///d:/limit-order-protocol-research-findings/contracts/helpers/OrderRegistrator.sol) | `registerOrder`, `announcedAt` | Code inventory & diff review | **Not started** (H-11) | Compare tag 4.3.4 (pure emit) with HEAD (`announcedAt` mapping); test front-running and announcement griefing. |
| [`contracts/helpers/PredicateHelper.sol`](file:///d:/limit-order-protocol-research-findings/contracts/helpers/PredicateHelper.sol) | `arbitraryStaticCall`, `or`, `and`, `eq`, `lt`, `gt` | Code inventory review | **Not started** (H-11) | Test `returndatasize() == 32` requirement against non-standard tokens or contracts; test calldata slice boundaries. |
| [`contracts/helpers/SeriesNonceManager.sol`](file:///d:/limit-order-protocol-research-findings/contracts/helpers/SeriesNonceManager.sol) | `timestampBelowAndNonceEquals`, `advanceNonce` | Code inventory review | **Not started** (H-11) | Test bit-packing unpacking in `timestampBelowAndNonceEquals`; verify 255 advance limit. |
| [`contracts/helpers/SeriesEpochManager.sol`](file:///d:/limit-order-protocol-research-findings/contracts/helpers/SeriesEpochManager.sol) | `epochEquals`, `advanceEpoch` | H-08 (Cancellation verified) | **Completed and supported by evidence** | `SeriesEpochManager` cancellation verified by 16 tests in `order-authorization-and-settlement.test.js`. |

---

## 3. Key Audit Findings Regarding H-10 / LOP-C01

During the source-level audit of the execution path from `SafeOrderBuilder` to `LimitOrderProtocol`:

1. **Protocol-Level Zero-Amount Revert Invariant:**  
   In `OrderMixin.sol:334`:
   ```solidity
   unchecked { if (makingAmount * takingAmount == 0) revert SwapWithZeroAmount(); }
   ```
   If `SafeOrderBuilder` computes `takingAmount = 0` (due to `latestAnswer == 0` for `makerAsset`), any taker attempting to fill the order on `LimitOrderProtocol` will encounter an immediate revert with `SwapWithZeroAmount()`.
   **Impact Assessment:** Uncompensated token theft via `takingAmount == 0` is strictly prevented by the protocol core. The potential impact is limited to an unfillable order (order griefing / denial of service).
2. **Negative Oracle Report Invariant:**  
   If `latestAnswer < 0`, `uint256(int256)` yields `~1.15e77`. In OpenZeppelin's `Math.mulDiv`, this causes multiplication overflow or yields an astronomical taking amount requiring $10^{77}$ taker tokens, which is unfillable.

---

## 4. Tasks That Should Not Be Repeated

- Core settlement, EIP-712 hashing, bit invalidator logic, Dutch auction math, and cancellation functions (already proven by Prince in H-01..H-08 with 73 passing tests).
- `SeriesEpochManager` cancellation semantics (verified in `order-authorization-and-settlement.test.js`).

---

## 5. Recommended Next Task for Satyam

Construct and execute the automated test suite in `analysis/tests/safe-order-builder-and-predicates.test.js`:
- Test 1: Simulate `SafeOrderBuilder.buildAndSignOrder` with a mock Aggregator returning zero (`0`). Verify whether the resulting order triggers `SwapWithZeroAmount()` when submitted to `LimitOrderProtocol.fillOrder` or `fillContractOrder`.
- Test 2: Simulate `SafeOrderBuilder.buildAndSignOrder` with a mock Aggregator returning negative answer (`-1`). Verify whether execution reverts during `mulDiv` or results in an unfillable order.
- Test 3: Test `PredicateHelper.arbitraryStaticCall` behavior when interacting with targets returning non-32-byte data.
- **Prerequisite:** Submit any prior notes, scratch scripts, or branch names to resolve the "Blocked / Awaiting Artifacts" status.
