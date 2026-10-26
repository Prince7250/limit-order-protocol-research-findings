# Researcher Status: Prince

## 1. Current Assignment & Hypothesis

| Property | Value |
| :--- | :--- |
| **Researcher** | Prince (Primary Researcher / Lead) |
| **Active Hypothesis** | **H-09: Asset-Proxy Callbacks, Reentrancy & Pre/Post-Interaction Boundaries** |
| **Domain** | Asset Proxies, Pre/Post-Interactions, Callback Ordering, Settlement Invariants |
| **Target Release** | Git Tag `4.3.4` (Commit `0a40e01befff19d925457b55191900fb456c2dd2`) |
| **Task Status** | **Partially completed** (Source analysis done; test suite pending execution) |

---

## 2. Source Files & Function Coverage

| File | Target Functions | Prior Investigation | Formal Task Status | Notes & Invariant Checks |
| :--- | :--- | :--- | :--- | :--- |
| [`contracts/extensions/ERC721Proxy.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/ERC721Proxy.sol) | `func_60iHVgK` | Inventory note | **Partially completed** | Verify unused `amount` parameter prevents fractional NFT transfers; test partial-fill taker traits. |
| [`contracts/extensions/ERC721ProxySafe.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/ERC721ProxySafe.sol) | `func_30iH1gK` | Inventory note | **Partially completed** | Test `onERC721Received` hook during `_fill`; verify reentrancy lock. |
| [`contracts/extensions/ERC1155Proxy.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/ERC1155Proxy.sol) | `func_301JL5R` | Inventory note | **Partially completed** | Test `onERC1155Received` callback during `makerAsset` transfer (Step 6) and `takerAsset` transfer (Step 8). |
| [`contracts/extensions/ApprovalPreInteraction.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/ApprovalPreInteraction.sol) | `preInteraction`, `isValidSignature` | Inventory note | **Partially completed** | Check non-standard ERC20 allowance reset, allowance race condition between fills. |
| [`contracts/extensions/OrderIdInvalidator.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/OrderIdInvalidator.sol) | `preInteraction` | Inventory note | **Partially completed** | Verify whether frontrunning or dust fills can lock `orderId` permanently (no cancel function). |
| [`contracts/extensions/PrioirityFeeLimiter.sol`](file:///d:/limit-order-protocol-research-findings/contracts/extensions/PrioirityFeeLimiter.sol) | `isPriorityFeeValid` | Inventory note | **Partially completed** | Check `tx.gasprice - baseFee` arithmetic underflow on L2 networks. |
| [`contracts/OrderMixin.sol`](file:///d:/limit-order-protocol-research-findings/contracts/OrderMixin.sol) | `_fill`, `_makeCalls`, `_remainingInvalidator` | H-02, H-05..H-08 | **Completed and supported by evidence** | Core CEI ordering, amount caps, and invalidator updates verified across 73 tests. |

---

## 3. Tasks Completed and Supported by Evidence (Do Not Repeat)

The following areas are closed and supported by passing tests in `analysis/tests/`; they should not be re-investigated:

1. **H-01 (Fee-on-transfer / rebasing tokens):** Closed based on documented evidence (Immunefi program exclusion).
2. **H-02 (Extension parser offsets):** Closed based on documented evidence (9 tests in `extension-parser-boundaries.test.js`).
3. **H-03 (Pricing and calculators):** Completed and supported by evidence (21 tests in `pricing-and-calculators.test.js`).
4. **H-04 (Native order cancellation):** Completed and supported by evidence (6 tests in `native-order-cancellation.test.js`).
5. **H-05 (Governance & pausing):** Closed based on documented evidence (verified pause sovereignty).
6. **H-06 (Cross-component settlement):** Completed and supported by evidence (6 tests in `cross-component-invariants.test.js`).
7. **H-07 (Permit2 signature & nonces):** Completed and supported by evidence (15 tests in `permit2-signature-and-nonce.test.js`).
8. **H-08 (Authorization vs settlement):** Completed and supported by evidence (16 tests in `order-authorization-and-settlement.test.js`).
9. **LOP-01 & LOP-02 (Permit2 deployment & address defects):** Completed and supported by evidence (2 tests in `lop-deployment-regressions.test.js`).

---

## 4. Unresolved Questions for H-09

1. **ERC1155 Safe Transfer Callback Reentrancy:**  
   In `LimitOrderProtocol._fill`:
   - Step 6 transfers `makerAsset` from maker to taker/receiver via `_makeCalls`.
   - If `makerAsset` is `ERC1155Proxy`, it invokes `token.safeTransferFrom(from, to, tokenId, amount, data)`.
   - If `to` is a contract, `onERC1155Received` is executed.
   - Does this callback execute before `takerInteraction` (Step 7) and taker asset transfer (Step 8)?
   - Can the receiver call back into `fillOrder` or `cancelOrder` during this window?
2. **ERC721Proxy Partial Fill Behavior:**  
   `func_60iHVgK` ignores the `amount` parameter:
   ```solidity
   function func_60iHVgK(address from, address to, uint256 /* amount */, uint256 tokenId, IERC721 token)
   ```
   If a taker submits a partial fill (e.g. `makingAmount = 1`, but taker specifies taking 50% of the order), how does `OrderMixin` calculate taking amount? Does it attempt to transfer 0.5 NFT or fail?
3. **OrderIdInvalidator Dust Lock Denial of Service:**  
   In `OrderIdInvalidator.sol`, `_ordersIdsHashes[maker][orderId]` is permanently set upon first execution. If an attacker fills 1 wei of a maker's order with a specified `orderId`, does this permanently prevent the maker from ever using that `orderId` again, even if the original order is cancelled?

---

## 5. Recommended Next Task

Construct and execute the automated test suite in `analysis/tests/asset-proxies-and-callbacks.test.js`:
- Test 1: `ERC1155Proxy` `onERC1155Received` reentrant call to `fillOrder` (verify remaining invalidator reentrancy lock).
- Test 2: `ERC1155Proxy` `onERC1155Received` reentrant call to `cancelOrder` (verify order cancellation during mid-fill).
- Test 3: `ERC721Proxy` partial fill attempt with non-zero remainder.
- Test 4: `OrderIdInvalidator` dust fill permanent locking test.
