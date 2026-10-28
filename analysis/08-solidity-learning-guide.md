# Solidity security learning guide, grounded in this repository

## Atomicity and external calls

An EVM transaction either commits all nested calls and storage changes or reverts all of them. LOP relies on this in `OrderMixin._fill`: it updates fill state before calling callbacks/tokens, and if any later transfer/callback fails the state update rolls back too. This is the checks-effects-interactions pattern in a composable form. Test it by making a callback revert after maker asset transfer and asserting both token balances and remaining invalidator are unchanged.

## Storage, memory, and calldata

`Order` is static calldata: eight words read directly by `OrderLib.hash` with `calldatacopy` (`OrderLib.sol:55-64`). That saves gas but makes source layout a security invariant. `ExtensionLib` returns `bytes calldata` windows rather than copying all extension bytes. `OffsetsLib` manually writes calldata slice offset/length in assembly, so fuzzing bounds is the appropriate audit technique. Storage is used only for protocol state in the invalidator mappings and epochs; most order data remains off-chain until a fill.

## Packed bits

`MakerTraits` and `TakerTraits` encode many options in a `uint256`. For instance, `nonce >> 8` chooses a bitmap slot and `1 << (nonce & 0xff)` chooses a bit (`BitInvalidatorLib.sol:40-45`). Bit packing makes fills cheap but auditing requires a table of bit positions and tests that independent flags cannot overlap. A useful invariant: changing only low eight nonce bits must never change bitmap slot, while changing a high nonce bit must never change a different bit in the same slot unintentionally.

## EIP-712 and replay prevention

Keccak hashes order fields; EIP-712 adds a domain separator with name, version, chain ID, and verifying contract. Thus the same structure signed on one chain/LOP address does not verify on another ordinary LOP deployment. `OrderLib.hash` is the source of truth, and `test/Eip712.js` checks the standard domain. Replay on the same domain is stopped by bit/remaining invalidators, not merely by signatures.

## Signatures: EOA versus contract maker

EOA fill uses compact ECDSA recovery. Contract-maker fill delegates validity to ERC-1271 (`fillContractOrder`), enabling Gnosis Safe and the native escrow clone. Audit both paths: ECDSA needs strict malleability handling in its external library; EIP-1271 needs magic-value/revert/short-input tests because the contract maker is arbitrary code.

## ERC-20 allowances, permits, and Permit2

An ERC-20 allowance lets LOP call `transferFrom`; a permit can establish allowance in the same fill transaction. `PermitAndCall.tryPermit` is called only at first fill and before the core fill's state write, so `OrderMixin` adds a remaining-order reentrancy check afterward. Permit2 is a separate authorization system with nonce/deadline semantics. LOP has native Permit2 helpers and selector-collision proxies, so reviewers must establish *which* path applies and whether the Permit2 address is correct on the target chain.

## Partial-fill math

Given total maker amount M and total taker amount T, requested maker amount m costs `ceil(m*T/M)`; requested taker amount t receives `floor(t*M/T)`. Ceiling prevents undercharging maker asset; floor prevents over-delivering it. Dynamic calculators receive the remaining amount, letting price vary by time or already-filled volume. Test invariant: for every successful fill `0 < making <= remaining`, and an enabled taker threshold is satisfied using the exact post-clamp amounts.

## Reentrancy

Tokens and callbacks can execute arbitrary code. LOP intentionally permits callback composition, so a global mutex would change product behavior. Instead it commits invalidation before pre/taker/post calls. The special permit callback is the one pre-commit call; the code detects a changed remaining invalidator afterward. When auditing a new callback/proxy, draw the exact sequence and ask: what state is visible now; can nested execution consume an order; and does an outer revert roll it back?

## Gas optimization and assembly

This code uses calldata slices, static struct hashing, packed flags, complement encoding, manually built transfer calldata, and optimized common arithmetic. These reduce gas but shift safety into exact length/layout conditions. Do not infer safety from `memory-safe` labels: they are promises to the compiler. Review each assembly block's input bounds, memory writes, return data assumptions, and any behavior when calldata is malformed.

## A practical audit loop for this codebase

1. Start from one public fill function and annotate every validation, state write, and external call.
2. Decode every trait bit that affects the path.
3. Identify data controlled by maker versus taker versus deployment operator.
4. Form one invariant (for example no two successful fills pay more than total maker amount).
5. Search test coverage; create a hostile mock if missing.
6. Only call a concern a finding after demonstrating an attacker-controlled path and meaningful impact.


---

## Lesson: ERC-1155 and ERC-721 Safe Transfer Callbacks & CEI Invalidation

