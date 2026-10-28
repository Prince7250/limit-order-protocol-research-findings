# Daily Research Log: Prince

This log records the append-only chronological record of Prince's security research activities, hypotheses tested, commands executed, actual test outputs, and conclusions.

---

## [2026-10-24] — Baseline Verification & Infrastructure Setup
- **Objective:** Establish clean working environment for 1inch Limit Order Protocol security review.
- **Commands Executed:**
  - `git status`: Verified working branch clean.
  - `yarn hardhat compile`: Confirmed contracts compile with Solidity 0.8.30.
- **Activities:**
  - Committed baseline checkpoints (`d19b20f`, `2346e96`, `dbc62b5`, `46f108a`, `d53db52`) on `main`.
  - Verified official Immunefi scope corresponds to Git tag `4.3.4` (`0a40e01befff19d925457b55191900fb456c2dd2`).

---

## [2026-10-26] — Invariant Testing (H-01..H-08), Defect Reproduction & Fork Setup
- **Objective:** Complete core settlement invariant testing (H-01 through H-08), establish research fork, reproduce LOP-01/LOP-02, and organize separate tracking.
- **Files Examined:**
  - `contracts/OrderMixin.sol`, `contracts/OrderLib.sol`, `contracts/LimitOrderProtocol.sol`
  - `contracts/libraries/*.sol` (all 7 library files)
  - `contracts/extensions/AmountGetterWithFee.sol`, `contracts/extensions/FeeTaker.sol`
  - `contracts/extensions/DutchAuctionCalculator.sol`, `contracts/extensions/ChainlinkCalculator.sol`, `contracts/extensions/RangeAmountCalculator.sol`
  - `contracts/extensions/NativeOrderFactory.sol`, `contracts/extensions/NativeOrderImpl.sol`
  - `contracts/extensions/Permit2Proxy.sol`, `contracts/extensions/Permit2WitnessProxy.sol`
  - `deploy/deploy-Permit2Proxy.js`
- **Commands Executed & Actual Outputs:**
  ```bash
  # 1. Custom regression test suite execution
  corepack yarn hardhat test analysis/tests/extension-parser-boundaries.test.js \
    analysis/tests/native-order-cancellation.test.js \
    analysis/tests/pricing-and-calculators.test.js \
    analysis/tests/cross-component-invariants.test.js \
    analysis/tests/permit2-signature-and-nonce.test.js \
    analysis/tests/order-authorization-and-settlement.test.js
  ```
  *Actual Output:* `73 passing (11s)` (All 73 unit tests passed with 0 failures).

  ```bash
  # 2. Deployment regression test execution
  node analysis/tests/lop-deployment-regressions.test.js
  ```
  *Actual Output:*
  `LOP-02 reproduced: current guard=false, corrected guard=true for a mismatched mocked RPC.`
  `LOP-01 reproduced: witness proxy target differs from the SDK-selected zkSync address.`

- **Findings & Conclusions:**
  - Documented LOP-01 (zkSync address mismatch in `Permit2WitnessProxy.sol:22`).
  - Documented LOP-02 (deploy script network guard bug in `deploy/deploy-Permit2Proxy.js:15`).
  - Documented LOP-03 (`Panic(0x11)` on dust in `RangeAmountCalculator.sol:84`).
  - Documented LOP-04 (gas griefing in `NativeOrderImpl.sol:154`).

---

