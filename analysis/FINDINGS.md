# Security Findings & Vulnerability Register

This register documents all confirmed security defects, operational anomalies, and candidate findings discovered during authorized security research on the **1inch Limit Order Protocol** (Immunefi bounty target tag `4.3.4`).

---

## Findings Summary

| ID | Title | Severity | Affected Component | Status | Test / Reproduction |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **LOP-01** | Hardcoded Canonical Address in `Permit2WitnessProxy` Precludes zkSync Support | **Low / Operational** | [`contracts/extensions/Permit2WitnessProxy.sol:22`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/Permit2WitnessProxy.sol#L22) | Confirmed | [`analysis/tests/lop-deployment-regressions.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/lop-deployment-regressions.test.js) |
| **LOP-02** | Defective Network Object Lookup Bypasses Intended Chain-ID Deployment Guard | **Low / Deployment Safety** | [`deploy/deploy-Permit2Proxy.js:15`](file:///d:/limit-order-protocol-research-findings/deploy/deploy-Permit2Proxy.js#L15) | Confirmed | [`analysis/tests/lop-deployment-regressions.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/lop-deployment-regressions.test.js) |
| **LOP-03** | Integer Division Truncation Causes `Panic(0x11)` on Dust Amounts | **Informational** | [`contracts/extensions/RangeAmountCalculator.sol:84`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/RangeAmountCalculator.sol#L84) | Confirmed (Fail-safe) | [`analysis/tests/pricing-and-calculators.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/pricing-and-calculators.test.js) |
| **LOP-04** | Contract Maker Rejection Griefs Resolver Gas on Expired Native Order Cancellation | **Informational** | [`contracts/extensions/NativeOrderImpl.sol:154`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/NativeOrderImpl.sol#L154) | Confirmed (Isolated) | [`analysis/tests/native-order-cancellation.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/native-order-cancellation.test.js) |
| **LOP-C01** | Missing Non-Positive Price Validation in `SafeOrderBuilder` Oracle Scaling | **Candidate / Under Review** | [`contracts/helpers/SafeOrderBuilder.sol:50, 58`](file:///d:/limit-order-protocol-research-findings/contracts/helpers/SafeOrderBuilder.sol#L50) | Investigating (H-10) | Assigned to Satyam |

---

## Detailed Finding Reports

### LOP-01: Hardcoded Canonical Address in `Permit2WitnessProxy` Precludes zkSync Support

- **Severity:** Low (Operational Discrepancy)
- **Target File:** [`contracts/extensions/Permit2WitnessProxy.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/Permit2WitnessProxy.sol#L22)
- **Lines:** 22
- **Prior Art / Context:** OpenZeppelin Audit (PR #400 / #413), Finding M-01.

#### Description
In `Permit2Proxy.sol`, PR #413 resolved the non-canonical deployment address of Permit2 on zkSync Era (`0x0000000000225e31d52dccfb0e770c6a099fa700`) by accepting the Permit2 contract address as an immutable constructor argument:
```solidity
// contracts/extensions/Permit2Proxy.sol:20
constructor(address permit2, address _immutableOwner) ImmutableOwner(_immutableOwner) {
    PERMIT2 = permit2;
}
```
However, the companion contract `Permit2WitnessProxy.sol` was left unchanged and still hardcodes the Ethereum mainnet canonical address:
```solidity
// contracts/extensions/Permit2WitnessProxy.sol:22
address private constant _PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
```
If `Permit2WitnessProxy` is deployed on zkSync Era or testnets using the standard artifact, calls to `witnessPermitTrasnferFrom` will target an unpopulated or incorrect address, causing witness transfers to fail completely.

#### Impact
Deployments of `Permit2WitnessProxy` on zkSync cannot function without modifying the source code or using a custom proxy deployment.

#### Proof of Concept / Reproduction
Automated in `analysis/tests/lop-deployment-regressions.test.js`:
```bash
node analysis/tests/lop-deployment-regressions.test.js
```
The test asserts that the target address in `Permit2WitnessProxy` differs from the SDK zkSync address (`0x0000000000225e31d52dccfb0e770c6a099fa700`).

#### Remediation
Refactor `Permit2WitnessProxy.sol` to match `Permit2Proxy.sol`: accept `address permit2` as a constructor parameter and store it in an immutable variable `_PERMIT2`.

---

### LOP-02: Defective Network Object Lookup Bypasses Intended Chain-ID Deployment Guard

- **Severity:** Low (Deployment Tooling Defect)
- **Target File:** [`deploy/deploy-Permit2Proxy.js`](file:///d:/limit-order-protocol-research-findings/deploy/deploy-Permit2Proxy.js#L15)
- **Lines:** 15
- **Prior Art / Context:** Fixed upstream in PR #433 / #434.

#### Description
In `deploy/deploy-Permit2Proxy.js`, line 15 attempts to ensure that the active Hardhat network's configured chain ID matches the RPC node's actual live chain ID before proceeding with deployment:
```javascript
// deploy/deploy-Permit2Proxy.js:15
if (networkName in hre.config.networks[networkName] && hre.config.networks[networkName].chainId !== chainId) {
    throw new Error(`network ${networkName} chainId ${hre.config.networks[networkName].chainId} !== ${chainId}`);
}
```
The expression `networkName in hre.config.networks[networkName]` checks whether the string property name (e.g. `'mainnet'`) exists as a key inside the network's configuration object `{ url: ..., chainId: ..., ... }`. Because network objects do not have a property named after the network itself, this expression **always evaluates to `false`**.

#### Impact
The chain ID consistency guard is silently bypassed. A deployer could deploy contracts against an RPC node with a mismatched chain ID, resulting in misconfigured deployments or misdirected gas expenditure.

#### Proof of Concept / Reproduction
Automated in `analysis/tests/lop-deployment-regressions.test.js`:
```javascript
const currentGuard = networkName in hreMock.config.networks[networkName] && hreMock.config.networks[networkName].chainId !== rpcChainId;
// Evaluates to false (bypassed)
const correctedGuard = networkName in hreMock.config.networks && hreMock.config.networks[networkName].chainId !== rpcChainId;
// Evaluates to true (guard triggers)
```

#### Remediation
Change line 15 to:
```javascript
if (networkName in hre.config.networks && hre.config.networks[networkName].chainId !== chainId) {
```

---

### LOP-03: Integer Division Truncation Causes `Panic(0x11)` on Dust Amounts

- **Severity:** Informational (Fail-Safe Arithmetic Revert)
- **Target File:** [`contracts/extensions/RangeAmountCalculator.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/RangeAmountCalculator.sol#L97-L103)
- **Lines:** 97–103
- **Audited Under:** Hypothesis H-03 & Hypothesis H-15

#### Description
In `RangeAmountCalculator.getRangeMakerAmount`:
```solidity
return (Math.sqrt(
    (
        b * bDivK +
        alreadyFilledMakingAmount * (2 * b + k * alreadyFilledMakingAmount / 1e18) +
        2 * takingAmount * 1e18
    ) / k * 1e18
) - bDivK) - alreadyFilledMakingAmount;
```
When `takingAmount` is extremely small (dust wei, e.g. $\le 173$ wei on small orders), intermediate integer division by $k$ prior to multiplication by $1e18$ drops precision. Consequently, `Math.sqrt(...)` computes to a value 2196 units less than `(bDivK + alreadyFilledMakingAmount)`. In Solidity 0.8+, the unsigned subtraction `(Math.sqrt(...) - bDivK) - alreadyFilledMakingAmount` underflows below zero and reverts with `Panic(0x11)`.

#### Impact
Dust taker fills on range-bound orders revert rather than executing. This represents a fail-safe revert and cannot be exploited to steal funds, extract uncompensated assets, or bypass rounding invariants. A taker fill immediately above the threshold (e.g. 213 wei) executes cleanly.

#### Proof of Concept / Reproduction
Verified in:
- `analysis/tests/pricing-and-calculators.test.js`
- `analysis/tests/h15-range-amount-calculator.test.js` (Test: `reproduces exact Panic(0x11) at line 103 for dust taking amount (173 wei)` and `proves valid control case immediately above threshold succeeds without panic`).

---

### LOP-04: Contract Maker Rejection Griefs Resolver Gas on Expired Native Order Cancellation

- **Severity:** Informational (Maker-Isolated Griefing Edge Case)
- **Target File:** [`contracts/extensions/NativeOrderImpl.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/NativeOrderImpl.sol#L154)
- **Lines:** 154
- **Audited Under:** Hypothesis H-04

#### Description
In `NativeOrderImpl._cancelOrder`:
```solidity
if (reward > 0) {
    AddressLib.sendNative(msg.sender, reward);
}
AddressLib.sendNative(ethRecipient, balance);
```
If the maker is a contract wallet that rejects raw ETH transfers (no `receive()` or reverts in fallback) or consumes excessive gas (> 100,000 gas), the resolver's call to cancel the expired order reverts.

#### Impact
The resolver loses transaction gas and cannot claim their cancellation reward. However:
1. The griefing is strictly isolated to the malicious maker's own clone.
2. Unrelated native orders in other clones continue executing normally.
3. Off-chain resolvers simulate transactions via `eth_call` before broadcast, shielding them from on-chain reverts.

---

### LOP-C01 (Candidate): Missing Non-Positive Price Validation in `SafeOrderBuilder`

- **Severity:** Informational / Defense In Depth (Non-Vulnerability)
- **Target File:** [`contracts/helpers/SafeOrderBuilder.sol`](file:///d:/limit-order-protocol-research-findings/contracts/helpers/SafeOrderBuilder.sol#L50)
- **Lines:** 48–60
- **Lead Researcher:** Satyam (Assigned under H-10)

#### Hypothesis & Finding
In `SafeOrderBuilder.sol`:
```solidity
(, int256 latestAnswer,, uint256 updatedAt,) = makerAssetOracleParams.oracle.latestRoundData();
if (updatedAt + makerAssetOracleParams.ttl < block.timestamp) revert StaleOraclePrice();
order.takingAmount = order.takingAmount.mulDiv(uint256(latestAnswer), makerAssetOracleParams.originalAnswer);
```
Tested across 8 standalone tests (`h10-safe-order-builder-standalone.test.js`). If `latestAnswer <= 0`, `SafeOrderBuilder` either scales `takingAmount` to 0 or astronomically high ($2^{256} - 1$). However, `OrderMixin.sol:335` strictly reverts with `SwapWithZeroAmount()` or `Panic(0x12)`, preventing zero-amount fills.

---

### H-14: OrderIdInvalidator Permanent Commitment & PriorityFeeLimiter Fail-Closed Underflow

- **Severity:** Informational / Operational Invariant (Non-Vulnerability)
- **Target Files:** [`contracts/extensions/OrderIdInvalidator.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/OrderIdInvalidator.sol) and [`contracts/extensions/PrioirityFeeLimiter.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/PrioirityFeeLimiter.sol)
- **Lines:** `OrderIdInvalidator.sol:43-51`, `PrioirityFeeLimiter.sol:12-25`
- **Lead Researcher:** Prince

#### Description
1. **OrderIdInvalidator:**  
   `_ordersIdsHashes[maker][orderId] = orderHash` commits permanently upon first fill. Partial fills of the same order succeed (`storedOrderHash == orderHash`), but any competing or revised order with the same `orderId` reverts with `InvalidOrderHash()`. Because no cancellation or reset function exists, an `orderId` once bound cannot be reused. If a maker signs multiple alternative quotes sharing an `orderId`, a taker filling 1 wei of Quote A permanently invalidates Quote B. Mappings are strictly isolated per maker.
2. **PriorityFeeLimiter:**  
   Enforces maximum priority fees based on block base fee:
   - `< 10.6 gwei`: priority fee capped at 70% of baseFee.
   - `10.6 gwei <= baseFee < 104.1 gwei`: priority fee capped at 50% of baseFee.
   - `>= 104.1 gwei`: priority fee capped at 65% of baseFee.
   Under `unchecked { uint256 priorityFee = tx.gasprice - baseFee; }`, if `tx.gasprice < baseFee`, `priorityFee` underflows to $\approx 2^{256}$. Multiplying by 100 or 2 produces a value astronomically larger than `baseFee * threshold`. The function is mathematically proven to fail closed (returns `false`), triggering `revert PredicateIsNotTrue()` in `OrderMixin`.

#### Proof of Concept / Reproduction
- 9 unit tests in [`analysis/tests/h14-order-id-invalidator.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/h14-order-id-invalidator.test.js) (passing).
- 14 unit tests in [`analysis/tests/h14-priority-fee-limiter.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/h14-priority-fee-limiter.test.js) (passing).

---

### H-16: Whitelist Discounts, Dual-Tier Resolver Authorization & Fee Accounting Invariants

- **Severity:** Informational / Verified Protocol Invariants (Non-Vulnerability)
- **Target Files:** [`contracts/extensions/AmountGetterWithFee.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/AmountGetterWithFee.sol) and [`contracts/extensions/FeeTaker.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/FeeTaker.sol)
- **Lines:** `AmountGetterWithFee.sol:34-120`, `FeeTaker.sol:112-198`
- **Lead Researcher:** Prince

#### Description
1. **Whitelist Architecture & 80-Bit Address Truncation:**  
   Whitelist data is packed as 1-byte count $N$ followed by $N \times 10$ bytes of address suffixes. Address comparison checks `uint80(uint160(taker)) == uint80(bytes10(whitelist[:10]))`. Calldata shorter than declared size reverts cleanly. 80-bit address masking provides $2^{80}$ collision resistance, matching `MakerTraitsLib.sol`.
2. **Dual-Tier Resolver Access Gate (`OnlyWhitelistOrAccessToken`):**  
   In `FeeTaker._getFeeAmounts`, execution reverts with `OnlyWhitelistOrAccessToken()` unless the taker is whitelisted or holds `_ACCESS_TOKEN.balanceOf(taker) > 0`. Taker identity is strictly bound to `msg.sender` in `OrderMixin` and cannot be spoofed.
3. **Exact Mathematical Revenue Splitting & Zero Token Leakage:**  
   Token conservation was proven across multiple randomized and fuzz parameters: $\text{integratorFeeAmount} + \text{protocolFeeAmount} + \text{receiverAmount} == \text{takingAmount}$ identically. Zero dust remains locked in `FeeTaker`.
4. **Multi-Step Partial Fills Favor Maker:**  
   Due to integer division truncation, aggregate fees across partial fills are equal to or slightly less than a single full fill, delivering any truncated dust directly to the maker.
5. **Fail-Safe Guards:**  
   ETH transfers to rejecting recipients revert with `EthTransferFailed()`. Orders specifying positive fees without routing `order.receiver` to `FeeTaker` revert with `InconsistentFee()`. Orders with zero fees and `order.receiver != FeeTaker` succeed cleanly for authorized callers.

#### Proof of Concept / Reproduction
- 24 unit and integration tests in [`analysis/tests/h16-whitelist-resolver-fees.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/h16-whitelist-resolver-fees.test.js) (passing).

---

## 4. Master Bounty Submission Readiness Matrix (H-17 Audit)

| Finding ID | Title | File & Line Reference | Severity Classification | Immunefi Scope Status | Submission Readiness & Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **LOP-01** | Canonical Permit2 Constant Address Precludes zkSync Era Operation | [`contracts/extensions/Permit2WitnessProxy.sol:22`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/Permit2WitnessProxy.sol#L22) | Low / Operational | **In-Scope Asset / Availability Defect** | **Ready for Submission as Operational Advisory.** Proves cross-chain address mismatch on zkSync Era (`324`). Non-exploitable for funds theft; verified as an availability/interoperability issue with reproduction script. |
| **LOP-02** | Defective Network Object Lookup Bypasses Intended Chain-ID Deployment Guard | [`deploy/deploy-Permit2Proxy.js:15`](file:///d:/limit-order-protocol-research-findings/deploy/deploy-Permit2Proxy.js#L15) | Low / Tooling Defect | **Out-of-Scope (Build/Deploy Tooling)** | **Do NOT Submit.** Explicitly excluded by Immunefi rules ("issues tied strictly to deployment scripts or configuration"). Already patched upstream in PR #433. |
| **LOP-03** | Integer Division Truncation Causes `Panic(0x11)` on Dust Amounts | [`contracts/extensions/RangeAmountCalculator.sol:97-103`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/RangeAmountCalculator.sol#L97-L103) | Informational | **Out-of-Scope (Fail-Safe Revert)** | **Do NOT Submit.** Fail-safe execution halt on dust taking amounts ($\le 173$ wei). Does not cause fund loss, state corruption, or permanent denial of service. |
| **LOP-04** | Contract Maker Rejection Griefs Resolver Gas on Expired Native Order Cancellation | [`contracts/extensions/NativeOrderImpl.sol:154`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/NativeOrderImpl.sol#L154) | Informational | **Out-of-Scope (Self-Griefing Edge Case)** | **Do NOT Submit.** Griefing is strictly isolated to the malicious maker's own clone. Standard off-chain `eth_call` simulation shields resolvers from on-chain reverts. |
| **LOP-C01** | Missing Non-Positive Price Validation in `SafeOrderBuilder` Oracle Scaling | [`contracts/helpers/SafeOrderBuilder.sol:50`](file:///d:/limit-order-protocol-research-findings/contracts/helpers/SafeOrderBuilder.sol#L50) | Closed / Non-Vulnerability | **Out-of-Scope (Defensive Guard Exists)** | **Do NOT Submit.** Downstream protocol guard `OrderMixin.sol:335` strictly reverts with `SwapWithZeroAmount()` or `Panic(0x12)`, preventing token theft. |
| **LOP-C02** | `ApprovalPreInteraction` Signer Cancellation Ineffective On-Chain | [`contracts/extensions/ApprovalPreInteraction.sol:34`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/ApprovalPreInteraction.sol#L34) | Informational / Architectural | **Deprioritized (Self-Fill Recovery)** | **Do NOT Submit.** Self-fill token recovery demonstrated; architectural design of smart contract maker wallet. |