### 1. The Vulnerability Pattern: Implicit External Callbacks in Asset Transfers
When smart contracts transfer ERC-20 tokens via `transferFrom`, the execution flow typically remains internal to the token ledger (except for ERC-777/ERC-1363 hooks). However, ERC-1155 (`safeTransferFrom`) and ERC-721 (`safeTransferFrom`) explicitly invoke receiver callbacks on contract recipients:
- ERC-1155: `IERC1155Receiver(to).onERC1155Received(...)`
- ERC-721: `IERC721Receiver(to).onERC721Received(...)`

If a protocol issues asset transfers before updating order invalidation state, a recipient contract can hijack execution during the callback and reentrantly invoke the swap function with the original order parameters.

### 2. The Defensive Mechanism: Pre-Transfer State Invalidation & Atomic Rollback
In `1inch Limit Order Protocol` (`contracts/OrderMixin.sol:340`), the contract strictly enforces Checks-Effects-Interactions (CEI):
1. **Effects (Step 5):** Order invalidation is committed to storage:
   - Single-fill orders flip the bitmask in `_bitInvalidator[maker]`.
   - Partial-fill orders decrement `_remainingInvalidator[maker][orderHash]`.
2. **Interactions (Step 6):** `_callTransferFromWithSuffix` invokes `ERC1155Proxy.func_301JL5R` or `ERC721ProxySafe.func_30iH1gK`.
3. **Defense Against Reentrancy:** If the recipient attempts a reentrant fill inside `onERC1155Received`:
   - Single-fill reentrant calls immediately revert with `BitInvalidatedOrder()` (`0xa4f62a96`).
   - Partial-fill reentrant calls see the reduced `remainingMakingAmount`, guaranteeing that the total volume filled across nested executions never exceeds the order's limit.
4. **Atomicity:** If the receiver reverts or returns an invalid selector, the proxy call reverts, triggering `TransferFromMakerToTakerFailed()` and reverting all state changes atomically.

### 3. Empirical Verification
- Tested in `analysis/tests/asset-proxies-and-callbacks.test.js` (10 passing tests).

---

## Lesson: One-Time Order ID Invalidation & Fail-Closed Unchecked Arithmetic

### 1. Architectural Pattern: One-Time Order ID Binding vs Reusable Nonce Channels
In off-chain exchange architectures, client order IDs (`orderId`) are often recycled across trading sessions or treated as reusable slots. However, on-chain exclusivity mechanisms like `OrderIdInvalidator.sol` implement an immutable one-time binding:
```solidity
uint32 orderId = uint32(bytes4(extraData));
bytes32 storedOrderHash = _ordersIdsHashes[order.maker.get()][orderId];
if (storedOrderHash == 0x0) {
    _ordersIdsHashes[order.maker.get()][orderId] = orderHash;
} else if (storedOrderHash != orderHash) {
    revert InvalidOrderHash();
}
```
**Key Takeaways:**
- **OCO (One-Cancels-the-Other) Semantics:** When a maker publishes multiple alternative quotes sharing the same `orderId` (e.g. Dutch auction price points or multiple trading pairs), filling even 1 wei of Quote A permanently commits `_ordersIdsHashes[maker][orderId] = hash(A)`. Quote B can never be filled.
- **Permanent State:** In the absence of a reset or clear function, once an `orderId` is used, it cannot be recycled for a new order with a different hash.
- **Maker Namespacing:** Storage must be namespaced by `maker` (`_ordersIdsHashes[maker][orderId]`) to ensure one user cannot deny service to another user by claiming their IDs.

### 2. Arithmetic Invariant: Fail-Closed Behavior in `unchecked` Gas Price Checks
In `PriorityFeeLimiter.sol`:
```solidity
unchecked {
    uint256 baseFee = block.basefee;
    uint256 priorityFee = tx.gasprice - baseFee;

    if (baseFee < 10.6 gwei) {
        return priorityFee * 100 <= baseFee * 70;
    } else if (baseFee < 104.1 gwei) {
        return priorityFee * 2 <= baseFee;
    } else {
        return priorityFee * 100 <= baseFee * 65;
    }
}
```
**Why this arithmetic is secure:**
- On normal EVM networks (EIP-1559), consensus enforces `tx.gasprice >= baseFee`, so `priorityFee >= 0`.
- If an anomalous environment or simulated call produces `tx.gasprice < baseFee`, the subtraction wraps around in `unchecked` to $2^{256} - \Delta$.
- Multiplying $(2^{256} - \Delta) \times 100 \pmod{2^{256}} = 2^{256} - 100\Delta$.
- Because $\Delta \le \text{baseFee}$, $2^{256} - 100\Delta$ is an astronomically large number ($\approx 10^{77}$) that can never satisfy $\le \text{baseFee} \times 70$ unless baseFee exceeds $6.8 \times 10^{56}$ ETH.
- Therefore, the function is mathematically guaranteed to return `false` (fail-closed), causing `OrderMixin` to revert with `PredicateIsNotTrue()`. No unauthorized fills can occur.

