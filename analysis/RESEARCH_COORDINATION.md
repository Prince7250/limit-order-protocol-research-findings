# Limit Order Protocol — Research Coordination Ledger

## 1. Project Context & Scope

| Field | Verified Value |
| :--- | :--- |
| **Target Bug Bounty Release** | Git Tag `4.3.4` |
| **Target Release Commit** | `0a40e01befff19d925457b55191900fb456c2dd2` |
| **Active Local Workspace** | `D:\limit-order-protocol-research-findings` |
| **Research Repository** | [`https://github.com/Prince7250/limit-order-protocol-research-findings`](https://github.com/Prince7250/limit-order-protocol-research-findings) |
| **Upstream Repository** | [`https://github.com/1inch/limit-order-protocol.git`](https://github.com/1inch/limit-order-protocol.git) |
| **Core Protocol Parity** | Byte-for-byte identical between tag `4.3.4` and workspace HEAD across all 14 core settlement contracts |
| **Active Git Branch** | `main` (clean working tree, up to date with `origin/main`) |

---

## 2. Comprehensive Task & Hypothesis Assessment

| Item ID | Topic / Component | Owner | Formal Status | Evidence & Test Verification |
| :--- | :--- | :--- | :--- | :--- |
| **H-01** | Fee-on-transfer / rebasing token balance inflation | Prince | **Closed based on documented evidence** | Immunefi program rules explicitly exclude fee-on-transfer/rebasing tokens; analyzed in `analysis/06-security-review.md`. |
| **H-02** | Extension parser non-monotonic offset underflow | Prince | **Closed based on documented evidence** | Proved EVM out-of-gas revert via memory expansion; verified by 9 tests in `analysis/tests/extension-parser-boundaries.test.js`. |
| **H-03** | Pricing, calculators & dynamic amount getters | Prince | **Completed and supported by evidence** | Proved strict ceil-rounding favoring maker; identified `Panic(0x11)` on dust in `RangeAmountCalculator` (LOP-03); 21 tests in `analysis/tests/pricing-and-calculators.test.js`. |
| **H-04** | Native-order clone cancellation callbacks & griefing | Prince | **Completed and supported by evidence** | Proved resolver gas griefing in `NativeOrderImpl.sol:154` (LOP-04) is strictly isolated to maker clone; 6 tests in `analysis/tests/native-order-cancellation.test.js`. |
| **H-05** | Governance trust model & pause sovereignty | Prince | **Closed based on documented evidence** | Proved maker cancellations remain 100% operational during pause; non-custodial design verified. |
| **H-06** | Cross-component settlement & authorization invariants | Prince | **Completed and supported by evidence** | Proved CEI ordering, reentrancy fill caps, rollback atomicity, and extension immutability; 6 tests in `analysis/tests/cross-component-invariants.test.js`. |
| **H-07** | Permit2 & Permit2WitnessProxy signature and nonces | Prince | **Completed and supported by evidence** | Verified single-use nonce partial fill limit (OZ L-02) and identified zkSync address discrepancy (LOP-01); 15 tests in `analysis/tests/permit2-signature-and-nonce.test.js`. |
| **H-08** | Signed order authorization vs actual settlement | Prince | **Completed and supported by evidence** | Proved 80-bit sender check, expiration, epoch cancellations, receiver routing, ETH refund, and reentrancy detection; 16 tests in `analysis/tests/order-authorization-and-settlement.test.js`. |
| **LOP-01** | Hardcoded address in `Permit2WitnessProxy.sol:22` | Prince | **Completed and supported by evidence** | Confirmed address discrepancy against zkSync deployment; reproduced in `analysis/tests/lop-deployment-regressions.test.js`. |
| **LOP-02** | Defective network lookup in `deploy/deploy-Permit2Proxy.js:15` | Prince | **Completed and supported by evidence** | Confirmed guard evaluation bug; reproduced in `analysis/tests/lop-deployment-regressions.test.js`. |
| **H-09** | Asset-proxy callbacks & reentrancy (`ERC1155Proxy`, `ERC721ProxySafe`) | Prince | **Partially completed** | Source review complete; test harness `analysis/tests/asset-proxies-and-callbacks.test.js` pending execution. |
| **H-10 / LOP-C01** | `SafeOrderBuilder.sol` non-positive oracle price scaling | Satyam | **Requires additional verification** | Source audit identified protocol guard `OrderMixin.sol:334` (`SwapWithZeroAmount`) preventing zero-payment token extraction. Needs empirical test. |
| **H-11** | Helper predicates & order announcement (`PredicateHelper`, `OrderRegistrator`) | Satyam | **Not started** | Target files identified and diffed; unit testing pending completion of H-10. |
| **Satyam Prior Work** | Historical notes, local branches, or scratch scripts | Satyam | **Blocked / Awaiting Artifacts** | No commits, branches, or notes present in local checkout or Git remotes. Smallest necessary artifact requested. |

---

## 3. Confirmed & Candidate Findings

| Finding ID | Title | Severity | Affected Component | Lead | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **LOP-01** | Hardcoded Canonical Address in `Permit2WitnessProxy` Precludes zkSync Support | Low / Operational | [`contracts/extensions/Permit2WitnessProxy.sol:22`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/Permit2WitnessProxy.sol#L22) | Prince | Confirmed; reproduced in `lop-deployment-regressions.test.js` |
| **LOP-02** | Defective Network Object Lookup Bypasses Intended Chain-ID Deployment Guard | Low / Tooling | [`deploy/deploy-Permit2Proxy.js:15`](file:///d:/limit-order-protocol-research-findings/deploy/deploy-Permit2Proxy.js#L15) | Prince | Confirmed; reproduced in `lop-deployment-regressions.test.js` |
| **LOP-03** | Integer Division Truncation Causes `Panic(0x11)` on Dust Amounts | Informational | [`contracts/extensions/RangeAmountCalculator.sol:84`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/RangeAmountCalculator.sol#L84) | Prince | Confirmed (Fail-safe); reproduced in `pricing-and-calculators.test.js` |
| **LOP-04** | Contract Maker Rejection Griefs Resolver Gas on Expired Native Order Cancellation | Informational | [`contracts/extensions/NativeOrderImpl.sol:154`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/NativeOrderImpl.sol#L154) | Prince | Confirmed (Isolated); reproduced in `native-order-cancellation.test.js` |
| **LOP-C01** | Missing Non-Positive Price Validation in `SafeOrderBuilder` Oracle Scaling | Candidate | [`contracts/helpers/SafeOrderBuilder.sol:50, 58`](file:///d:/limit-order-protocol-research-findings/contracts/helpers/SafeOrderBuilder.sol#L50) | Satyam | Under Review; bounded by `SwapWithZeroAmount()` |

---

## 4. Work Allocation & Recommended Next Actions

### Prince: Execute H-09 (Asset-Proxy Callbacks & Reentrancy)
- **Target:** [`contracts/extensions/ERC1155Proxy.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/ERC1155Proxy.sol), [`contracts/extensions/ERC721ProxySafe.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/ERC721ProxySafe.sol), [`contracts/OrderMixin.sol`](file:///d:/limit-order-protocol-research-findings/contracts/OrderMixin.sol).
- **Rationale:** Prince has completed the foundational settlement invariant suite (H-06..H-08). Testing `onERC1155Received` and `onERC721Received` hooks against `_fill`'s remaining invalidator lock will determine whether safe transfer hooks permit reentrancy or state desynchronization.
- **Deliverable:** `analysis/tests/asset-proxies-and-callbacks.test.js`.

### Satyam: Execute H-10 / LOP-C01 (SafeOrderBuilder Invariant Testing)
- **Target:** [`contracts/helpers/SafeOrderBuilder.sol`](file:///d:/limit-order-protocol-research-findings/contracts/helpers/SafeOrderBuilder.sol), [`contracts/OrderMixin.sol:334`](file:///d:/limit-order-protocol-research-findings/contracts/OrderMixin.sol#L334).
- **Rationale:** Verify whether the lack of `latestAnswer > 0` validation can result in an executable zero-amount swap or whether `LimitOrderProtocol` unconditionally reverts with `SwapWithZeroAmount()`.
- **Deliverable:** `analysis/tests/safe-order-builder-and-predicates.test.js`.
- **Dependency:** Satyam to provide any prior branch name, commit hash, or draft notes to incorporate historical attribution.
