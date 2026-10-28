# Daily Security Research Log

This log maintains an append-only audit trail of security research progress, hypothesis formulation, testing activities, and findings for the 1inch Limit Order Protocol (Immunefi target tag `4.3.4`).

---

## [2026-10-24] — Session Baseline & Infrastructure Setup
**Contributors:** Prince, Satyam

### Activities:
1. Initialized repository baseline in local development environment.
2. Verified Node.js environment, Hardhat configuration, and compiler version (`0.8.30`).
3. Committed baseline agent host checkpoints (`d19b20f`, `2346e96`, `dbc62b5`, `46f108a`, `d53db52`) establishing clean working state on `main`.
4. Verified that official Immunefi bounty target corresponds to Git tag `4.3.4` (`0a40e01befff19d925457b55191900fb456c2dd2`).

---

## [2026-10-26] — Initial Audit Suite, Invariant Verification & Fork Migration
**Contributors:** Prince, Satyam

### Activities (Prince):
1. **Hypothesis Formulation & Verification (H-01 through H-08):**
   - **H-01 (Fee-on-transfer / rebasing tokens):** Evaluated balance checks; confirmed out-of-scope per Immunefi rules.
   - **H-02 (Extension parser offsets):** Evaluated `ExtensionLib` and `OffsetsLib`; proved EVM out-of-gas revert on underflow. (9 tests in `extension-parser-boundaries.test.js`).
   - **H-03 (Pricing and Amount Calculations):** Audited `AmountCalculatorLib`, `RangeAmountCalculator`, `ChainlinkCalculator`, `DutchAuctionCalculator`, `AmountGetterWithFee`, `FeeTaker`. Proved strict ceil-rounding favoring maker across partial fills. Documented `Panic(0x11)` underflow on dust amounts in `RangeAmountCalculator`. (21 tests in `pricing-and-calculators.test.js`).
   - **H-04 (Native-Order Clone Cancellation):** Audited `NativeOrderFactory` and `NativeOrderImpl`. Documented resolver griefing edge case on rejecting contract makers; confirmed isolation to maker clone. (6 tests in `native-order-cancellation.test.js`).
   - **H-05 (Governance / Pausing):** Proved cancellation functions remain 100% operational during pause; non-custodial design verified.
   - **H-06 (Cross-Component Invariants):** Proved CEI progression, reentrancy capping, extension hash immutability on partial fills, and EIP-1271 sovereignty. (6 tests in `cross-component-invariants.test.js`).
   - **H-07 (Permit2 & Permit2WitnessProxy):** Proved EIP-712 typing, domain separation, single-use nonce partial fill constraints (OpenZeppelin L-02), and rollback atomicity. Documented LOP-01 (hardcoded address discrepancy on zkSync). (15 tests in `permit2-signature-and-nonce.test.js`).
   - **H-08 (Authorization vs Settlement):** Proved 80-bit `allowedSender` exclusivity, timestamp expiration, series epoch cancellations, custom receiver routing, native ETH refunding, slippage limits, and `makerPermit` reentrancy detection. (16 tests in `order-authorization-and-settlement.test.js`).
2. **Defect Identification & Reproduction:**
   - **LOP-01:** Identified operational address discrepancy in `Permit2WitnessProxy.sol:22` (hardcoded canonical `_PERMIT2` vs SDK dynamic zkSync address).
   - **LOP-02:** Identified deployment safety defect in `deploy/deploy-Permit2Proxy.js:15` (`networkName in hre.config.networks[networkName]` evaluates false).
   - Created `analysis/tests/lop-deployment-regressions.test.js` reproducing both issues.
3. **Research Workspace Transition:**
   - Mirrored project to research workspace `D:\limit-order-protocol-research-findings`.
   - Verified Git remotes: `origin` points to `https://github.com/Prince7250/limit-order-protocol-research-findings`.
   - Added official upstream remote: `https://github.com/1inch/limit-order-protocol.git`.
   - Verified that `main` is clean and up to date with `origin/main` at commit `743d77b`.
   - Ran all 73 regression tests in the new workspace: 73 passing in 11s.
4. **Initiated Hypothesis H-09 (Asset Proxies & Reentrancy):**
   - Began detailed inspection of `ERC721Proxy.sol`, `ERC721ProxySafe.sol`, `ERC1155Proxy.sol`, `ApprovalPreInteraction.sol`, and `OrderIdInvalidator.sol`.

### Activities (Satyam):
1. **Contribution Status:**
   - Independent notes and historical test scripts are currently awaiting contribution details to be merged into the research repository.
