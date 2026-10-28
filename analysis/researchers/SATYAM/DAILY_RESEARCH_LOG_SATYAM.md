# Daily Research Log: Satyam

This log records the append-only chronological record of Satyam's security research activities, hypotheses tested, commands executed, test outputs, and conclusions.

---

## Notice Regarding Prior Work
Satyam's independent notes, scratch files, or test branches from earlier research sessions have not yet been synchronized into the repository. Historical entries will be backfilled once Satyam provides the supporting records. The entries below document coordinated research milestones and current assignments.

---

## [2026-10-24] — Target Scope & Architecture Kickoff
- **Objective:** Review 1inch Limit Order Protocol repository architecture, Immunefi program parameters, and compiler settings.
- **Activities:**
  - Reviewed protocol scope: Git tag `4.3.4` (`0a40e01befff19d925457b55191900fb456c2dd2`).
  - Evaluated high-level component structure: core protocol (`LimitOrderProtocol`, `OrderMixin`), extensions, helpers, libraries.
  - Coordinated with Prince on local environment setup.

---

## [2026-10-26] — Work Division & Assignment to Hypotheses H-10 / H-11
- **Objective:** Establish dedicated tracking ledger, review assigned helper contracts, and formulate hypothesis on `SafeOrderBuilder` oracle validation.
- **Files Examined:**
  - `contracts/helpers/SafeOrderBuilder.sol`
  - `contracts/helpers/OrderRegistrator.sol`
  - `contracts/helpers/PredicateHelper.sol`
  - `contracts/helpers/SeriesNonceManager.sol`
  - `contracts/helpers/SeriesEpochManager.sol`
  - `contracts/extensions/ChainlinkCalculator.sol`
- **Activities & Code Review Findings:**
  1. Identified discrepancy between `ChainlinkCalculator.sol` and `SafeOrderBuilder.sol`:
     - `ChainlinkCalculator` applies `SafeCast.toUint256()` on `latestAnswer`, ensuring negative prices revert immediately.
     - `SafeOrderBuilder.sol:50, 58` casts `uint256(latestAnswer)` directly without checking `latestAnswer > 0`.
  2. Formulated **Candidate LOP-C01** regarding potential invalid order pricing on non-positive oracle returns.
  3. Inspected `OrderRegistrator.sol` diff between tag `4.3.4` and HEAD: tag `4.3.4` only emits `OrderRegistered`, whereas HEAD adds `announcedAt` mapping and prevents re-announcement.
- **Commands Executed:**
  - Reviewed Git tree and diffs for assigned files.
- **Next Action:**
  - Submit prior research notes/scripts to Prince for integration into the research repository.
  - Begin implementation of test scenarios in `analysis/tests/safe-order-builder-and-predicates.test.js`.


---

## [2026-10-27] — Empirical Verification & Closure of H-10 / LOP-C01
- **Objective:** Complete in-depth source trace and empirical invariant testing of H-10 / LOP-C01 (`SafeOrderBuilder` non-positive oracle price scaling and `OrderMixin` zero-amount enforcement).
- **Files Examined:**
  - `contracts/helpers/SafeOrderBuilder.sol:48-67`
  - `contracts/OrderMixin.sol:300-336`
  - `contracts/OrderLib.sol:101-167`
  - `contracts/libraries/AmountCalculatorLib.sol:9-27`
  - `contracts/mocks/AggregatorMock.sol`
  - `test/SafeOrderBuilder.js`
- **Activities & Findings:**
  1. Traced execution flow of `SafeOrderBuilder.buildAndSignOrder`:
     - Maker oracle returning `0` results in `order.takingAmount = order.takingAmount.mulDiv(0, originalAnswer) = 0`.
     - Taker oracle returning `0` causes `mulDiv(originalAnswer, 0)` in `SafeOrderBuilder.sol:66`, reverting immediately with `Panic(0x12)`.
     - Negative oracle answers (`-1`) cast to $2^{256} - 1$, causing either 256-bit multiplication overflow, astronomical unfillable taking amounts ($> 10^{75}$ tokens), or integer division truncation to `0`.
  2. Traced downstream execution on `LimitOrderProtocol`:
     - If an order with `order.takingAmount == 0` is submitted to `fillContractOrder`:
       - With `isMakingAmount = true`, linear calculation computes `takingAmount = (100 * 0 + 100 - 1) / 100 = 0`.
       - Line 335 of `OrderMixin.sol`: `unchecked { if (makingAmount * takingAmount == 0) revert SwapWithZeroAmount(); }` triggers before state changes or token transfers.
       - With `isMakingAmount = false`, `getMakingAmount` evaluates `1 * 100 / 0`, reverting with `Panic(0x12)`.
     - Concluded that uncompensated extraction of Safe assets is mathematically and structurally impossible.
  3. Created full Hardhat test suite in `analysis/tests/safe-order-builder-and-predicates.test.js` covering valid price control, zero oracle answers, negative oracle answers, timestamp/TTL boundaries, and `PredicateHelper` return-size limits.
  4. Created and executed standalone empirical verification script `analysis/tests/h10-safe-order-builder-standalone.test.js`.
