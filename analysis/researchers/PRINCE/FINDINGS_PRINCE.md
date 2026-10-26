# Individual Findings Register: Prince

This register records all candidate and confirmed security findings identified and verified by Prince during research on the **1inch Limit Order Protocol** (Tag `4.3.4`).

---

## Index of Findings

| Finding ID | Title | Severity | Affected Component | Classification |
| :--- | :--- | :--- | :--- | :--- |
| **LOP-01** | Hardcoded Canonical Address in `Permit2WitnessProxy` Precludes zkSync Support | Low / Operational | [`contracts/extensions/Permit2WitnessProxy.sol:22`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/Permit2WitnessProxy.sol#L22) | Confirmed Non-Security Bug |
| **LOP-02** | Defective Network Object Lookup Bypasses Intended Chain-ID Deployment Guard | Low / Deployment Safety | [`deploy/deploy-Permit2Proxy.js:15`](file:///d:/limit-order-protocol-research-findings/deploy/deploy-Permit2Proxy.js#L15) | Confirmed Non-Security Bug |
| **LOP-03** | Integer Division Truncation Causes `Panic(0x11)` on Dust Amounts in Range Calculator | Informational | [`contracts/extensions/RangeAmountCalculator.sol:84`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/RangeAmountCalculator.sol#L84) | Informational Observation |
| **LOP-04** | Contract Maker Rejection Griefs Resolver Gas on Expired Native Order Cancellation | Informational | [`contracts/extensions/NativeOrderImpl.sol:154`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/NativeOrderImpl.sol#L154) | Informational Observation |

---

## Detailed Findings

### LOP-01: Hardcoded Canonical Address in `Permit2WitnessProxy` Precludes zkSync Support

- **Finding ID:** LOP-01
- **Classification:** Confirmed Non-Security Bug (Operational / Portability Defect)
- **Affected Release:** Git Tag `4.3.4` (commit `0a40e01befff19d925457b55191900fb456c2dd2`) and current `main`
- **Exact Source Location:** [`contracts/extensions/Permit2WitnessProxy.sol:22`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/Permit2WitnessProxy.sol#L22)
  ```solidity
  address private constant _PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
  ```
- **Root Cause & Attacker Prerequisites:**  
  Uniswap's Permit2 contract on zkSync Era resides at `0x0000000000225e31d52dccfb0e770c6a099fa700` because the standard create2 address `0x000...BA3` could not be preserved due to zkSync Era's non-standard bytecode hashing. `Permit2WitnessProxy.sol` hardcodes the canonical Ethereum address as a constant rather than accepting the address dynamically or in its constructor. No attacker prerequisites required; this is an operational deployment defect.
- **Exploit / Execution Path:**  
  1. A maker signs a witness order specifying `Permit2WitnessProxy` on zkSync Era.
  2. A taker or resolver submits the order to `LimitOrderProtocol.fillOrder`.
  3. `Permit2WitnessProxy.witnessPermitTrasnferFrom` is invoked.
  4. The proxy executes an external call to `_PERMIT2` (`0x000000000022D473030F116dDEE9F6B43aC78BA3`).
  5. On zkSync Era, no contract exists at that address; the call reverts (or returns empty data).
- **Violated Security Invariant:** Multi-chain portability; orders signed for in-scope zkSync deployments must route to the active Permit2 instance.
- **Reproduction Steps & Actual Test Evidence:**  
  Automated in [`analysis/tests/lop-deployment-regressions.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/lop-deployment-regressions.test.js):
  ```bash
  node analysis/tests/lop-deployment-regressions.test.js
  ```
  *Output:* `LOP-01 reproduced: witness proxy target differs from the SDK-selected zkSync address.`
- **Concrete Impact & Affected Assets:** Complete denial of service for Permit2 witness orders on zkSync Era. User funds are not lost or stolen.
- **Existing Protections:** `Permit2Proxy.sol` (the non-witness proxy) was updated in PR #413 to accept `address permit2` as constructor argument.
- **Historical Audit & Disclosure Checks:** OpenZeppelin Audit (PR #400 / #413, Feb 10, 2026), Finding M-01. OpenZeppelin identified the issue in `Permit2Proxy.sol`, which was fixed; `Permit2WitnessProxy.sol` was overlooked.
- **Immunefi Scope & Severity Rationale:** Classified as Low / Operational under Immunefi rules. Does not cause direct theft of user funds.
- **Confidence & Remediation:** High confidence. Update `Permit2WitnessProxy.sol` constructor to accept `address permit2` matching `Permit2Proxy.sol`.

---

### LOP-02: Defective Network Object Lookup Bypasses Intended Chain-ID Deployment Guard

- **Finding ID:** LOP-02
- **Classification:** Confirmed Non-Security Bug (Deployment Tooling Defect)
- **Affected Release:** Git Tag `4.3.4`
- **Exact Source Location:** [`deploy/deploy-Permit2Proxy.js:15`](file:///d:/limit-order-protocol-research-findings/deploy/deploy-Permit2Proxy.js#L15)
  ```javascript
  if (networkName in hre.config.networks[networkName] && hre.config.networks[networkName].chainId !== chainId) {
      throw new Error(`network ${networkName} chainId ${hre.config.networks[networkName].chainId} !== ${chainId}`);
  }
  ```
- **Root Cause & Attacker Prerequisites:**  
  The JavaScript `in` operator checks if `networkName` (e.g. `'mainnet'`) is a property inside the object `hre.config.networks[networkName]`. The object contains `{ url: ..., chainId: ... }` and does not contain a property named `'mainnet'`. Thus the condition evaluates to `false` on every network.
- **Exploit / Execution Path:**  
  A deployer runs `hardhat deploy --network arbitrum` against an RPC endpoint that is mistakenly configured for a different chain ID (e.g. Optimism). The guard fails to trigger, deploying the contract to an unintended network.
- **Violated Security Invariant:** Deterministic deployment verification; deploy scripts must abort if the RPC chain ID differs from the Hardhat configuration.
- **Reproduction Steps & Actual Test Evidence:**  
  Automated in [`analysis/tests/lop-deployment-regressions.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/lop-deployment-regressions.test.js):
  ```bash
  node analysis/tests/lop-deployment-regressions.test.js
  ```
  *Output:* `LOP-02 reproduced: current guard=false, corrected guard=true for a mismatched mocked RPC.`
- **Concrete Impact:** Potential misdeployment of Permit2Proxy contracts across mismatched network IDs; wasted deployment gas.
- **Existing Protections:** Deployers manual inspection of transaction broadcasts.
- **Historical Audit & Disclosure Checks:** Resolved upstream in PR #433 / #434 on master.
- **Immunefi Scope & Severity Rationale:** Tooling / deployment script defect; does not affect deployed on-chain smart contract bytecode.
- **Confidence & Remediation:** 100% confidence. Correct the check to `networkName in hre.config.networks && hre.config.networks[networkName].chainId !== chainId`.

---

### LOP-03: Integer Division Truncation Causes `Panic(0x11)` on Dust Amounts

- **Finding ID:** LOP-03
- **Classification:** Informational Observation (Arithmetic Edge Case)
- **Affected Release:** Tag `4.3.4` and HEAD
- **Exact Source Location:** [`contracts/extensions/RangeAmountCalculator.sol:84`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/RangeAmountCalculator.sol#L84)
- **Root Cause:**  
  In `_getRangeMakerAmount`, when `takingAmount` is extremely small (1–10 wei), integer division truncation causes `sqrt / k` to compute to a value slightly greater than `(bDivK + alreadyFilled)`. In Solidity 0.8+, this causes an unchecked arithmetic underflow revert: `Panic(0x11)`.
- **Violated Security Invariant:** Graceful execution; transactions revert rather than returning zero or overflowing.
- **Reproduction Steps & Actual Test Evidence:**  
  Tested in [`analysis/tests/pricing-and-calculators.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/pricing-and-calculators.test.js):
  `reverts with Panic 0x11 when integer truncation causes sqrt to underflow bDivK + alreadyFilled (dust taking amounts)` (Passing).
- **Concrete Impact:** Fail-safe revert. Dust taker fills revert; no user funds are lost or stolen.
- **Immunefi Scope:** Informational / non-critical.

---

### LOP-04: Contract Maker Rejection Griefs Resolver Gas on Expired Native Order Cancellation

- **Finding ID:** LOP-04
- **Classification:** Informational Observation (Griefing Edge Case)
- **Affected Release:** Tag `4.3.4` and HEAD
- **Exact Source Location:** [`contracts/extensions/NativeOrderImpl.sol:154`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/NativeOrderImpl.sol#L154)
- **Root Cause:**  
  `AddressLib.sendNative(ethRecipient, balance)` makes a raw ETH transfer to the maker contract. If the contract maker reverts or runs out of gas, the entire cancellation reverts.
- **Reproduction Steps & Actual Test Evidence:**  
  Tested in [`analysis/tests/native-order-cancellation.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/native-order-cancellation.test.js) across 6 scenarios:
  `Scenario C (Rejecting Maker): Resolver cancellation reverts, rewards blocked, order remains active` (Passing).
- **Concrete Impact:** Resolver gas griefing; strictly isolated to maker's own EIP-1167 clone.
- **Immunefi Scope:** Informational. Off-chain resolvers simulate via `eth_call` before broadcast.
