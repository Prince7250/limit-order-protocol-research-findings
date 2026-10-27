# Researcher Status: Satyam

## 1. Current Assignment & Hypotheses

| Property | Value |
| :--- | :--- |
| **Researcher** | Satyam (Co-Researcher) |
| **Active Hypotheses** | **H-10: SafeOrderBuilder Oracle Validation & Volatility Math (LOP-C01)** — *Completed*<br/>**H-11: Order Registrators, Predicates & Nonce Managers** — *Completed*<br/>**H-12: ApprovalPreInteraction cancellation-state identity mismatch** — *Investigated candidate; reproduced locally; deprioritized for bounty submission*<br/>**H-13: FeeTaker and AmountGetterWithFee fee-accounting invariants** — *Proposed; not yet investigated; no vulnerability or impact established* |
| **Domain** | Helper Contracts, Gnosis Safe Integrations, Oracle Price Scaling, Predicates, Fee Taking Extensions |
| **Target Release** | Git Tag `4.3.4` (Commit `0a40e01befff19d925457b55191900fb456c2dd2`) |
| **Task Status** | **Completed and supported by evidence** (H-10 & H-11 completed; H-12 closed/deprioritized; H-13 proposed) |
| **Contribution Status** | **Active** (Empirical verification tests passing for H-10, H-11, and H-12) |

---

## 2. Source Files & Function Coverage