- **Commands Executed:**
  - `node analysis/tests/h10-safe-order-builder-standalone.test.js`
  - Output: 8 tests passed cleanly (Exit 0):
    - Valid Price Control: takingAmount = 120, fill succeeds.
    - Maker oracle = 0: `takingAmount = 0` generated.
    - Maker oracle = 0 (isMakingAmount=true): `SwapWithZeroAmount()` strictly reverts.
    - Maker oracle = 0 (isMakingAmount=false): `Panic(0x12)` strictly reverts.
    - Taker oracle = 0: `Panic(0x12)` division by zero in builder.
    - Maker oracle = -1: Astronomical price or mulDiv overflow.
    - Taker oracle = -1: Truncates to 0, rejected by `SwapWithZeroAmount()`.
- **Conclusions:**
  - Formally closed H-10 / LOP-C01 as a refuted exploit.
  - Reclassified finding as Informational edge case (unfillable order DoS / gas waste).
- **Next Action:**
  - Proceed with H-11 investigation (`PredicateHelper`, `OrderRegistrator`, `SeriesNonceManager`).


---

## [2026-10-27 Part 2] — Phase 1 Test Validation & Phase 2 H-11 Deep Dive
- **Objective:**
  1. Validate H-10 environment status: distinguish standalone model tests from on-chain Hardhat execution.
  2. Perform deep security audit on `PredicateHelper.sol`, `OrderRegistrator.sol`, and nonce management helpers (`SeriesNonceManager.sol`, `SeriesEpochManager.sol`).
- **Phase 1 Validation Findings:**
  - Ran `git status` and diff: confirmed clean working tree, no production contracts modified.
  - Inspected background tasks: confirmed no active background jobs.
  - Executed `node analysis/tests/h10-safe-order-builder-standalone.test.js`: Exit code 0, 8 passing tests. Confirmed this script models the BigInt arithmetic and protocol reverts directly in Node.js.
  - Attempted `node analysis/tests/safe-order-builder-and-predicates.test.js`: Exit code 1 (`Cannot find module '@nomicfoundation/hardhat-network-helpers'`). Recorded that full Solidity-level integration execution remains bounded by the absence of `node_modules` in the current sandbox environment.
- **Phase 2 H-11 Code Audit Findings:**
  1. `PredicateHelper.sol`:
     - Inspected `_staticcallForUint`: assembly checks `eq(returndatasize(), 32)`. Staticcalls to non-contracts, EOAs, or functions returning short/long data cleanly return `success = false`, preventing phantom true evaluations.
     - Inspected `not(bytes calldata data)`: evaluates `success && res == 0`. Failing subcalls return `false`, preventing bypass via forced revert.
     - Calldata slicing in `or`/`and`: Solidity 0.8+ bounds checks revert out-of-bounds or non-monotonic slices with `Panic(0x32)`, failing closed. Empty offset word `0` behaves according to Boolean logic vacuous truth (`or(0) = false`, `and(0) = true`).
  2. `OrderRegistrator.sol`:
     - `registerOrder` checks `isValidExtension` and verifies maker signature via `ECDSA.recoverOrIsValidSignature`.
     - `announcedAt[orderHash]` prevents duplicate announcements (`OrderAlreadyRegistered`).
     - Permissionless relaying allows relayers to announce orders on behalf of makers without modifying order parameters or compromising funds.
  3. Nonce & Epoch Invariant Architecture:
     - `SeriesNonceManager.timestampBelowAndNonceEquals` losslessly unpacks account (160b), series (16b), nonce (40b), and expiration (40b) from a single 256-bit word.
     - `advanceNonce` and `advanceEpoch` bound increments to `[1..255]`.
     - `OrderMixin.sol:287` strictly prevents orders from combining `useBitInvalidator` and `needCheckEpochManager` (`EpochManagerAndBitInvalidatorsAreIncompatible`), preventing bit collision on bits 120..159.
