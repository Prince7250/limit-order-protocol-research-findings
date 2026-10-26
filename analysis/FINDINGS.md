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
- **Target File:** [`contracts/extensions/RangeAmountCalculator.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/RangeAmountCalculator.sol#L84)
- **Lines:** 84
- **Audited Under:** Hypothesis H-03

#### Description
In `RangeAmountCalculator._getRangeMakerAmount`, the contract solves for the maker amount along an quadratic price curve using:
```solidity
uint256 sqrt = (b2 + 2 * k * takingAmount).sqrt();
return (bDivK + alreadyFilled) - sqrt / k;
```
When `takingAmount` is extremely small (dust wei, e.g. 1–10 wei), integer division truncation causes `sqrt / k` to compute to a value slightly greater than `(bDivK + alreadyFilled)`. In Solidity 0.8+, this causes an unchecked arithmetic underflow revert: `Panic(0x11) (Arithmetic over/underflow)`.

#### Impact
Dust taker fills on range-bound orders revert rather than executing. This represents a fail-safe revert and cannot be exploited to steal funds or bypass rounding invariants.

#### Proof of Concept / Reproduction
Verified in `analysis/tests/pricing-and-calculators.test.js`:
`reverts with Panic 0x11 when integer truncation causes sqrt to underflow bDivK + alreadyFilled (dust taking amounts)`.

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

- **Severity:** Candidate / Under Review
- **Target File:** [`contracts/helpers/SafeOrderBuilder.sol`](file:///d:/limit-order-protocol-research-findings/contracts/helpers/SafeOrderBuilder.sol#L50)
- **Lines:** 48–60
- **Lead Researcher:** Satyam (Assigned under H-10)

#### Hypothesis
In `SafeOrderBuilder.sol`:
```solidity
(, int256 latestAnswer,, uint256 updatedAt,) = makerAssetOracleParams.oracle.latestRoundData();
if (updatedAt + makerAssetOracleParams.ttl < block.timestamp) revert StaleOraclePrice();
order.takingAmount = order.takingAmount.mulDiv(uint256(latestAnswer), makerAssetOracleParams.originalAnswer);
```
Contrast with `ChainlinkCalculator.sol:14` which uses `using SafeCast for int256;` to guarantee `int256` answers are non-negative. If a Chainlink aggregator returns `latestAnswer <= 0`, casting directly to `uint256` treats negative numbers as `~2^256 - 1` or zero. Testing is queued to determine whether this can lead to invalid order parameters signed by a Gnosis Safe.