2. **Research Scope Assigned (Hypothesis H-10 & H-11):**
   - Assigned to lead `contracts/helpers/SafeOrderBuilder.sol`, `contracts/helpers/OrderRegistrator.sol`, `contracts/helpers/PredicateHelper.sol`, `contracts/helpers/SeriesNonceManager.sol`, and `contracts/helpers/SeriesEpochManager.sol`.
   - Assigned initial investigation of candidate finding LOP-C01: Missing `latestAnswer > 0` validation in `SafeOrderBuilder.sol:50` and `58`.

---

## Log Update Protocol
- Daily research entries must be recorded at the conclusion of each research session.
- Any newly formulated hypothesis or candidate finding must be cross-referenced with `FINDINGS.md` and `RESEARCH_STATUS.md`.
- No existing log entries may be modified or deleted.


---

## [2026-10-28] — Merge Synchronization & H-09 Asset-Proxy Callback Invariants
**Contributors:** Prince, Satyam

### Activities (Prince):
1. **Startup Synchronization:**
   - Ran `git pull origin main`: clean synchronization at commit `0856854` merging Satyam's PR #2.
   - Reviewed Satyam's completed findings (H-10, H-11, H-12).
2. **Hypothesis H-09 (Asset-Proxy Callbacks & Reentrancy):**
   - Audited `ERC1155Proxy.sol`, `ERC721Proxy.sol`, `ERC721ProxySafe.sol`, and `OrderMixin.sol`.
   - Built and executed `analysis/tests/asset-proxies-and-callbacks.test.js`: **10 passing tests (868ms)**.
   - Proved CEI state invalidation occurs before `safeTransferFrom` hooks (`onERC1155Received` / `onERC721Received`). Reentrant fills revert with `BitInvalidatedOrder()`.
   - Proved callback failures trigger atomic transaction rollback with `TransferFromMakerToTakerFailed()`.
   - Proved `ERC721Proxy` ignores `amount` parameter, preventing double-transfer of NFTs.
3. **Full Regression Suite Validation:**
   - Executed all 8 Hardhat unit test files: **88 passing (5s)** (zero regressions).

### Activities (Satyam — Merged via PR #2):
1. **Hypothesis H-10 / LOP-C01 (SafeOrderBuilder Oracle Validation):**
   - Completed empirical testing of non-positive oracle pricing: verified that `OrderMixin.sol:335` strictly reverts with `SwapWithZeroAmount()` or `Panic(0x12)`, preventing uncompensated asset theft. (8 tests passing in `h10-safe-order-builder-standalone.test.js`).
2. **Hypothesis H-11 (PredicateHelper & OrderRegistrator):**
   - Verified strict 32-byte returndata checks, calldata bounds, and single announcement lifecycle. (11 tests passing in `h11-predicate-registrator-standalone.test.js`).
3. **Hypothesis H-12 (ApprovalPreInteraction Invalidation Mismatch):**
   - Investigated candidate issue: signing user cancellation/advanceEpoch does not invalidate extension-maker orders. Demonstrated local self-fill token recovery; deprioritized for bounty submission. (5 tests passing in `h12-approval-preinteraction-cancellation.test.js` and 4 tests in standalone runner).
4. **Proposed H-13:**
   - Outlined fee accounting review for `FeeTaker.sol` and `AmountGetterWithFee.sol`.

### Activities (Prince — H-14 Investigation):
1. **Hypothesis H-14 (OrderIdInvalidator & PriorityFeeLimiter):**
   - Audited `OrderIdInvalidator.sol` and `PrioirityFeeLimiter.sol`.
   - Built and executed `analysis/tests/h14-order-id-invalidator.test.js`: **9 passing tests (1s)**.
     - Proved `(maker, orderId) -> orderHash` permanent binding. Competing quotes under the same `orderId` revert with `InvalidOrderHash()`.
     - Demonstrated frontrunning / dust-fill locking hazard: filling 1 wei of Quote A permanently invalidates Quote B under the same `orderId`.
     - Proved `orderId` mappings are strictly isolated per maker address, and independent IDs operate without interference.
     - Confirmed `OrderIdInvalidator` lacks any reset, clear, or cancellation functions.
   - Built and executed `analysis/tests/h14-priority-fee-limiter.test.js`: **14 passing tests (399ms)**.
     - Verified priority fee validation across all 3 tiers: < 10.6 gwei (70% cap), 10.6-104.1 gwei (50% cap), and >= 104.1 gwei (65% cap) with exact boundary precision.
     - Proved fail-closed underflow invariant: `unchecked { uint256 priorityFee = tx.gasprice - baseFee; }` wraps to $\approx 2^{256}$ when `tx.gasprice < baseFee`, returning `false` and reverting with `PredicateIsNotTrue()`. No unauthorized fills possible.