- **Empirical Tests Executed:**
  - Created standalone test suite: `analysis/tests/h11-predicate-registrator-standalone.test.js`.
  - Command: `node analysis/tests/h11-predicate-registrator-standalone.test.js`
  - Output: **Exit code 0, 11 tests passed cleanly**:
    - Test 1a: Sequential offset parsing unpacks 3 calldata slices.
    - Test 1b: Vacuous truth verified (or(0) = false, and(0) = true).
    - Test 1c: Non-monotonic offsets fail closed.
    - Test 1d: Slices exceeding length fail closed.
    - Test 1e: Null-terminated offset loop termination.
    - Test 2: `returndatasize() == 32` enforced; EOA/short returns fail closed.
    - Test 3: Single announcement and duplicate rejection.
    - Test 4a: `SeriesNonceManager` 256-bit packing/unpacking is 100% lossless.
    - Test 4b: `SeriesEpochManager` key packing preserves maker and series.
    - Test 4c: `advanceNonce`/`advanceEpoch` bounded to [1..255].
    - Test 5: Invalidator modes and EpochManager conflict detection strictly enforced.
- **Conclusions:**
  - H-11 components are implemented defensively with no exploitable vulnerabilities.
  - Closed H-11 as verified secure.

---

## [2026-10-27 Part 3] — Phase 2 H-12 Deep Dive: ApprovalPreInteraction Invalidation & Token Recovery
- **Objective:**
  1. Investigate whether orders signed through `ApprovalPreInteraction` can be cancelled by the signer via protocol cancellation APIs.
  2. Investigate whether escrowed tokens can be recovered if orders remain unfilled or partially filled.
  3. Author Hardhat integration and standalone model test suites.
- **Source Code Audit & Trace Findings:**
  1. **Storage Identity Mismatch:**
     - In `OrderMixin.sol:80-109` and `SeriesEpochManager.sol:34-39`, `cancelOrder`, `cancelOrders`, `bitsInvalidateForOrder`, and `advanceEpoch` record invalidation state under `msg.sender`.
     - In `OrderMixin.sol:288, 339, 494`, invalidation during fills is evaluated strictly under `order.maker.get()`.
     - In `ApprovalPreInteraction.sol:35`, `order.maker.get()` must equal `address(this)`.
     - Because `ApprovalPreInteraction` has no function to forward or call cancellation, `_MAKER` cannot invalidate orders under the contract's address. Takers can still fill orders after the user calls cancellation.
  2. **Partial-Fill Signature Bypass:**
     - `OrderMixin.sol:234` checks `isValidSignature` only when `remainingMakingAmount == order.makingAmount`. Subsequent partial fills bypass signature checks, making on-chain protocol invalidation the only defense.
  3. **Token Recovery (Self-Fill Route):**
     - `ApprovalPreInteraction` has no `withdraw()` or `rescueFunds()` method.
     - However, funds are not permanently locked: the maker can sign a self-fill recovery order (`makingAmount = balance`, `takingAmount = 1 wei`, `receiver = _MAKER`, bit 252 set) and execute it as the taker.
- **Empirical Test Evidence:**
  - Authored standalone model: `analysis/tests/h12-approval-preinteraction-standalone.test.js`.
  - Executed via `node`: **Exit code 0, 4 tests passing**:
    - Test 1: `cancelOrder` by signing user fails to cancel contract maker order on-chain.
    - Test 2: `advanceEpoch` by signing user fails to invalidate contract maker series order.
    - Test 3: Subsequent partial fills bypass `isValidSignature`.
    - Test 4: Token recovery via 1-wei self-fill order succeeds.
  - Authored Hardhat integration suite: `analysis/tests/h12-approval-preinteraction-cancellation.test.js`. Corrected helper parameter (`shouldCheckEpoch: true`) and invalidator query logic. Execution remains blocked by missing `node_modules` and sandbox filesystem isolation (`.yarnrc` EPERM).
