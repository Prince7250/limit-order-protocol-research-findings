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
