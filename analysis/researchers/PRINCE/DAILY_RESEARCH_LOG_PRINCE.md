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
- **Hypotheses Tested:**
  - **H-01:** Fee-on-transfer / rebasing tokens (Closed / Out of Scope).
  - **H-02:** Extension parser non-monotonic offset underflow (Refuted; EVM OOG revert).
  - **H-03:** Pricing & amount getters (Verified; discovered `Panic(0x11)` on dust in `RangeAmountCalculator`).
  - **H-04:** Native order clone cancellation callbacks (Confirmed informational griefing edge case).
  - **H-05:** Governance / pausing trust model (Verified defensive protocol design).
  - **H-06:** Cross-component settlement & authorization invariants (Verified CEI and rollback atomicity).
  - **H-07:** Permit2 & Permit2WitnessProxy signature and nonce security (Verified; documented LOP-01).
  - **H-08:** Signed order authorization vs settlement (Verified all authorization guards).
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

  ```bash
  # 3. Upstream remote setup
  git remote add upstream https://github.com/1inch/limit-order-protocol.git
  git remote -v
  ```
  *Actual Output:*
  `origin   https://github.com/Prince7250/limit-order-protocol-research-findings (fetch)`
  `origin   https://github.com/Prince7250/limit-order-protocol-research-findings (push)`
  `upstream https://github.com/1inch/limit-order-protocol.git (fetch)`
  `upstream https://github.com/1inch/limit-order-protocol.git (push)`

- **Findings & Conclusions:**
  - Documented LOP-01 (zkSync address mismatch in `Permit2WitnessProxy.sol:22`).
  - Documented LOP-02 (deploy script network guard bug in `deploy/deploy-Permit2Proxy.js:15`).
  - Documented LOP-03 (`Panic(0x11)` on dust in `RangeAmountCalculator.sol:84`).
  - Documented LOP-04 (gas griefing in `NativeOrderImpl.sol:154`).
  - Confirmed core protocol source code is byte-for-byte identical to tag `4.3.4`.

- **Next Action:**
  - Formulate detailed test scenarios for Hypothesis H-09 (`contracts/extensions/ERC1155Proxy.sol` and `contracts/extensions/ERC721ProxySafe.sol`) in `analysis/tests/asset-proxies-and-callbacks.test.js`.
