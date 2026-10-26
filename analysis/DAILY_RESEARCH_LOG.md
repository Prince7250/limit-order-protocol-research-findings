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
