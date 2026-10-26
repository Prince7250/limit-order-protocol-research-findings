# Analysis progress — verified checkpoint

## Audit target and working-tree status

| Field | Verified value |
|---|---|
| Official Immunefi scope | `https://github.com/1inch/limit-order-protocol/tree/4.3.4` (tag `4.3.4`, commit `0a40e01befff19d925457b55191900fb456c2dd2`) |
| Local branch / commit | `main` at `50bd1300315606a3d32e9021898374c9d0dc2335` |
| Package version | `4.3.5` |
| Nearest tag | `4.3.4-56-g50bd130` |
| Core protocol diff (`4.3.4` vs HEAD) | Byte-for-byte identical across all 14 core settlement contracts |
| Reference Audit PDF in workspace | `tmp/pdfs/limit-order-protocol-v4.3.4-openzeppelin.pdf` (OpenZeppelin Permit2Proxy Audit, PR #400 / `a6148e1`, February 10, 2026) |
| Working tree before review | clean `main...origin/main` |
| Working tree now | `analysis/` updated with review records and local automated regression tests; no production contract source modified |

`README.md` expressly calls the default development branch work in progress and unaudited. However, verification of Git tag `4.3.4` (the official Immunefi scope) confirms that the core protocol smart contracts are identical between `4.3.4` and `50bd130`.

## Artifact verification performed in this review

- The `analysis/` tree contains **65 Markdown files**: nine numbered/top-level analysis documents, this progress record, one analysis-file README, and 54 Solidity notes.
- The checkout has **54** `contracts/**/*.sol` files and there are **54 matching** `analysis/files/contracts/<source>.md` notes. No Solidity source lacks a matching note and no note maps to a nonexistent Solidity source.
- Every explicit `contracts/...sol:<line>` or `<start>-<end>` citation in the analysis resolves within the current source's actual line range.
- Existence of core source anchors was checked directly: `LimitOrderProtocol`, `OrderMixin._fill`, all four fill entry points, cancellation functions, order hash/extension validation, invalidators, callback interfaces, native-order contracts, and both Permit2 proxy functions exist at the cited paths.
- This validates paths and cited source anchors. It does **not** mechanically prove every prose interpretation, every implied caller relationship, or all external dependency semantics.

## What the current documents actually provide

| Area | Evidence present | Quality / limitation |
|---|---|---|
| Version, instructions, compiler and CI | Git/tag queries; `AGENTS.md`, README, package, Hardhat, Makefile, workflow review | Good baseline; security-relevant code diff between `4.0.0`, `4.3.2`, and HEAD is only summarized, not fully analyzed commit-by-commit. |
| Inventory | Categorized source, tests, scripts, config, docs, and deployment-manifest directories | Partial: it does not enumerate every non-generated relative path in one row with callers/dependencies/status as originally requested. |
| Solidity files | A matching note exists for all 54 files | **Partial:** all 54 notes are only 2–5 lines. They are summaries, not detailed walkthroughs of every function, error, storage change, import, and security property. |
| JS/tests/deploy/config files | Grouped in inventory and test/dependency documents | **Partial:** no one-document-per-file analysis; implementation details of individual helpers/scripts are not exhaustive. |
| Architecture / dependencies | Three Mermaid diagrams plus inheritance, state, and trust-boundary discussions | Partial: covers core LOP well but lacks a complete call/dependency graph for every extension/helper/script. |
| Core lifecycle | Core fill/cancel/extension/ETH/native flow traced to `OrderMixin`, `OrderLib`, trait and invalidator source | Partial: real source anchors exist, but not every branch/callback/proxy is traced with parameter/state table and test link. |
| Tests | Test names, fixtures, mocks, CI scripts, and gap matrix inspected | Partial: suites have not run; coverage is source-read rather than execution-proven. |
| Security review | Findings/hypotheses separated and source-linked; LOP-01 address selection checked against the pinned SDK and live zkSync addresses; LOP-02 reproduced with mocked HRE config | Preliminary/source-led only; no full dependency review, historical audit-report comparison, deployed LOP proxy immutable check, full-suite execution, or independent second review. |

## Original-prompt deliverable status

| Requested deliverable | Status | Accurate assessment |
|---|---|---|
| Version/instruction/release analysis | **Partial** | Current checkout, tags, branch warning, compiler/build information verified. Full security-relevant release comparison remains. |
| `01-repository-inventory.md` | **Partial** | Useful categorized inventory, but not a recursive row-per-file inventory with all requested fields. |
| `02-system-architecture.md` | **Partial** | Grounded core architecture and diagrams exist; complete component/call graph and every deployment integration do not. |
| File-by-file analyses under `analysis/files/` | **Partial** | All Solidity paths have a note, but notes are summary-only; JS/config/test/deploy per-file analysis is absent. |
| `03-core-protocol-deep-dive.md` | **Partial** | Main hashing, traits, extension, pricing, invalidation, transfer and callback logic are source-traced. Complete per-error/per-assembly/per-edge-case treatment is outstanding. |
| `04-execution-traces.md` | **Partial** | Basic, partial, invalid/cancellation, extension, callback, and native/asset flows are traced. Required scenario-level parameter/state/test tables are incomplete. |
| `05-test-suite-analysis.md` | **Partial** | Source coverage map and gap matrix exist; test execution, full per-file behavior inspection, and failure reproduction are missing. |
| `06-security-review.md` | **Partial** | Preliminary structured review exists. It is not a completed audit and lacks executed PoCs and deployed/integration verification. |
| `07-dependencies-and-trust-boundaries.md` | **Partial** | Direct dependencies and major trust boundaries identified; no full lockfile/transitive or external-library audit. |
| `08-solidity-learning-guide.md` | **Partial** | Repository-grounded concepts provided, but it is concise rather than a comprehensive lesson/test guide. |
| `00-master-handbook.md` | **Partial** | Provides navigation, summary, lifecycle, invariants, glossary, and caveats; does not yet index detailed notes for every first-party file. |
| Accuracy/evidence rules | **Partial** | Citations and target checks were verified; execution and external evidence gaps remain explicitly open. |
| Progress management | **In progress** | This file now records concrete limits and prioritized next work. |

## Tests actually executed

| Command | Actual result |
|---|---|
| `corepack yarn install --frozen-lockfile` | **Exit 0.** Dependencies installed cleanly via Corepack Yarn 1.22.22. |
| `corepack yarn hardhat compile` | **Exit 0.** 131 Solidity contracts compiled successfully with solc 0.8.30 (cancun target). |
| `corepack yarn test:ci` | **Exit 0.** 179 passing (14s), 5 pending (examples). All suite tests green. |
| `corepack yarn hardhat test analysis/tests/native-order-cancellation.test.js` | **Exit 0.** 6 passing (934ms). Verifies native order cancellation under rejecting, out-of-gas, reentrant, and isolated contract maker scenarios. |
| `corepack yarn hardhat test analysis/tests/extension-parser-boundaries.test.js` | **Exit 0.** 9 passing (350ms). Proves safe rejection / EVM revert on out-of-bounds and non-monotonic offsets across `ExtensionLib` and `OrderMixin`. |
| `corepack yarn hardhat test analysis/tests/pricing-and-calculators.test.js` | **Exit 0.** 21 passing (689ms). Audits and verifies arithmetic bounds, oracle staleness, quadratic underflows, fee structures, partial-fill ceilDiv rounding invariants, and pause-resistant cancellations. |
| `corepack yarn hardhat test analysis/tests/cross-component-invariants.test.js` | **Exit 0.** 6 passing (1s). Validates cross-component interactions: flash-swap reentrancy bounding, single-fill reentrancy bit rejection, settlement default rollback, extension immutability across partial fills, EIP-1271 lifecycle vs cancelOrder sovereignty, and pre-interaction caller authentication. |
| `corepack yarn hardhat test analysis/tests/permit2-signature-and-nonce.test.js` | **Exit 0.** 15 passing (4s). Audits Permit2 / Permit2WitnessProxy EIP-712 signature lifecycle, domain separation, verifying contract and spender bindings, deadline expiration, witness hashing, replay protection, multi-transaction partial fill single-use nonce limitations, settlement rollback atomicity, authorization bounds, and access control. |
| `corepack yarn hardhat test analysis/tests/order-authorization-and-settlement.test.js` | **Exit 0.** 16 passing (2s). Audits signed order authorization vs actual settlement: low-80-bit allowedSender access control, timestamp expiration bounds, SeriesEpochManager cancellation, custom receiver/target asset routing, native ETH unwrap and excess refund handling, partial fill restrictions, slippage rate bounds, makerPermit reentrancy detection, and settlement rollback atomicity. |
| All 6 regression suites executed together | **Exit 0.** 73 passing (5s) across all boundary, cancellation, pricing, cross-component, Permit2, and authorization/settlement test suites. |
| `node analysis/tests/lop-deployment-regressions.test.js` | **Exit 0.** Reproduced LOP-02 (`current guard=false`, corrected guard=true) and confirmed the LOP-01 source/SDK address mismatch for chain ID 324. |

## Security status — do not overstate

### Confirmed source defect (operational deployment safety, not a demonstrated funds exploit)

- **LOP-02:** `deploy/deploy-Permit2Proxy.js:15` checks `networkName in hre.config.networks[networkName]`, unlike peer deployment scripts. This makes the intended chain-ID mismatch guard ineffective under normal configuration. It is an operational deployment-safety defect; no external-attacker/funds-loss path has been demonstrated.

### Confirmed address-selection discrepancy (conditional availability/interoperability)

- **LOP-01:** `Permit2WitnessProxy` hardcodes the canonical Permit2 address while the repository's pinned SDK and Uniswap's deployment reference select `0x0000000000225e31D15943971F47aD3022F714Fa` for zkSync (`324`). Both addresses contain verified `Permit2` contracts on zkSync with distinct domain separators. Standard SDK signatures for zkSync will not authorize the canonical contract. Note: `Permit2Proxy.sol` was already resolved via PR #413 by making the address a constructor argument; `Permit2WitnessProxy.sol` retains the hardcoded canonical constant.

### Evaluated and closed hypotheses

- **H-01 (Fee-on-transfer / rebasing tokens):** Closed / Excluded. Immunefi's published bug bounty rules explicitly exclude "Lack of support for Fee-on-Transfer (FoT) tokens" from scope.
- **H-02 (Malformed / non-monotonic extension offsets):** Closed / Refuted as vulnerability. While `OffsetsLib.sol:33` allows unsigned underflow `sub(end, begin)` when $begin > end$, all downstream consumers in `OrderMixin` and `OrderLib` invoke memory allocations or calldatacopy with length $2^{256} - X$, which immediately causes an EVM Out-Of-Gas revert during memory expansion. No out-of-bounds calldata is parsed into state, no signature/hash commitment is bypassed, and no funds can be drained. Automated regression tests verify all 9 boundary conditions.
- **H-03 (Pricing calculations & dynamic amount getters):** Closed / Verified Invariants with Documented Operational Edge Cases (Informational / Low). Audited `AmountCalculatorLib.sol`, `RangeAmountCalculator.sol`, `ChainlinkCalculator.sol`, `DutchAuctionCalculator.sol`, `AmountGetterWithFee.sol`, and `FeeTaker.sol`. Fuzz testing verifies that linear taking amount calculations strictly ceil-round in favor of the maker, ensuring makers receive at least the full expected order amount across any number of partial fills. Identified an arithmetic underflow (`Panic(0x11)`) in `RangeAmountCalculator.getRangeMakerAmount` on dust taking amounts due to integer division truncation in square-root calculations; this causes a fail-safe revert rather than value transfer. Verified oracle staleness (4-hour TTL) and decimal alignment controls.
- **H-04 (Native-order clone lifecycle & cancellation callbacks):** Closed / Confirmed Informational / Low (Griefing Edge Case). Raw ETH transfer callbacks in `NativeOrderImpl._cancelOrder` allow a rejecting or out-of-gas maker contract to revert resolver cancellations. The issue is strictly isolated to the maker's own EIP-1167 clone, cannot block unrelated orders or steal assets, is protected against reentrancy, and maker funds remain recoverable via `withdraw()`. Standard off-chain simulation protects resolvers from broadcasting reverting transactions.
- **H-05 (Governance / pausing trust model):** Closed / Verified Non-Vulnerability (Defensive Protocol Design). Pausing disables fills (`_fill` has `whenNotPaused()`), but all maker order cancellations (`cancelOrder`, `cancelOrders`, bit invalidators, epoch manager) remain 100% operational during a pause. The contract holds no custody of user funds and the owner cannot redirect user assets.
- **H-06 (Cross-component settlement & authorization invariants):** Closed / Verified Cross-Component Invariants (Safe Defensive Architecture). Verified CEI state progression: invalidators are updated at Step 5 prior to pre-interactions, token transfers, or taker callbacks. Reentrant fills during `takerInteraction` are strictly bounded to the remaining unconsumed order amount. Single-fill reentrant attempts immediately revert with `BitInvalidatedOrder()`. Settlement defaults in Step 9 roll back prior transfers and invalidator updates atomically. Extension integrity is re-validated via `isValidExtension()` on every partial fill even when ECDSA recovery is skipped. EIP-1271 contract wallet signature lifecycle requires sovereign `cancelOrder()` to halt subsequent fills. Pre-interaction callers cannot spoof order invalidation.
- **H-07 (Permit2 and Permit2WitnessProxy signature and nonce security):** Closed / Verified Invariants & Confirmed Known Design Constraints (Informational / Operational). Audited EIP-712 typing, domain separation, witness hashing, spender/verifier binding, replay prevention, and atomic rollback across 15 automated tests. Re-verified OpenZeppelin finding L-02: multi-transaction partial fills revert on subsequent fills due to single-use Permit2 nonces; 1inch appropriately restricts Permit2 proxy orders to RFQ (`allowPartialFills: false`). Verified that Step 9 taker settlement defaults roll back Permit2 nonce consumption, preventing griefing. Confirmed access control (`onlyImmutableOwner`) on proxy transfer methods.
- **H-08 (Signed order authorization vs actual settlement):** Closed / Verified Authorization vs Settlement Invariants (Safe Defensive Architecture). Comprehensive review of signed order authorization versus actual on-chain settlement across 16 automated tests (`analysis/tests/order-authorization-and-settlement.test.js`). Verified: 80-bit `allowedSender` exclusivity, timestamp expiration bounds, `SeriesEpochManager` cancellation, custom `receiver` and `target` asset routing, native ETH unwrapping and excess refunding, partial fill restrictions, slippage rate limits, `makerPermit` reentrancy detection (`ReentrancyDetected` and `BitInvalidatedOrder`), and rollback atomicity.

## Prioritized remaining work

1. Correct LOP-02 in `deploy/deploy-Permit2Proxy.js` to match peer scripts (`networkName in hre.config.networks`).
2. Review `Permit2WitnessProxy.sol` deployment pattern for zkSync against `Permit2Proxy.sol` (which was updated in PR #413).
3. Maintain regression suites (`extension-parser-boundaries.test.js`, `native-order-cancellation.test.js`, `pricing-and-calculators.test.js`, `cross-component-invariants.test.js`, `permit2-signature-and-nonce.test.js`, `order-authorization-and-settlement.test.js`) in CI.

## Prioritized remaining work

1. Correct LOP-02 in `deploy/deploy-Permit2Proxy.js` to match peer scripts (`networkName in hre.config.networks`).
2. Review `Permit2WitnessProxy.sol` deployment pattern for zkSync against `Permit2Proxy.sol` (which was updated in PR #413).
3. Maintain regression suites (`extension-parser-boundaries.test.js`, `native-order-cancellation.test.js`, `pricing-and-calculators.test.js`, `cross-component-invariants.test.js`, `permit2-signature-and-nonce.test.js`) in CI.
