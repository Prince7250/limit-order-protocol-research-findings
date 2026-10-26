# Individual Findings Register: Satyam

This register tracks all candidate and confirmed security findings investigated by Satyam during research on the **1inch Limit Order Protocol** (Tag `4.3.4`).

---

## Index of Findings

| Finding ID | Title | Severity | Affected Component | Classification |
| :--- | :--- | :--- | :--- | :--- |
| **LOP-C01** | Missing Non-Positive Price Validation in `SafeOrderBuilder` Oracle Scaling | Candidate / Under Review | [`contracts/helpers/SafeOrderBuilder.sol:50, 58`](file:///d:/limit-order-protocol-research-findings/contracts/helpers/SafeOrderBuilder.sol#L50) | Unverified Hypothesis (H-10) |

---

## Detailed Findings

### LOP-C01: Missing Non-Positive Price Validation in `SafeOrderBuilder` Oracle Scaling

- **Finding ID:** LOP-C01
- **Classification:** Unverified Hypothesis (Under Active Review)
- **Affected Release:** Git Tag `4.3.4` (commit `0a40e01befff19d925457b55191900fb456c2dd2`) and current `main`
- **Exact Source Location:** [`contracts/helpers/SafeOrderBuilder.sol:48-60`](file:///d:/limit-order-protocol-research-findings/contracts/helpers/SafeOrderBuilder.sol#L48-L60)
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
- **Root Cause & Attacker Prerequisites:**  
  `SafeOrderBuilder.buildAndSignOrder` queries Chainlink `AggregatorV3Interface.latestRoundData()`, which returns `int256 latestAnswer`. It validates price staleness (`updatedAt + ttl < block.timestamp`), but casts `uint256(latestAnswer)` directly without checking `latestAnswer > 0`.
  - Contrast with `ChainlinkCalculator.sol:14`:
    ```solidity
    using SafeCast for int256;
    // reverts with SafeCastOverflowNegativeIntToUint() if answer <= 0
    ```
  - In Solidity, casting a negative `int256` (e.g. `-1`) directly to `uint256` results in `type(uint256).max` (`~1.15e77`).
  - Casting zero `0` results in `uint256(0)`.
- **Exploit / Execution Path:**  
  1. A Gnosis Safe executes a delegatecall to `SafeOrderBuilder.buildAndSignOrder(...)`.
  2. The oracle for `makerAsset` or `takerAsset` reports a zero or negative price during an extreme market disruption or oracle malfunction.
  3. Case A (`latestAnswer == 0` for maker asset): `order.takingAmount.mulDiv(0, originalAnswer)` computes `takingAmount = 0`. The order is signed and registered with taking amount = 0, effectively pricing maker assets for free.
  4. Case B (`latestAnswer < 0` for maker asset): `uint256(latestAnswer)` becomes a massive number `2^256 - 1`, causing multiplication overflow revert or astronomical taking amount.
  5. Case C (`latestAnswer == 0` for taker asset): `mulDiv(originalAnswer, 0)` causes a division-by-zero revert.
- **Violated Security Invariant:** Strict price feed boundary validation; calculated taking amounts must be positive and bounded by positive oracle price answers.
- **Reproduction Steps & Planned Testing:**  
  Will be tested in `analysis/tests/safe-order-builder-and-predicates.test.js`:
  - Mock Chainlink Aggregator configured to return `0` or `-1`.
  - Execute `buildAndSignOrder` and assert resulting `order.takingAmount` and protocol acceptance.
- **Concrete Impact & Affected Assets:** If a signed order with `takingAmount = 0` can be submitted to `LimitOrderProtocol`, a taker could drain the maker's offered assets without providing payment, or the order would be rendered unfillable.
- **Existing Protections / Counter-Arguments to Verify:**  
  1. Does `LimitOrderProtocol.fillOrder` revert if `order.takingAmount == 0` or `takingAmount == 0`?
  2. Does `SafeOrderBuilder` operate purely as an off-chain helper or is it used on-chain by Safe modules?
  3. Gnosis Safe delegatecall authentication requirements.
- **Historical Audit & Disclosure Checks:** Checked against OpenZeppelin audit (PR #400/413) and ABDK audits; no previous mention of `SafeOrderBuilder` oracle casting.
- **Immunefi Scope & Severity Rationale:** If `takingAmount = 0` allows uncompensated token extraction from a Gnosis Safe, it would represent a High/Critical severity flaw. If protocol-level checks or division-by-zero reverts prevent execution, it is an Informational edge case.
- **Confidence & Uncertainties:** Medium confidence. Under active investigation under H-10.