2. **Full Regression Suite Validation:**
   - Executed all 14 active Hardhat unit test suites across the repository: **111 passing tests (14s)** (zero regressions). Total passing automated tests across repo: 134.

### Activities (Prince — H-15 Investigation):
1. **Hypothesis H-15 (RangeAmountCalculator & AmountCalculatorLib):**
   - Audited `RangeAmountCalculator.sol` and `AmountCalculatorLib.sol`.
   - Built and executed `analysis/tests/h15-range-amount-calculator.test.js`: **18 passing tests (688ms)**.
     - Proved rounding direction in `AmountCalculatorLib` strictly protects makers: `getMakingAmount` floors, `getTakingAmount` ceils.
     - Re-examined `Panic(0x11)` dust underflow at line 103: identified intermediate precision loss in `(...) / k * 1e18` before `Math.sqrt(...)` which drops $\lfloor \sqrt{X} \rfloor$ 2196 units below $bDivK + alreadyFilled$. Re-confirmed fail-safe behavior; control case at 213 wei succeeds cleanly.
     - Proved curve monotonicity: average price increases strictly monotonically across order fill progress.
     - Verified `getRangeTakerAmount` matches high-precision numerical integrals and 5-slice partial fills sum to single full fill taking amount.
     - Verified division-by-zero (`Panic(0x12)`) and invalid range (`IncorrectRange()`) boundary guards.
2. **Full Regression Suite Validation:**
   - Executed all 15 active Hardhat unit test suites across the repository: **129 passing tests (26s)** (zero regressions). Total passing automated tests across repo: 154.

### Activities (Prince — H-16 Investigation):
1. **Hypothesis H-16 (Whitelist Discounts & Resolver Fee Structures):**
   - Audited `AmountGetterWithFee.sol` and `FeeTaker.sol`.
   - Built and executed `analysis/tests/h16-whitelist-resolver-fees.test.js`: **24 passing tests (591ms)**.
     - Proved tightly packed whitelist representation (1 byte size, 10 bytes per address) and verified $2^{80}$ collision margin.
     - Proved dual-tier resolver access control: whitelisted callers receive discounts and bypass access token checks; non-whitelisted callers require `_ACCESS_TOKEN.balanceOf > 0` and pay full fees. Unauthorized callers revert with `OnlyWhitelistOrAccessToken()`, rolling back state atomically.
     - Proved strict token conservation ($\sum \text{fees} + \text{receiver} = \text{takingAmount}$) with zero token leakage across fuzz and randomized parameters.
     - Verified partial fills fee truncation favors the maker; dust fee truncation sends 100% of taking amount to maker with zero fee transfers.
     - Verified WETH unwrapping integration and atomic rollback on ETH transfer failure (`EthTransferFailed`).
     - Verified `InconsistentFee` guard reverts when `receiver != FeeTaker` and fees > 0, but permits zero-fee orders for authorized resolvers.
2. **Full Regression Suite Validation:**
   - Executed 12 Hardhat suites together: **153 passing tests (12s)** (zero regressions). Total passing automated tests across repo: 178 (153 Hardhat + 23 standalone runner + 2 deployment tests).

### Activities (Prince — H-17 Master Synthesis & Bounty Readiness Audit):
1. **Hypothesis H-17 (Research Synthesis & Bounty Scope Audit):**
   - Conducted an exhaustive cross-hypothesis synthesis across all 16 investigated hypotheses.
   - Reconciled and empirically proved all test suites: 153 passing Hardhat tests across 12 suites, 23 standalone tests across 3 suites, and 2 deployment regression tests (178 passing tests total, zero double-counting).
   - Audited all 4 candidate findings against Immunefi 1inch Smart Contracts program rules (Primacy of Rules):
     - **LOP-01:** Confirmed as Low / Operational Interoperability Defect for zkSync Era (`324`). Prepared a formal submission-ready advisory draft for protocol developers.
     - **LOP-02:** Confirmed as Tooling / Deployment script defect. Out of scope on Immunefi; already patched upstream in PR #433. Documented non-submission rationale.
     - **LOP-03:** Confirmed as Informational fail-safe arithmetic underflow on dust amounts ($\le 173$ wei). Zero funds lost or frozen. Excluded from bounty scope.
     - **LOP-04:** Confirmed as Informational resolver gas griefing strictly isolated to maker's own clone (self-griefing). Excluded from bounty scope.
   - Master research archive finalized and verified. Zero production contracts modified. Satyam's records preserved.