## [2026-10-28] — Synchronization & Hypothesis H-09 Execution (Asset Proxies & Reentrancy)
- **Objective:** Synchronize repository with merged PR #2 from Satyam, investigate Hypothesis H-09 on `ERC1155Proxy.sol`, `ERC721Proxy.sol`, `ERC721ProxySafe.sol`, and `OrderMixin.sol`, and verify callback reentrancy boundaries.
- **Startup Synchronization:**
  - Ran `git pull origin main`: Success (`Already up to date` at commit `0856854` merging Satyam's PR #2).
  - Reviewed Satyam's merged contributions: H-10 (`SafeOrderBuilder` math), H-11 (`PredicateHelper` & `OrderRegistrator`), H-12 (`ApprovalPreInteraction` cancellation mismatch), and proposed H-13 (`FeeTaker`).
  - Confirmed H-09 (`ERC1155Proxy`, `ERC721ProxySafe`) remained untouched and uninvestigated.
- **Files Examined:**
  - [`contracts/extensions/ERC1155Proxy.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/ERC1155Proxy.sol) (`func_301JL5R`)
  - [`contracts/extensions/ERC721ProxySafe.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/ERC721ProxySafe.sol) (`func_30iH1gK`)
  - [`contracts/extensions/ERC721Proxy.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/ERC721Proxy.sol) (`func_60iHVgK`)
  - [`contracts/OrderMixin.sol`](file:///d:/limit-order-protocol-research-findings/contracts/OrderMixin.sol) (`_fill`, `_callTransferFromWithSuffix`, `_makeCalls`)
  - [`contracts/extensions/ImmutableOwner.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/ImmutableOwner.sol) (`IOAccessDenied`)
- **Hypothesis Tested:**
  - **H-09 (Asset Proxy Callbacks & Reentrancy):** Evaluated whether safe transfer callbacks (`onERC1155Received` and `onERC721Received`) allow a malicious receiver contract to re-enter `fillOrder` before Step 8 taker payment completes, whether orders can be cancelled mid-fill, and whether failed callbacks trigger atomic transaction rollback.
- **Test Implementation & Execution:**
  - Created automated test suite: [`analysis/tests/asset-proxies-and-callbacks.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/asset-proxies-and-callbacks.test.js) (10 unit tests covering ERC1155/721 lifecycle, reentrancy guards, rollback atomicity, and access controls).
  - Executed targeted suite:
    ```bash
    corepack yarn hardhat test analysis/tests/asset-proxies-and-callbacks.test.js
    ```
    *Actual Output:* `10 passing (868ms)`
  - Executed full combined regression suite:
    ```bash
    corepack yarn hardhat test analysis/tests/extension-parser-boundaries.test.js \
      analysis/tests/native-order-cancellation.test.js \
      analysis/tests/pricing-and-calculators.test.js \
      analysis/tests/cross-component-invariants.test.js \
      analysis/tests/permit2-signature-and-nonce.test.js \
      analysis/tests/order-authorization-and-settlement.test.js \
      analysis/tests/asset-proxies-and-callbacks.test.js \
      analysis/tests/h12-approval-preinteraction-cancellation.test.js
    ```
    *Actual Output:* `88 passing (5s)` (0 failures across all 8 suites).
- **Findings & Conclusions:**
  1. Single-fill reentrancy via `onERC1155Received` or `onERC721Received` is strictly blocked: state invalidation occurs in Step 5 before Step 6 token transfer, causing reentrant fill attempts to revert immediately with `BitInvalidatedOrder()` (`0xa4f62a96`).
  2. Partial-fill reentrancy is strictly capped to `remainingMakingAmount`; total tokens consumed across outer and inner fills can never exceed order capacity.
  3. Reverting in `onERC1155Received` or returning a bad selector causes `_callTransferFromWithSuffix` to fail, reverting the entire transaction with `TransferFromMakerToTakerFailed()` and atomically rolling back all state.
  4. `ERC721Proxy.func_60iHVgK` ignores `amount` and transfers exactly 1 NFT, preventing fractional double-spending even if an order was mistakenly marked with `allowMultipleFills: true`.
  5. Direct calls to asset proxies outside `LimitOrderProtocol` revert with `IOAccessDenied()`.
- **Next Action:**
  - Execute Hypothesis H-14: Review `OrderIdInvalidator.sol` for dust-fill permanent locking risks and `PriorityFeeLimiter.sol` for L2 underflow anomalies.

---

## 2026-10-28 — Session: H-14 Investigation: OrderIdInvalidator and PriorityFeeLimiter

- **Researcher:** Prince
- **Objective:**
  1. Determine whether `OrderIdInvalidator.sol` allows dust fills (1 wei) to permanently lock an `orderId` against competing or revised orders under the same ID, and confirm whether any on-chain cancellation/reset mechanism exists.
  2. Investigate `PriorityFeeLimiter.sol` arithmetic `unchecked { uint256 priorityFee = tx.gasprice - baseFee; }` across all 3 base fee tiers, and test for underflow when `tx.gasprice < baseFee` on L2 networks.
- **Source Inspection:**
  - Inspected [`contracts/extensions/OrderIdInvalidator.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/OrderIdInvalidator.sol). Storage mapping `mapping(address maker => mapping(uint32 orderId => bytes32 orderHash)) private _ordersIdsHashes;`. Modifier `onlyLimitOrderProtocol()` restricts execution. Missing public getter or reset functions.
  - Inspected [`contracts/extensions/PrioirityFeeLimiter.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/PrioirityFeeLimiter.sol). Implementation bounds priority fees: < 10.6 gwei (<= 70%), 10.6 - 104.1 gwei (<= 50%), and >= 104.1 gwei (<= 65%). Unchecked subtraction `tx.gasprice - baseFee`.
- **Test Implementation & Execution:**
  - Created automated test suite 1: [`analysis/tests/h14-order-id-invalidator.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/h14-order-id-invalidator.test.js) (9 unit tests).
    - Executed targeted run: `corepack yarn hardhat test analysis/tests/h14-order-id-invalidator.test.js` -> `9 passing (1s)`.
  - Created automated test suite 2: [`analysis/tests/h14-priority-fee-limiter.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/h14-priority-fee-limiter.test.js) (14 unit tests).
    - Executed targeted run: `corepack yarn hardhat test analysis/tests/h14-priority-fee-limiter.test.js` -> `14 passing (399ms)`.
  - Executed full combined regression suite (14 active test suites across repo):
    ```bash
    corepack yarn hardhat test \
      analysis/tests/asset-proxies-and-callbacks.test.js \
      analysis/tests/cross-component-invariants.test.js \
      analysis/tests/extension-parser-boundaries.test.js \
      analysis/tests/h10-safe-order-builder-standalone.test.js \
      analysis/tests/h11-predicate-registrator-standalone.test.js \
      analysis/tests/h12-approval-preinteraction-cancellation.test.js \
      analysis/tests/h12-approval-preinteraction-standalone.test.js \
      analysis/tests/h14-order-id-invalidator.test.js \
      analysis/tests/h14-priority-fee-limiter.test.js \
      analysis/tests/lop-deployment-regressions.test.js \
      analysis/tests/native-order-cancellation.test.js \
      analysis/tests/order-authorization-and-settlement.test.js \
      analysis/tests/permit2-signature-and-nonce.test.js \
      analysis/tests/pricing-and-calculators.test.js
    ```
    *Actual Output:* `111 passing (14s)` (0 failures across all 14 active suites).
- **Findings & Conclusions:**
  1. *OrderIdInvalidator Permanent Commitment:* Once an order with `orderId` is touched, `_ordersIdsHashes[maker][orderId]` is permanently set. Partial fills of the same order succeed (`storedOrderHash == orderHash`), but any competing or revised order with the same `orderId` reverts with `InvalidOrderHash()`.
  2. *Frontrunning & Dust Fill Hazard:* A 1-wei fill by a taker locks the `orderId` irrevocably. The contract provides no cancel or reset method. Reusing an `orderId` after an order finishes or expires is impossible. However, the mapping is namespaced per maker (`order.maker.get()`), so attacks cannot cross makers, and independent `orderId` values operate without interference.
  3. *PriorityFeeLimiter Multi-Tier Thresholds:* Verified all 3 tiers with exact boundary checks: 70% cap for < 10.6 gwei, 50% cap for 10.6 - 104.1 gwei, and 65% cap for >= 104.1 gwei. Transactions with zero priority fee pass across all tiers.
  4. *Fail-Closed Underflow Security:* If `tx.gasprice < baseFee`, `unchecked` arithmetic underflows to $2^{256} - \Delta$. Because $2^{256} - 100\Delta$ is astronomically large, the threshold check evaluates to `false`. When called inside a predicate, the fill reverts with `PredicateIsNotTrue()`. The protocol fails closed, preventing any unauthorized order fills.
- **Next Action:**
  - Execute Hypothesis H-15: Review `RangeAmountCalculator.sol` and `AmountCalculatorLib.sol` for square-root truncation, precision loss, and arithmetic invariant boundaries.

---

## 2026-10-29 — Session: H-15 Investigation: RangeAmountCalculator Precision and Arithmetic Boundaries

- **Researcher:** Prince
- **Objective:**
  1. Verify arithmetic correctness and rounding behavior of `contracts/extensions/RangeAmountCalculator.sol` and `contracts/libraries/AmountCalculatorLib.sol`.
  2. Re-examine the previously documented `Panic(0x11)` underflow near line 103 on dust taking amounts, identify the exact mathematical mechanism, and determine reachability/exploitability.
  3. Validate curve monotonicity, multi-slice partial fill summation, and high-precision reference matching.
- **Source Inspection:**
  - Located contracts at actual repository paths: [`contracts/extensions/RangeAmountCalculator.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/RangeAmountCalculator.sol) and [`contracts/libraries/AmountCalculatorLib.sol`](file:///d:/limit-order-protocol-research-findings/contracts/libraries/AmountCalculatorLib.sol).
  - Traced callers: `OrderLib.calculateMakingAmount` and `calculateTakingAmount` call `AmountCalculatorLib` for standard linear orders, or dispatch to `RangeAmountCalculator` via `IAmountGetter` when configured in extension data.
  - In `AmountCalculatorLib.sol`, verified rounding asymmetry: `getMakingAmount` floors (returns fewer maker tokens), while `getTakingAmount` ceils (collects more taker tokens), both strictly protecting the maker.
  - In `RangeAmountCalculator.sol:97-103`, identified line 102 integer division truncation in `(...) / k * 1e18` before `Math.sqrt(...)`, which drops intermediate precision and causes $\lfloor \sqrt{X} \rfloor$ to fall 2196 units below $bDivK + alreadyFilledMakingAmount$ on dust amounts.
- **Test Implementation & Execution:**
  - Created automated test suite: [`analysis/tests/h15-range-amount-calculator.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/h15-range-amount-calculator.test.js) (18 unit tests).
    - Executed targeted run: `corepack yarn hardhat test analysis/tests/h15-range-amount-calculator.test.js` -> `18 passing (688ms)`.
  - Executed pricing and H-15 suites together:
    - `corepack yarn hardhat test analysis/tests/pricing-and-calculators.test.js analysis/tests/h15-range-amount-calculator.test.js` -> `39 passing (1s)`.
  - Executed full combined regression suite (15 active test suites across repo):
    - `corepack yarn hardhat test analysis/tests/asset-proxies-and-callbacks.test.js analysis/tests/cross-component-invariants.test.js analysis/tests/extension-parser-boundaries.test.js analysis/tests/h10-safe-order-builder-standalone.test.js analysis/tests/h11-predicate-registrator-standalone.test.js analysis/tests/h12-approval-preinteraction-cancellation.test.js analysis/tests/h12-approval-preinteraction-standalone.test.js analysis/tests/h14-order-id-invalidator.test.js analysis/tests/h14-priority-fee-limiter.test.js analysis/tests/h15-range-amount-calculator.test.js analysis/tests/lop-deployment-regressions.test.js analysis/tests/native-order-cancellation.test.js analysis/tests/order-authorization-and-settlement.test.js analysis/tests/permit2-signature-and-nonce.test.js analysis/tests/pricing-and-calculators.test.js`
    - *Actual Output:* `129 passing (26s)` (0 failures across all 15 active suites).
- **Findings & Conclusions:**
  1. *Rounding Direction Strictly Favors Maker:* Both `AmountCalculatorLib` and `RangeAmountCalculator` floor maker amounts delivered and/or ceil taker amounts collected, ensuring makers are never underpaid. Partial fill accumulation yields a tiny surplus (1-2 wei) to the maker.
  2. *SwapWithZeroAmount Defense:* Dust inputs that truncate makingAmount to 0 are rejected by `OrderMixin.sol:335` with `SwapWithZeroAmount()`.
  3. *Panic(0x11) Dust Underflow Confirmed (Fail-Safe):* Verified that `takingAmount <= 173` on a partial-fill range order causes `Math.sqrt(...)` to drop 2196 units below baseline due to `(...) / k * 1e18` truncation, triggering unsigned underflow. The panic is a fail-safe execution halt; it prevents execution of dust fills rather than allowing token loss. Control case with 213 wei succeeds cleanly.
  4. *Range Curve Monotonicity & Integrals:* Average price strictly increases monotonically as orders are filled; sum of 5 partial fills equals single full fill taking amount.
  5. *Division by Zero (`Panic(0x12)`):* Narrow price spreads where $(priceEnd - priceStart) \times 1e18 < orderMakingAmount$ produce $k = 0$, reverting with `Panic(0x12)`.
- **Next Action:**
  - Execute Hypothesis H-16: Whitelist discounts, resolver authorization, and fee structures in `AmountGetterWithFee.sol` and `FeeTaker.sol`.

---

## 2026-10-29 — Session: H-16 Investigation: Whitelist Discounts and Resolver Fee Structures

- **Researcher:** Prince
- **Objective:**
  1. Determine how whitelist membership is represented and checked in `AmountGetterWithFee.sol` and `FeeTaker.sol`.
  2. Verify resolver authorization gates, specifically the dual-tier access check (`isWhitelisted` vs `_ACCESS_TOKEN.balanceOf(taker)`).
  3. Validate mathematical fee calculations, whitelist discount application (`whitelistDiscountNumerator / 100`), fee revenue splitting (`integratorShare`), rounding boundaries, dust truncation, and token conservation.
  4. Test WETH unwrapping integration, ETH transfer failure atomicity, and `InconsistentFee` receiver guards.
- **Source Inspection:**
  - Inspected [`contracts/extensions/AmountGetterWithFee.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/AmountGetterWithFee.sol). Tightly packed whitelist calldata: 1 byte size followed by 10-byte address entries. Evaluates lowest 80 bits of `msg.sender` (`uint80(uint160(taker)) == uint80(bytes10(whitelist[:10]))`).
  - Inspected [`contracts/extensions/FeeTaker.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/FeeTaker.sol). In `_getFeeAmounts`, strictly enforces `if (!isWhitelisted && _ACCESS_TOKEN.balanceOf(taker) == 0) revert OnlyWhitelistOrAccessToken();`.
  - In `_parseFeeData`: `if (isWhitelisted) { resolverFee = resolverFee * whitelistDiscountNumerator / 100; }`.
  - In `_postInteraction`: If `order.receiver != FeeTaker` and fees > 0, reverts with `InconsistentFee()`. WETH unwrapping sends ETH to integrator, protocol, and receiver via `_sendEth`, reverting with `EthTransferFailed()` if recipient rejects ETH.
- **Test Implementation & Execution:**
  - Created automated test suite: [`analysis/tests/h16-whitelist-resolver-fees.test.js`](file:///d:/limit-order-protocol-research-findings/analysis/tests/h16-whitelist-resolver-fees.test.js) (24 unit and integration tests across 3 comprehensive groups).
  - Executed targeted run: `corepack yarn hardhat test analysis/tests/h16-whitelist-resolver-fees.test.js` -> `24 passing (591ms)`.
  - Executed fee tests together: `corepack yarn hardhat test test/FeeTaker.js analysis/tests/h16-whitelist-resolver-fees.test.js` -> `31 passing (1s)`.
  - Executed 5 recent Prince test suites (H-09, H-14, H-15, H-16): `75 passing (4s)`.
  - Executed full 12-suite Hardhat regression run: `153 passing (12s)` (0 failures).
- **Findings & Conclusions:**
  1. *Packed Whitelist Architecture & 80-Bit Truncation:* Whitelist representation uses 1-byte count $N$ and 10 bytes per address ($2^{80}$ collision resistance, identical to `_ALLOWED_SENDER_MASK`). Addresses sharing the lowest 80 bits match the same whitelist entry. Calldata shorter than declared size reverts cleanly.
  2. *Dual-Tier Resolver Gate (`OnlyWhitelistOrAccessToken`):* Whitelisted resolvers receive discounted fees and bypass access token checks. Non-whitelisted resolvers must hold `_ACCESS_TOKEN` (1INCH) and pay full undiscounted fees. Unauthorized resolvers lacking both revert with `OnlyWhitelistOrAccessToken()`, rolling back all balance changes and invalidations atomically.
  3. *Exact Mathematical Revenue Splitting & Zero Token Leakage:* Token conservation was proven across multiple randomized and fuzz parameters: $\text{integratorFeeAmount} + \text{protocolFeeAmount} + \text{receiverAmount} == \text{takingAmount}$ identically. Zero dust remains locked in `FeeTaker`.
  4. *Multi-Step Partial Fills Favor Maker:* Due to integer division truncation, aggregate fees across partial fills are equal to or slightly less than a single full fill, delivering any truncated dust directly to the maker.
  5. *Fail-Safe Guards:* ETH transfers to rejecting recipients revert with `EthTransferFailed()`. Orders specifying positive fees without routing `order.receiver` to `FeeTaker` revert with `InconsistentFee()`. Orders with zero fees and `order.receiver != FeeTaker` succeed cleanly for authorized callers.
- **Next Action:**
  - Execute Hypothesis H-17: Comprehensive Research Synthesis and Bounty Submission Readiness Audit.

---

## 2026-10-29 — Session: H-17 Investigation: Research Synthesis and Bounty Submission Readiness Audit

- **Researcher:** Prince
- **Objective:**
  1. Independently audit the entire research record across all 16 evaluated hypotheses (H-01 through H-16).
  2. Verify all test suites and reconcile exact automated test counts across Hardhat suites, standalone runners, and deployment regression scripts.
  3. Conduct an independent technical and scope evaluation of all four documented findings (LOP-01 through LOP-04) against Immunefi 1inch Smart Contracts bug bounty rules.
  4. Prepare a submission-style draft for eligible candidates (LOP-01) and document explicit out-of-scope / non-submission rationale for LOP-02, LOP-03, and LOP-04.
- **Source & Policy Audit:**
  - Audited target release tag `4.3.4` (commit `0a40e01befff19d925457b55191900fb456c2dd2`) and diff against `HEAD` across all 54 Solidity sources. Core settlement contracts are byte-for-byte identical.
  - Audited Immunefi 1inch Smart Contracts program rules: Primacy of Rules, requiring demonstrated direct theft or permanent freezing of user funds for Critical/High payouts; excludes tooling/deployment scripts, self-griefing, and fail-safe reverts.
  - Audited LOP-01 (`Permit2WitnessProxy.sol:22`): Canonical address constant causes signature validation failure on zkSync Era (`324`) where Uniswap deployed Permit2 to `0x...Fa`. Confirmed non-exploitable for funds theft; verified as an operational/interoperability defect.
  - Audited LOP-02 (`deploy/deploy-Permit2Proxy.js:15`): Key-in-key lookup defect. Tooling script issue, out of scope on Immunefi; already patched in upstream PR #433.
  - Audited LOP-03 (`RangeAmountCalculator.sol:97-103`): Dust taking amount ($\le 173$ wei) causes `Panic(0x11)` fail-safe revert due to division truncation. Zero fund loss; non-exploitable; out of scope as fail-safe revert.
  - Audited LOP-04 (`NativeOrderImpl.sol:154`): Rejecting contract maker reverts resolver cancellation. Isolated to maker's own clone; mitigated by `eth_call` simulation; out of scope as self-griefing.
- **Test Evidence Reconciliation:**
  - Hardhat Test Suites (12 suites): **153 passing tests (6s)**.
  - Satyam's Standalone Runner Suites (3 suites: H-10, H-11, H-12): **23 passing tests**.
  - Deployment Regression Harness: **2 passing tests**.
  - Upstream Test Suite (`test/`): **179 passing tests** in CI.
  - Total Custom Automated Tests: **178 passing tests** (zero double-counting).
- **Findings & Conclusions:**
  1. No critical or high vulnerabilities resulting in direct asset theft or permanent fund freezing exist in the 1inch Limit Order Protocol v4.3.4.
  2. Protocol architecture strictly enforces CEI ordering, maker-favoring ceil/floor rounding, downstream zero-payment guards (`SwapWithZeroAmount`), and atomic rollback across all settlement failure modes.
  3. LOP-01 is classified as Low / Operational Interoperability Defect for zkSync Era. A formal submission-ready report draft was prepared for protocol developers.
  4. LOP-02, LOP-03, and LOP-04 are formally documented as non-submission candidates with technical justification.
- **Next Action:**
  - Research cycle complete. Deliver final comprehensive synthesis report to user.
