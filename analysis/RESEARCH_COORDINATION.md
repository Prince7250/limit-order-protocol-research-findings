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
| **Active Git Branch** | `main` (clean working tree, up to date with `origin/main` at commit `0856854`) |

---

## 2. Research Team Ownership & Assignment Map

| Researcher | Role | Primary Domain | Active / Next Hypothesis | Assigned Target Files | Test Evidence Files |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Prince** | Primary Researcher (Lead) | Asset Proxies, Pre/Post-Interactions, Callbacks, Whitelists, Core Settlement Invariants | **H-09** (*Completed*)<br/>**H-14** (*Completed*)<br/>**H-15** (*Completed*)<br/>**H-16** (*Completed*)<br/>**H-17** (*Completed*) | `contracts/extensions/ERC1155Proxy.sol`<br/>`contracts/extensions/ERC721ProxySafe.sol`<br/>`contracts/extensions/ERC721Proxy.sol`<br/>`contracts/extensions/OrderIdInvalidator.sol`<br/>`contracts/extensions/PrioirityFeeLimiter.sol`<br/>`contracts/extensions/RangeAmountCalculator.sol`<br/>`contracts/libraries/AmountCalculatorLib.sol`<br/>`contracts/extensions/AmountGetterWithFee.sol`<br/>`contracts/extensions/FeeTaker.sol` | [`analysis/tests/asset-proxies-and-callbacks.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/asset-proxies-and-callbacks.test.js) (10 tests)<br/>[`analysis/tests/h14-order-id-invalidator.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/h14-order-id-invalidator.test.js) (9 tests)<br/>[`analysis/tests/h14-priority-fee-limiter.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/h14-priority-fee-limiter.test.js) (14 tests)<br/>[`analysis/tests/h15-range-amount-calculator.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/h15-range-amount-calculator.test.js) (18 tests)<br/>[`analysis/tests/h16-whitelist-resolver-fees.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/h16-whitelist-resolver-fees.test.js) (24 tests) |
| **Satyam** | Co-Researcher | Helper Contracts, Safe Integrations, Oracle Scaling, Predicates, Fee Extensions | **H-10** (*Completed*)<br/>**H-11** (*Completed*)<br/>**H-12** (*Completed/Deprioritized*)<br/>**H-13** (*Next: FeeTaker & AmountGetterWithFee*) | `contracts/helpers/SafeOrderBuilder.sol`<br/>`contracts/helpers/OrderRegistrator.sol`<br/>`contracts/helpers/PredicateHelper.sol`<br/>`contracts/extensions/ApprovalPreInteraction.sol`<br/>`contracts/extensions/AmountGetterWithFee.sol`<br/>`contracts/extensions/FeeTaker.sol` | `h10-safe-order-builder-standalone.test.js` (8 tests)<br/>`h11-predicate-registrator-standalone.test.js` (11 tests)<br/>`h12-approval-preinteraction-cancellation.test.js` (5 tests) |

---

## 3. Master Hypothesis Status Registry

| Hypothesis ID | Title / Research Topic | Owner | Formal Status | Key Findings / Resolution Summary | Supporting Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **H-01** | Fee-on-transfer / rebasing token balance inflation | Prince | **Closed (Out of Scope)** | Verified balance tracking; fee-on-transfer and rebasing tokens explicitly excluded by Immunefi program rules. | `analysis/PROGRESS.md` |
| **H-02** | Extension parser non-monotonic offset underflow | Prince | **Closed (Refuted)** | Memory expansion costs cause immediate EVM Out-Of-Gas revert before underflowed length can be read. | `analysis/tests/extension-parser-boundaries.test.js` (9 tests) |
| **H-03** | Pricing, calculators & dynamic amount getters | Prince | **Completed and supported by evidence** | Linear math strictly ceil-rounds favoring maker. Identified `Panic(0x11)` underflow on dust in `RangeAmountCalculator` (LOP-03). | `analysis/tests/pricing-and-calculators.test.js` (21 tests) |
| **H-04** | Native-order clone cancellation callbacks & griefing | Prince | **Completed and supported by evidence** | Contract maker rejecting ETH griefs resolver gas on expired order; strictly isolated to maker clone (LOP-04). | `analysis/tests/native-order-cancellation.test.js` (6 tests) |
| **H-05** | Governance trust model & pause sovereignty | Prince | **Closed (Verified Defensive)** | Pausing disables fills but all maker cancellations remain 100% operational. Protocol is non-custodial. | `analysis/06-security-review.md` |
| **H-06** | Cross-component settlement & authorization invariants | Prince | **Completed and supported by evidence** | CEI pattern verified; reentrancy fill amounts capped; settlement default rolls back atomically. | `analysis/tests/cross-component-invariants.test.js` (6 tests) |
| **H-07** | Permit2 & Permit2WitnessProxy signature and nonces | Prince | **Completed and supported by evidence** | Single-use nonces preclude multi-tx partial fills (OZ L-02). Identified zkSync address mismatch in `Permit2WitnessProxy` (LOP-01). | `analysis/tests/permit2-signature-and-nonce.test.js` (15 tests) |
| **H-08** | Signed order authorization vs actual settlement | Prince | **Completed and supported by evidence** | 80-bit sender check, expiration, custom routing, slippage limits, and `makerPermit` reentrancy detection verified. | `analysis/tests/order-authorization-and-settlement.test.js` (16 tests) |
| **H-09** | Asset-proxy callbacks & reentrancy (`ERC1155Proxy`, `ERC721ProxySafe`) | Prince | **Completed and supported by evidence** | CEI state invalidation occurs before asset callbacks; single-fill reentrancy blocked with `BitInvalidatedOrder()`; callback failures roll back atomically. | `analysis/tests/asset-proxies-and-callbacks.test.js` (10 tests) |
| **H-10 / LOP-C01** | `SafeOrderBuilder.sol` non-positive oracle price scaling | Satyam | **Completed and supported by evidence** | Proved `OrderMixin.sol:335` strictly reverts with `SwapWithZeroAmount()` or `Panic(0x12)`, preventing zero-payment token theft. | `h10-safe-order-builder-standalone.test.js` (8 tests) |
| **H-11** | Helper predicates & order announcement (`PredicateHelper`, `OrderRegistrator`) | Satyam | **Completed and supported by evidence** | Verified 32-byte returndata checks, fail-closed boolean evaluation, and duplicate announcement protection. | `h11-predicate-registrator-standalone.test.js` (11 tests) |
| **H-12** | `ApprovalPreInteraction` cancellation-state identity mismatch | Satyam | **Completed (Deprioritized)** | Signer cancellation does not invalidate extension-maker order on-chain; self-fill token recovery demonstrated; deprioritized for bounty submission. | `h12-approval-preinteraction-cancellation.test.js` (5 tests) |
| **H-13** | `FeeTaker` & `AmountGetterWithFee` fee-accounting invariants | Satyam | **Proposed / Next** | Investigate fee calculation, rounding direction, and integrator/protocol fee distributions. | Planned |
| **H-14** | `OrderIdInvalidator` dust-lock griefing & `PriorityFeeLimiter` L2 underflow | Prince | **Completed and supported by evidence** | Permanent `orderId` hash binding proved; dust-fill lock verified; fail-closed underflow invariant proven (`isPriorityFeeValid` returns false). | [`analysis/tests/h14-order-id-invalidator.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/h14-order-id-invalidator.test.js) (9 tests)<br/>[`analysis/tests/h14-priority-fee-limiter.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/h14-priority-fee-limiter.test.js) (14 tests) |
| **H-15** | `RangeAmountCalculator` square-root precision & underflow boundaries | Prince | **Completed and supported by evidence** | Mathematical proof and unit tests confirm maker-favoring rounding, `SwapWithZeroAmount` dust guard, and exact arithmetic mechanism behind `Panic(0x11)` at lines 97–103. | [`analysis/tests/h15-range-amount-calculator.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/h15-range-amount-calculator.test.js) (18 tests) |
| **H-16** | Whitelist discounts & resolver fee structures | Prince | **Completed and supported by evidence** | Verified 80-bit whitelist address masking, dual-tier resolver access gate (`OnlyWhitelistOrAccessToken`), discount numerator math, exact revenue splitting (zero token leakage), WETH unwrapping, and `InconsistentFee` receiver guard. | [`analysis/tests/h16-whitelist-resolver-fees.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/h16-whitelist-resolver-fees.test.js) (24 tests) |
| **H-17** | Comprehensive research synthesis & bounty submission audit | Prince | **Completed and supported by evidence** | Cross-hypothesis synthesis, Immunefi policy mapping, and LOP-01..LOP-04 audit complete. Verified zero critical/high funds theft vulnerabilities; LOP-01 classified as Low / Operational advisory. | Master Research Archive |

---

## 4. Confirmed & Candidate Findings

| Finding ID | Title | Severity | Affected Component | Lead | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **LOP-01** | Hardcoded Canonical Address in `Permit2WitnessProxy` Precludes zkSync Support | Low / Operational | [`contracts/extensions/Permit2WitnessProxy.sol:22`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/Permit2WitnessProxy.sol#L22) | Prince | Confirmed; reproduced in `lop-deployment-regressions.test.js`; submission-ready operational advisory |
| **LOP-02** | Defective Network Object Lookup Bypasses Intended Chain-ID Deployment Guard | Low / Tooling | [`deploy/deploy-Permit2Proxy.js:15`](file:///d:/limit-order-protocol-research-findings/deploy/deploy-Permit2Proxy.js#L15) | Prince | Confirmed; reproduced in `lop-deployment-regressions.test.js`; excluded as tooling script; patched in PR #433 |
| **LOP-03** | Integer Division Truncation Causes `Panic(0x11)` on Dust Amounts | Informational | [`contracts/extensions/RangeAmountCalculator.sol:97-103`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/RangeAmountCalculator.sol#L97-L103) | Prince | Confirmed (Fail-safe); reproduced in `pricing-and-calculators.test.js` & `h15-range-amount-calculator.test.js`; excluded as fail-safe revert |
| **LOP-04** | Contract Maker Rejection Griefs Resolver Gas on Expired Native Order Cancellation | Informational | [`contracts/extensions/NativeOrderImpl.sol:154`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/NativeOrderImpl.sol#L154) | Prince | Confirmed (Isolated); reproduced in `native-order-cancellation.test.js`; excluded as self-griefing |
| **LOP-C01** | Missing Non-Positive Price Validation in `SafeOrderBuilder` Oracle Scaling | Closed / Non-Vulnerability | [`contracts/helpers/SafeOrderBuilder.sol:50, 58`](file:///d:/limit-order-protocol-research-findings/contracts/helpers/SafeOrderBuilder.sol#L50) | Satyam | Closed; strictly prevented by `SwapWithZeroAmount()` |
| **LOP-C02** | `ApprovalPreInteraction` Signer Cancellation Ineffective On-Chain | Informational / Architectural | [`contracts/extensions/ApprovalPreInteraction.sol:34`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/ApprovalPreInteraction.sol#L34) | Satyam | Investigated; self-fill token recovery demonstrated; deprioritized |

---

## 5. Next Immediate Research Actions

1. **Prince:** Completed H-17 (Comprehensive research synthesis & bounty submission audit). Research cycle concluded; master findings report prepared.
2. **Satyam:** Conclude investigation of Hypothesis H-13 (`FeeTaker.sol` and `AmountGetterWithFee.sol` fee distributions).
2. **Satyam:** Begin investigation of Hypothesis H-13 (`FeeTaker.sol` and `AmountGetterWithFee.sol` fee distributions).
