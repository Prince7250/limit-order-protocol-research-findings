# Individual Findings Register: Satyam

This register tracks all candidate and confirmed security findings investigated by Satyam during research on the **1inch Limit Order Protocol** (Tag `4.3.4`).

---

## Index of Findings

| Finding ID | Title | Severity | Affected Component | Classification |
| :--- | :--- | :--- | :--- | :--- |
| **LOP-C01** | Missing Non-Positive Price Validation in `SafeOrderBuilder` Oracle Scaling | Informational | [`contracts/helpers/SafeOrderBuilder.sol:50, 58`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/helpers/SafeOrderBuilder.sol#L50) | Closed / Refuted as Exploit (Unfillable Order DoS) |
| **H-11 Invariants** | Predicate Evaluation, Order Announcement & Nonce Management Security | Informational / Best Practices | [`contracts/helpers/PredicateHelper.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/helpers/PredicateHelper.sol), [`contracts/helpers/OrderRegistrator.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/helpers/OrderRegistrator.sol) | Closed / Verified Non-Vulnerability (Defensive Design) |
| **H-12** | ApprovalPreInteraction cancellation-state identity mismatch | None assigned (Unverified) | [`contracts/extensions/ApprovalPreInteraction.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/extensions/ApprovalPreInteraction.sol) | Investigated candidate; reproduced locally; deprioritized for bounty submission |
| **H-13** | FeeTaker and AmountGetterWithFee fee-accounting invariants | None assigned (Pending) | [`contracts/extensions/AmountGetterWithFee.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/extensions/AmountGetterWithFee.sol), [`contracts/extensions/FeeTaker.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/extensions/FeeTaker.sol) | Proposed; not yet investigated; no vulnerability or impact established |

---

## Detailed Findings

### LOP-C01: Missing Non-Positive Price Validation in `SafeOrderBuilder` Oracle Scaling

- **Finding ID:** LOP-C01
- **Classification:** Closed / Refuted as Exploit (Confirmed Informational Edge Case: Unfillable Order DoS)
- **Affected Release:** Git Tag `4.3.4` (commit `0a40e01befff19d925457b55191900fb456c2dd2`) and current `main`
- **Exact Source Location:** [`contracts/helpers/SafeOrderBuilder.sol:48-67`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/helpers/SafeOrderBuilder.sol#L48-L67)
  ```solidity
  // contracts/helpers/SafeOrderBuilder.sol:48-52
  (, int256 latestAnswer,, uint256 updatedAt,) = makerAssetOracleParams.oracle.latestRoundData();
  // solhint-disable-next-line not-rely-on-time
  if (updatedAt + makerAssetOracleParams.ttl < block.timestamp) revert StaleOraclePrice();
  order.takingAmount = order.takingAmount.mulDiv(uint256(latestAnswer), makerAssetOracleParams.originalAnswer);

  // contracts/helpers/SafeOrderBuilder.sol:56-60
  (, int256 latestAnswer,, uint256 updatedAt,) = takerAssetOracleParams.oracle.latestRoundData();
  // solhint-disable-next-line not-rely-on-time
  if (updatedAt + takerAssetOracleParams.ttl < block.timestamp) revert StaleOraclePrice();
  order.takingAmount = order.takingAmount.mulDiv(takerAssetOracleParams.originalAnswer, uint256(latestAnswer));
  ```
- **Root Cause & Mechanism:**  
  `SafeOrderBuilder.buildAndSignOrder` queries Chainlink `AggregatorV3Interface.latestRoundData()`, which returns `int256 latestAnswer`. It validates price staleness (`updatedAt + ttl < block.timestamp`), but casts `uint256(latestAnswer)` directly without checking `latestAnswer > 0`.
  - In Solidity, casting a negative `int256` (e.g. `-1`) directly to `uint256` results in `type(uint256).max` (`~1.15e77`).
  - Casting zero `0` results in `uint256(0)`.
- **Comprehensive Execution Path & Protocol Guard Verification:**
  1. **Case A (Maker Asset Oracle returns `0`):**
     - `order.takingAmount` becomes `100 * 0 / originalAnswer = 0`.
     - The Safe signs the order with `takingAmount = 0` and registers it via `_ORDER_REGISTRATOR.registerOrder(order, extension, "")`.
     - **Taker Fill Attempt 1 (`isMakingAmount = true`):** The taker calls `fillContractOrder` requesting `makingAmount = 100`. In `OrderMixin.sol:302`, `takingAmount` is calculated linearly: `(100 * 0 + 100 - 1) / 100 = 0`. At `OrderMixin.sol:335`, the protocol executes:
       ```solidity
       unchecked { if (makingAmount * takingAmount == 0) revert SwapWithZeroAmount(); }
       ```
       The transaction **reverts immediately with `SwapWithZeroAmount()`** before any state modification or token transfer can occur.
     - **Taker Fill Attempt 2 (`isMakingAmount = false`, `takingAmount > 0`):** The taker specifies `takingAmount = 1`. In `AmountCalculatorLib.sol:15`, `makingAmount` evaluates `1 * 100 / 0`, causing an immediate EVM revert with **`Panic(0x12)` (division by zero)**.
  2. **Case B (Taker Asset Oracle returns `0`):**
     - In `SafeOrderBuilder.sol:66`, `order.takingAmount.mulDiv(originalAnswer, uint256(0))` attempts division by zero.
     - OpenZeppelin `Math.mulDiv` reverts immediately with **`Panic(0x12)`**.
     - The order is never built, signed, or registered.
  3. **Case C (Maker Asset Oracle returns negative `-1`):**
     - `uint256(-1)` equals `type(uint256).max` ($2^{256} - 1$).
     - If `order.takingAmount > originalAnswer`, `mulDiv` reverts on 256-bit multiplication overflow.
     - If `order.takingAmount <= originalAnswer`, the computed taking amount scales to an astronomical value ($> 10^{75}$ tokens). The order becomes impossible to fill on-chain.
  4. **Case D (Taker Asset Oracle returns negative `-1`):**
     - `order.takingAmount.mulDiv(originalAnswer, 2^256 - 1)` divides by $\approx 1.15 \times 10^{77}$. Due to integer truncation, `order.takingAmount` evaluates to `0`.
     - Downstream execution on `OrderMixin` reverts with `SwapWithZeroAmount()`.
- **Empirical Test Evidence:**
  - Automated Hardhat test harness created in [`analysis/tests/safe-order-builder-and-predicates.test.js`](file:///c:/Users/satya/limit-order-protocol-research-findings/analysis/tests/safe-order-builder-and-predicates.test.js).
  - Executed standalone empirical verification in [`analysis/tests/h10-safe-order-builder-standalone.test.js`](file:///c:/Users/satya/limit-order-protocol-research-findings/analysis/tests/h10-safe-order-builder-standalone.test.js):
    - Test 1 (Valid price control): Taking amount scales to 120, fill succeeds.
    - Test 2a (Maker oracle = 0): `takingAmount = 0` generated.
    - Test 2b (Maker oracle = 0, isMakingAmount=true): `SwapWithZeroAmount()` strictly reverts.
    - Test 2c (Maker oracle = 0, isMakingAmount=false): `Panic(0x12)` strictly reverts.
    - Test 3 (Taker oracle = 0): `Panic(0x12)` division by zero in builder.
    - Test 4a/b (Maker oracle = -1): Astronomical price or mulDiv overflow.
    - Test 5a/b (Taker oracle = -1): Truncates to 0, rejected by `SwapWithZeroAmount()`.
    - Result: **All 8 tests passed cleanly (Exit 0)**.
- **Security Impact & Classification:**
  - **No Exploit / No Fund Loss:** Uncompensated extraction of Safe maker assets is mathematically and architecturally impossible.
  - **Operational Edge Case (DoS / Gas Griefing):** If an oracle reports `0`, a Gnosis Safe can expend gas signing an order that will permanently fail to execute on-chain.
  - **Classification:** Closed as Refuted Exploit; categorized as Informational code robustness finding.
- **Remediation Recommendation:**
  Update `SafeOrderBuilder.sol` to adopt the pattern used in `ChainlinkCalculator.sol`:
  ```solidity
  require(latestAnswer > 0, "Invalid oracle answer");
  ```
  Additionally, add validation that `makerAssetOracleParams.originalAnswer > 0` and verify `answeredInRound >= roundId`.

---

### H-11 Invariant Review: Predicates, Registration & Nonce Lifecycle

- **Component:** [`contracts/helpers/PredicateHelper.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/helpers/PredicateHelper.sol), [`contracts/helpers/OrderRegistrator.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/helpers/OrderRegistrator.sol), [`contracts/helpers/SeriesNonceManager.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/helpers/SeriesNonceManager.sol)
- **Classification:** Closed / Verified Non-Vulnerability (Defensive Design)
- **Investigation Summary:**
  1. **PredicateHelper Return Constraints:** `_staticcallForUint` strictly enforces `eq(returndatasize(), 32)`. Staticcalls to EOAs, non-contract addresses, or functions returning non-32-byte data cleanly return `success = false`. In `not(data)`, failure safely returns `false`, preventing false-positive condition bypassing.
  2. **Calldata Slicing in `or`/`and`:** Calldata offsets are 32-bit slices. In Solidity 0.8+, non-monotonic offsets ($start > end$) or out-of-bounds indices ($end > length$) trigger `Panic(0x32)` and safely evaluate to `false` in `and` and continue in `or`. Empty offsets `0` honor formal Boolean vacuous truth (`or(0) = false`, `and(0) = true`).
  3. **OrderRegistrator Replay & Front-Running:** `announcedAt[orderHash]` prevents duplicate registration. Anyone can submit a validly signed order to announce it; front-running an announcement pays gas on the maker's behalf and preserves exact order parameters without fund loss or risk.
  4. **Nonce & Epoch Bit-Packing:** `SeriesNonceManager.timestampBelowAndNonceEquals` losslessly packs 4 fields into 256 bits (160-bit account, 16-bit series, 40-bit nonce, 40-bit timestamp). `advanceNonce` and `advanceEpoch` bound increments to `[1..255]`. `OrderMixin.sol:287` strictly prevents incompatible simultaneous use of bitmap invalidators and epoch managers.
- **Test Evidence:**
  - Standalone verification script [`analysis/tests/h11-predicate-registrator-standalone.test.js`](file:///c:/Users/satya/limit-order-protocol-research-findings/analysis/tests/h11-predicate-registrator-standalone.test.js) executed with **Exit 0 (11 passing tests)**.

---

### H-12: ApprovalPreInteraction cancellation-state identity mismatch

- **Finding ID:** H-12
- **Title:** `ApprovalPreInteraction cancellation-state identity mismatch`
- **Status:** Investigated candidate; reproduced locally; deprioritized for bounty submission.
- **Severity / Bounty Relevance:** No confirmed bounty severity. Bounty eligibility and qualifying impact remain unverified. Not described as confirmed theft, permanent fund lockup, or a confirmed bounty-eligible finding.
- **Suspected Root Cause:** Cancellation state is written under `msg.sender` ([`OrderMixin.sol:80-109`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/OrderMixin.sol#L80-L109), [`SeriesEpochManager.sol:34-39`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/helpers/SeriesEpochManager.sol#L34-L39)), while settlement checks invalidation against `order.maker` ([`OrderMixin.sol:288, 339, 494`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/OrderMixin.sol#L288)). For orders whose maker is `ApprovalPreInteraction`, the signing user (`_MAKER`) and contract-maker addresses differ.
- **Verified Observations:**
  1. Five Hardhat EVM integration tests passed in [`analysis/tests/h12-approval-preinteraction-cancellation.test.js`](file:///c:/Users/satya/limit-order-protocol-research-findings/analysis/tests/h12-approval-preinteraction-cancellation.test.js).
  2. Under tested conditions, standard cancellation, bit invalidation, and epoch advancement by the signing user did not invalidate the extension-maker order; a separate taker could fill it.
  3. A self-fill recovery path was demonstrated locally, but recovery is not guaranteed if another taker fills first.
- **Test Evidence:**
  - Standalone model suite: [`analysis/tests/h12-approval-preinteraction-standalone.test.js`](file:///c:/Users/satya/limit-order-protocol-research-findings/analysis/tests/h12-approval-preinteraction-standalone.test.js) (4/4 tests passed, Exit 0).
  - Hardhat EVM integration suite: [`analysis/tests/h12-approval-preinteraction-cancellation.test.js`](file:///c:/Users/satya/limit-order-protocol-research-findings/analysis/tests/h12-approval-preinteraction-cancellation.test.js) (5/5 tests passed).
- **Disposition:** Investigated candidate; reproduced locally; deprioritized for bounty submission. All existing test evidence is preserved. Production contracts remain untouched.

---

### H-13: FeeTaker and AmountGetterWithFee fee-accounting invariants (Proposed)

- **Finding ID:** H-13 (Proposed Investigation)
- **Title:** `FeeTaker and AmountGetterWithFee fee-accounting invariants`
- **Status:** Proposed; not yet investigated; no vulnerability or impact established.
- **Relevant Files:**
  - [`contracts/extensions/AmountGetterWithFee.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/extensions/AmountGetterWithFee.sol)
  - [`contracts/extensions/FeeTaker.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/extensions/FeeTaker.sol)
  - [`contracts/OrderMixin.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/OrderMixin.sol)
  - [`test/FeeTaker.js`](file:///c:/Users/satya/limit-order-protocol-research-findings/test/FeeTaker.js)
- **Research Question:** Can a valid order or partial fill cause the amount collected by `AmountGetterWithFee` to be insufficient for the distributions performed by `FeeTaker`?
- **Planned First Step:** Trace the formulas, rounding directions, fee limits, and transfer amounts, then compare the calculations with existing tests.