| File | Target Functions | Prior Investigation | Formal Task Status | Notes & Invariant Checks |
| :--- | :--- | :--- | :--- | :--- |
| [`contracts/helpers/SafeOrderBuilder.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/helpers/SafeOrderBuilder.sol) | `buildAndSignOrder`, `_getMessageHash` | Code inventory & source trace | **Completed and supported by evidence** (H-10) | Verified missing `latestAnswer > 0` validation. Empirically proved that `OrderMixin.sol:335` strictly rejects zero-amount fills with `SwapWithZeroAmount()` or `Panic(0x12)`. Uncompensated token theft is refuted. |
| [`contracts/extensions/ChainlinkCalculator.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/extensions/ChainlinkCalculator.sol) | `_getSpreadedAmount`, `doublePrice` | H-03 (Verified by Prince) | **Completed and supported by evidence** | Baseline comparison: ChainlinkCalculator's `SafeCast` negative price revert vs SafeOrderBuilder's unchecked cast. |
| [`contracts/helpers/OrderRegistrator.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/helpers/OrderRegistrator.sol) | `registerOrder`, `announcedAt` | Code inventory & diff review | **Completed and supported by evidence** (H-11) | Verified single-announcement invariant, duplicate rejection (`OrderAlreadyRegistered`), and relayer-friendly permissionless relay semantics. |
| [`contracts/helpers/PredicateHelper.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/helpers/PredicateHelper.sol) | `arbitraryStaticCall`, `or`, `and`, `eq`, `lt`, `gt` | Code inventory review | **Completed and supported by evidence** (H-11) | Verified `returndatasize() == 32` check, fail-closed behavior on EOA or malformed returns, `not()` fail-closed semantics, and calldata slicing bounds. |
| [`contracts/helpers/SeriesNonceManager.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/helpers/SeriesNonceManager.sol) | `timestampBelowAndNonceEquals`, `advanceNonce` | Code inventory review | **Completed and supported by evidence** (H-11) | Verified 256-bit packing/unpacking accuracy across account, series, nonce, and expiration. Advance increment bounded to [1..255]. |
| [`contracts/helpers/SeriesEpochManager.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/helpers/SeriesEpochManager.sol) | `epochEquals`, `advanceEpoch` | H-08 (Cancellation verified) | **Completed and supported by evidence** | Key packing `uint160(maker) | (series << 160)` verified. `OrderMixin.sol:287` bit invalidator incompatibility conflict check verified. |
| [`contracts/extensions/ApprovalPreInteraction.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/extensions/ApprovalPreInteraction.sol) | `preInteraction`, `isValidSignature` | Code inventory & H-12 audit | **Investigated candidate; reproduced locally; deprioritized for bounty submission** | Five Hardhat EVM integration tests passed. Under tested conditions, standard cancellation, bit invalidation, and epoch advancement by signing user did not invalidate extension-maker order; separate taker could fill it. Self-fill recovery demonstrated locally (recovery not guaranteed if another taker fills first). Suspected root cause: cancellation state written under `msg.sender` while settlement checks `order.maker`. Bounty eligibility and qualifying impact unverified; no confirmed bounty severity assigned. Test evidence preserved. |
| [`contracts/extensions/AmountGetterWithFee.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/extensions/AmountGetterWithFee.sol) | `_getMakingAmount`, `_getTakingAmount`, `_parseFeeData`, `_isWhitelistedGetterImpl` | Initial review | **Proposed; not yet investigated; no vulnerability or impact established** (H-13) | Research question: Can a valid order or partial fill cause the amount collected by `AmountGetterWithFee` to be insufficient for the distributions performed by `FeeTaker`? Planned first step: Trace formulas, rounding directions, fee limits, and transfer amounts, then compare calculations with existing tests. |
| [`contracts/extensions/FeeTaker.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/extensions/FeeTaker.sol) | `postInteraction`, `_postInteraction`, `_getFeeAmounts`, `_sendEth`, `rescueFunds` | Initial review | **Proposed; not yet investigated; no vulnerability or impact established** (H-13) | Relevant to H-13 fee collection, `_sendEth` transfers, recipient routing, and post-interaction distributions. |
| [`contracts/OrderMixin.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/OrderMixin.sol) | lines 407-428 (`needUnwrap`, `order.getReceiver()`, postInteraction) | Initial review | **Context for H-13** | Relevant to taker asset routing and interaction invocations. |
| [`test/FeeTaker.js`](file:///c:/Users/satya/limit-order-protocol-research-findings/test/FeeTaker.js) | Test scenarios and fee calculations | Initial review | **Context for H-13** | Baseline test cases for fee collection, whitelist discounts, and receiver routing. |

---

## 3. Test Validation Summary & Environment Distinction

| Test File | Framework / Runner | Actual Command | Exit Code | Result | Coverage Scope |
| :--- | :--- | :--- | :--- | :--- | :--- |
| [`analysis/tests/h10-safe-order-builder-standalone.test.js`](file:///c:/Users/satya/limit-order-protocol-research-findings/analysis/tests/h10-safe-order-builder-standalone.test.js) | Standalone Node.js (BigInt / `assert/strict`) | `node analysis/tests/h10-safe-order-builder-standalone.test.js` | **0** | **8 passing** | Math.mulDiv scaling, zero oracle answer, negative answer overflow/truncation, `SwapWithZeroAmount` invariant. |
| [`analysis/tests/h11-predicate-registrator-standalone.test.js`](file:///c:/Users/satya/limit-order-protocol-research-findings/analysis/tests/h11-predicate-registrator-standalone.test.js) | Standalone Node.js (BigInt / `assert/strict`) | `node analysis/tests/h11-predicate-registrator-standalone.test.js` | **0** | **11 passing** | Predicate calldata slicing, vacuous truth, `returndatasize() == 32`, announcement lifecycle, nonce packing. |
| [`analysis/tests/safe-order-builder-and-predicates.test.js`](file:///c:/Users/satya/limit-order-protocol-research-findings/analysis/tests/safe-order-builder-and-predicates.test.js) | Hardhat / Mocha / Chai | `node analysis/tests/safe-order-builder-and-predicates.test.js` | **1** | **Unexecuted (Missing `node_modules`)** | Complete on-chain integration harness for Gnosis Safe, OrderRegistrator, and PredicateHelper. |
| [`analysis/tests/h12-approval-preinteraction-standalone.test.js`](file:///c:/Users/satya/limit-order-protocol-research-findings/analysis/tests/h12-approval-preinteraction-standalone.test.js) | Standalone Node.js (BigInt / `assert/strict`) | `node analysis/tests/h12-approval-preinteraction-standalone.test.js` | **0** | **4 passing** | State-machine model of `cancelOrder`, `advanceEpoch`, partial-fill signature bypass, and self-fill token recovery. |
| [`analysis/tests/h12-approval-preinteraction-cancellation.test.js`](file:///c:/Users/satya/limit-order-protocol-research-findings/analysis/tests/h12-approval-preinteraction-cancellation.test.js) | Hardhat / Mocha / Chai | `yarn test:ci` / Hardhat | **0** | **5 passing** | Full Solidity integration test suite: EOA control, cancellation mismatch, bit invalidation mismatch, epoch invalidation mismatch, self-fill recovery. |

---

## 4. Key Findings Summary

1. **H-10 / LOP-C01:**
   Missing `latestAnswer > 0` validation in `SafeOrderBuilder` can cause orders to be signed with `takingAmount = 0` (maker oracle = 0) or unfillable taking amounts (negative answers). However, uncompensated theft of maker assets is impossible: `OrderMixin.sol:335` strictly reverts with `SwapWithZeroAmount()` or `Panic(0x12)`.
2. **H-11 PredicateHelper & OrderRegistrator:**
   All helper contracts implement strict fail-closed security. `_staticcallForUint` prevents phantom boolean evaluations from non-contracts or short data. `OrderRegistrator` cleanly protects against duplicate registrations. `SeriesNonceManager` accurately packs and bounds nonces.
3. **H-12 ApprovalPreInteraction cancellation-state identity mismatch:**
   Investigated candidate; reproduced locally; deprioritized for bounty submission. Five Hardhat EVM integration tests passed. Under tested conditions, standard cancellation, bit invalidation, and epoch advancement by the signing user did not invalidate the extension-maker order; a separate taker could fill it. A self-fill recovery path was demonstrated locally, but recovery is not guaranteed if another taker fills first. Suspected root cause: cancellation state is written under `msg.sender`, while settlement checks invalidation against `order.maker`. Bounty eligibility and qualifying impact remain unverified. No confirmed bounty severity. All existing test evidence preserved without modifying production contracts.
4. **H-13 FeeTaker and AmountGetterWithFee fee-accounting invariants:**
   Proposed next investigation; not yet investigated; no vulnerability or impact established. Relevant files: `contracts/extensions/AmountGetterWithFee.sol`, `contracts/extensions/FeeTaker.sol`, `contracts/OrderMixin.sol`, and `test/FeeTaker.js`. Research question: Can a valid order or partial fill cause the amount collected by `AmountGetterWithFee` to be insufficient for the distributions performed by `FeeTaker`? Planned first step: Trace the formulas, rounding directions, fee limits, and transfer amounts, then compare the calculations with existing tests.