### 3. Empirical Verification
- Tested in `analysis/tests/h14-order-id-invalidator.test.js` (9 passing tests).
- Tested in `analysis/tests/h14-priority-fee-limiter.test.js` (14 passing tests).

---

## Lesson: Quadratic Curves, Square-Root Truncation & Fail-Safe Underflow Boundaries

### 1. Mathematical Architecture: Linear Price Trajectory & Quadratic Token Integrals
In `RangeAmountCalculator.sol`, the marginal price of maker asset scales linearly across the order size from $pStart$ to $pEnd$:
$$P(x) = k \cdot x + pStart, \quad \text{where } k = \frac{(priceEnd - priceStart) \times 1e18}{orderMakingAmount}$$

When integrating marginal price $P(x)$ to determine total taking tokens required for $x$ making tokens:
$$\text{TakingAmount}(x) = \int_{0}^{x} (k \cdot u + pStart) \, du = \frac{1}{2} k x^2 + pStart \cdot x$$

Inverting this quadratic formula to solve for making amount $x$ given an incremental taking amount $\Delta T$ yields:
$$x = \sqrt{\left(\frac{pStart}{k} + x_0\right)^2 + \frac{2 \Delta T \times 1e18}{k}} - \left(\frac{pStart}{k} + x_0\right)$$
where $x_0 = \text{alreadyFilledMakingAmount}$ and $bDivK = \frac{pStart \times 1e18}{k}$.

### 2. The Defensive Invariant: Rounding Favors the Maker
In decentralized exchanges, arithmetic rounding must never disadvantage the passive maker:
- In `AmountCalculatorLib.sol:getMakingAmount`:
  $$\text{makingAmount} = \left\lfloor \frac{\text{takingAmount} \times \text{orderMakingAmount}}{\text{orderTakingAmount}} \right\rfloor$$
  Flooring the making amount means the taker receives at most their fair share (often 1 wei less).
- In `AmountCalculatorLib.sol:getTakingAmount`:
  $$\text{takingAmount} = \left\lceil \frac{\text{makingAmount} \times \text{orderTakingAmount}}{\text{orderMakingAmount}} \right\rceil$$
  Ceiling the taking amount ensures the taker pays at least their fair share.
- In multi-step partial fills, this ceil-rounding creates a minute surplus (1–2 wei) delivered to the maker.

### 3. Zero-Amount Asset Protection: Downstream Guards
If a taker submits an infinitesimal dust amount where floored calculation produces 0 tokens:
- `OrderMixin.sol:335` enforces:
  ```solidity
  unchecked {
      if (makingAmount * takingAmount == 0) revert SwapWithZeroAmount();
  }
  ```
- This prevents attackers from extracting tokens or triggering callbacks with zero payment.

### 4. Anatomy of the `Panic(0x11)` Dust Underflow (LOP-03)
In `RangeAmountCalculator.sol:97-103`:
```solidity
uint256 sqrtVal = Math.sqrt(
    bDivKPlusAlreadyFilledMakingAmount * bDivKPlusAlreadyFilledMakingAmount +
    takingAmount * 2e18 / k * 1e18
);
makingAmount = (sqrtVal - bDivK) - alreadyFilledMakingAmount;
```
**Why underflow occurs:**
1. **Premature Truncation:** Line 102 divides `(takingAmount * 2e18) / k` *before* multiplying by `1e18`. For small `takingAmount`, integer division truncates fractional remainder.
2. **Floor of Square Root:** `Math.sqrt` computes $\lfloor \sqrt{X} \rfloor$.
3. **The Precision Deficit:** When $\Delta T$ is small (e.g. 173 wei with $pStart = 0.082989$, $pEnd = 0.172986$, $oMA = 1e14$), the addition under the radical adds fewer precision units than lost by truncation:
   $$\sqrt{X^2 + \epsilon} \approx X + \frac{\epsilon}{2X}$$
   If intermediate truncation drops 2196 units of precision, $\lfloor \sqrt{X^2 + \text{truncated}} \rfloor = X - 2196$.
4. **Unsigned Subtraction:** `(sqrtVal - bDivK) - alreadyFilledMakingAmount` attempts to subtract $X$ from $X - 2196$, producing a negative integer.
5. In Solidity 0.8+, checked arithmetic converts this directly to an EVM `Panic(0x11)` revert.

