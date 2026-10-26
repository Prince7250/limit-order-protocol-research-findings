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