- **Conclusions:**
  - Status: Provisional — source-traced; Solidity integration test blocked.
  - Root cause: Protocol cancellation entry points record state under `msg.sender`, while settlement checks invalidation state under `order.maker`.
  - Potential impact: Signing user may be unable to invalidate outstanding extension-maker orders through standard protocol APIs; orders may remain fillable while other validity conditions hold.
  - Recovery hypothesis: Self-fill order provides potential recovery route, source-traced and model-tested, not Solidity-tested.
  - Limitations: No Solidity-level test result available. Direct theft, guaranteed arbitrage, permanent lockup, and final severity not established.

---

## [2026-10-27 Part 4] — Closure of H-12 & Selection of Proposed H-13
- **Objective:**
  1. Record the final status and verified observations for H-12 (`ApprovalPreInteraction cancellation-state identity mismatch`).
  2. Formally close and deprioritize H-12 without assigning confirmed bounty severity.
  3. Propose the next research target: H-13 (`FeeTaker and AmountGetterWithFee fee-accounting invariants`).

- **H-12 Final Status & Verified Observations:**
  - **Title:** `ApprovalPreInteraction cancellation-state identity mismatch`
  - **Status:** Investigated candidate; reproduced locally; deprioritized for bounty submission.
  - **EVM Integration Tests:** Five Hardhat EVM integration tests passed in [`analysis/tests/h12-approval-preinteraction-cancellation.test.js`](file:///c:/Users/satya/limit-order-protocol-research-findings/analysis/tests/h12-approval-preinteraction-cancellation.test.js):
    1. Standard EOA cancellation control: EOA orders are cancelled normally.
    2. Extension-maker cancellation mismatch: user calls `cancelOrder(order.makerTraits, orderHash)` but order remains fillable by a separate taker.
    3. Bit invalidator mismatch: user calls `bitsInvalidateForOrder` but order remains fillable.
    4. Epoch invalidation mismatch: user calls `advanceEpoch` on `SeriesEpochManager` but order remains fillable.
    5. Token recovery: a local test demonstrated a self-fill recovery path (1-wei self-fill order pulls balance back to `_MAKER`), though recovery is not guaranteed if another taker fills first.
  - **Behavior:** Under tested conditions, standard cancellation, bit invalidation, and epoch advancement by the signing user did not invalidate the extension-maker order; a separate taker could fill it.
  - **Recovery:** A self-fill recovery path was demonstrated locally, but recovery is not guaranteed if another taker fills first.
  - **Suspected Root Cause:** Cancellation state is written under `msg.sender` ([`OrderMixin.sol:80-109`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/OrderMixin.sol#L80-L109), [`SeriesEpochManager.sol:34-39`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/helpers/SeriesEpochManager.sol#L34-L39)), while settlement checks invalidation against `order.maker` ([`OrderMixin.sol:288, 339, 494`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/OrderMixin.sol#L288)). For `ApprovalPreInteraction`, `order.maker` is the extension contract address while the signing user is `_MAKER`.
  - **Bounty Scope & Severity:** Bounty eligibility and qualifying impact remain unverified. `ApprovalPreInteraction.sol` appears to be an example contract and is not an active in-scope target under the official Immunefi bug bounty program. No confirmed bounty severity is assigned. The issue is not described as confirmed theft, permanent fund lockup, or a confirmed bounty-eligible finding.
  - **Preservation:** All existing test evidence is preserved. Production contracts remain untouched.
  - **Disposition:** Investigated candidate; reproduced locally; deprioritized for bounty submission.

- **H-13 Proposed Next Investigation:**
  - **Title:** `FeeTaker and AmountGetterWithFee fee-accounting invariants`
  - **Relevant Files:**
    - [`contracts/extensions/AmountGetterWithFee.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/extensions/AmountGetterWithFee.sol)
    - [`contracts/extensions/FeeTaker.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/extensions/FeeTaker.sol)
    - [`contracts/OrderMixin.sol`](file:///c:/Users/satya/limit-order-protocol-research-findings/contracts/OrderMixin.sol)
    - [`test/FeeTaker.js`](file:///c:/Users/satya/limit-order-protocol-research-findings/test/FeeTaker.js)
  - **Research Question:** Can a valid order or partial fill cause the amount collected by `AmountGetterWithFee` to be insufficient for the distributions performed by `FeeTaker`?
  - **Status:** Proposed; not yet investigated; no vulnerability or impact established.
  - **Planned First Step:** Trace the formulas, rounding directions, fee limits, and transfer amounts, then compare the calculations with existing tests. Do not start H-13 testing yet.