### 5. Security & Bounty Classification
- **Fail-Safe Execution Halt:** The `Panic(0x11)` halts execution cleanly. State is reverted atomically. No tokens can be stolen, locked, or misaccounted.
- A fill slightly above dust (e.g., 213 wei instead of 173 wei) passes cleanly and settles normally.
- This constitutes an informational arithmetic boundary condition rather than a smart contract vulnerability.

### 6. Empirical Verification
- Tested in `analysis/tests/h15-range-amount-calculator.test.js` (18 passing unit and integration tests).

---

## Lesson: Tightly Packed Calldata Whitelists, Dual-Tier Resolver Gating & Exact Token Conservation

### 1. Calldata Efficiency: 10-Byte Address Packing
In high-frequency decentralized limit order protocols, passing dynamic arrays of 20-byte addresses in order extensions incurs significant calldata gas costs.
In `AmountGetterWithFee.sol`:
```solidity
uint80 maskedTakerAddress = uint80(uint160(taker));
uint256 size = uint8(whitelistData[0]);
bytes calldata whitelist = whitelistData[1:1 + 10 * size];
tail = whitelistData[1 + 10 * size:];
for (uint256 i = 0; i < size; i++) {
    uint80 whitelistedAddress = uint80(bytes10(whitelist[:10]));
    if (maskedTakerAddress == whitelistedAddress) {
        return (true, tail);
    }
    whitelist = whitelist[10:];
}
```
**Key Concepts:**
- **Packing Format:** 1 byte size prefix ($N$) followed by $N \times 10$ bytes of raw address suffixes.
- **Cryptographic Collision Resistance:** Comparing the lowest 80 bits of an address provides an $2^{80}$ work barrier ($\approx 1.2 \times 10^{24}$ iterations) against brute-force collision attacks, consistent with the `_ALLOWED_SENDER_MASK` in `MakerTraitsLib.sol`.
- **Calldata Slicing Safety:** In Solidity 0.8+, accessing a calldata slice beyond the end of input reverts with empty returndata, preventing out-of-bounds memory reading.

### 2. Dual-Tier Resolver Access Gate: Whitelist vs Access Token
In `FeeTaker.sol`:
```solidity
(bool isWhitelisted, uint256 integratorFee, uint256 integratorShare, uint256 resolverFee, bytes calldata parsedTail) = _parseFeeData(extraData, taker, orderHash, _isWhitelistedPostInteractionImpl);
if (!isWhitelisted && _ACCESS_TOKEN.balanceOf(taker) == 0) revert OnlyWhitelistOrAccessToken();
```
- **Privileged Tier (Whitelisted Resolvers):** Receive a fee discount on `resolverFee` via `resolverFee * whitelistDiscountNumerator / 100` and are exempted from holding access tokens.
- **Standard Tier (Permissionless Staked Resolvers):** Non-whitelisted resolvers must hold `_ACCESS_TOKEN` (e.g. 1INCH) to fill orders and pay the full undiscounted resolver fee.
- **Unauthorized Takers:** Any caller lacking both conditions reverts immediately with `OnlyWhitelistOrAccessToken()`, rolling back state atomically.
- **Caller Identity Binding:** The protocol passes `msg.sender` directly to both `IAmountGetter` and `IPostInteraction`, preventing identity spoofing via calldata injection.

### 3. Exact Fee Conservation: Eliminating Dust Leakage
When dividing fees between multiple parties (integrator, protocol, maker):
```solidity
uint256 denominator = _BASE_1E5 + integratorFee + resolverFee;
uint256 integratorFeeTotal = takingAmount.mulDiv(integratorFee, denominator);
integratorFeeAmount = integratorFeeTotal.mulDiv(integratorShare, _BASE_1E2);
protocolFeeAmount = takingAmount.mulDiv(resolverFee, denominator) + integratorFeeTotal - integratorFeeAmount;
```
Notice the algebraic structure:
$$\text{integratorFeeAmount} + \text{protocolFeeAmount} = \text{takingAmount} \cdot \frac{\text{resolverFee}}{\text{denominator}} + \text{integratorFeeTotal}$$
$$\text{receiverAmount} = \text{takingAmount} - \text{integratorFeeAmount} - \text{protocolFeeAmount}$$
Because the remaining fraction after `integratorFeeAmount` is directly added to `protocolFeeAmount`, rounding errors in the revenue share cannot leave dust unallocated.
Furthermore:
$$\sum \text{fees} + \text{receiverAmount} \equiv \text{takingAmount}$$
Every single wei received by `FeeTaker` is guaranteed to be distributed, leaving zero token balance trapped in the contract.

### 4. Empirical Verification
- Tested in `analysis/tests/h16-whitelist-resolver-fees.test.js` (24 passing unit and integration tests).
