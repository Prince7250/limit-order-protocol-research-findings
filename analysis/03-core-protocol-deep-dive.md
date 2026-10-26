# Core protocol deep dive

All facts in this document concern `50bd130`. Paths and line numbers are source-relative to that checkout.

## Order data, hashing, and signatures

`IOrderMixin.Order` is eight static ABI words: `salt`, four address-like `Address` values, two amounts, and the `uint256`-backed `MakerTraits` (`contracts/interfaces/IOrderMixin.sol:14-23`). `OrderLib.hash` copies exactly the 0x100-byte struct into memory after its type hash, hashes the resulting 0x120 bytes, then calls EIP-712 typed-data hashing (`contracts/OrderLib.sol:33-66`). The static layout assumption is safe for this exact Solidity struct; changing the struct requires changing both its type hash and the assembly constants.

For an EOA maker, first fill requires `maker == ECDSA.recover(orderHash,r,vs)` (`OrderMixin.sol:169-185`). The compact `r,vs` signature format inherits low-s and valid-v checks from `@1inch/solidity-utils` ECDSA. For a contract maker, first fill calls `ECDSA.isValidSignature(maker, orderHash, signature)` (`OrderMixin.sol:222-239`), the EIP-1271 path. No signature is rechecked after the first fill: correctness then depends on the order hash's state record and the invariant that state was recorded before interactions.

The standard LOP has an OpenZeppelin `EIP712` domain (name `1inch Limit Order Protocol`, version `4`) and therefore includes `block.chainid` and `address(this)`. This prevents ordinary cross-chain and cross-LOP replay. `EIP712Alien` exists only for native-order factory/clone validation: it binds the domain's `verifyingContract` to the LOP address although code executes in a clone (`contracts/utils/EIP712Alien.sol:52-84`).

## Maker traits and taker traits

`MakerTraitsLib` packs policy into one word (`contracts/libraries/MakerTraitsLib.sol:29-180`):

| Bits | Field | Runtime use |
|---|---|---|
| 255 | no partial fills | Requires `makingAmount == order.makingAmount`. |
| 254 | allow multiple fills | Together with no-partial selects bitmap vs remaining-accounting mode. |
| 252 / 251 | pre / post interaction | Enables maker-signed external callback. |
| 250 | epoch check | Requires `SeriesEpochManager.epochEquals`; incompatible with bitmap. |
| 249 | has extension | Requires matching nonempty extension. |
| 248 | maker uses Permit2 | Makes LOP call the configured Permit2 transfer helper. |
| 247 | unwrap taker WETH | Sends received WETH as ETH to order receiver. |
| 0..79 | allowed sender suffix | Compares only the low 80 bits of `msg.sender`; zero means public. |
| 80..119 | expiration | `expiration < block.timestamp` means expired; equality remains fillable in that block. |
| 120..159 / 160..199 | nonce-or-epoch / series | Bitmap key or epoch comparison input. |

The low-80-bit private-order comparison is a deliberate compacting trade-off, not a full-address equality guarantee. An adversary matching a chosen 80-bit suffix has a 1-in-2^80 search problem, impractical under standard assumptions but worth stating in integrator documentation.

`useBitInvalidator` returns true unless **both** partial fills and multiple fills are allowed (`MakerTraitsLib.sol:151-153`). Thus every fill of a bitmap order consumes the nonce bit and cannot be followed by another fill; remaining-based orders preserve a per-order amount.

`TakerTraits` chooses requested-amount direction, unwrapping of the maker asset, permit skipping/Permit2 for taker funds, optional target, two 24-bit args lengths, and a 185-bit limit (`contracts/libraries/TakerTraitsLib.sol:21-106`). The caller controls these values, so the contract verifies the rate against its caller-supplied threshold only when the threshold is nonzero.

## Extension binding and parsing

An extension is not part of the EIP-712 struct. If `HAS_EXTENSION` is set, `OrderLib.isValidExtension` requires nonempty bytes and compares the extension's `keccak256` low 160 bits with `salt` low 160 bits; if it is unset, any extension is rejected (`OrderLib.sol:175-183`). This binds all predicate, callback, getter, permit, proxy-suffix, and custom data selected by the extension.

The first extension word is nine packed 32-bit field ends. `OffsetsLib.get` derives `begin` and `end` and reverts if `end` exceeds the concatenated payload length (`OffsetsLib.sol:26-38`). `ExtensionLib` exposes fields in this fixed order: maker suffix, taker suffix, making getter data, taking getter data, predicate, maker permit, pre data, post data, then custom tail (`ExtensionLib.sol:16-132`). The getter does not enforce monotonic offsets explicitly; malformed signed extensions may revert or produce unusable slices. Since the maker commits to the bytes, this is principally a maker/configuration availability risk; property testing should nevertheless fuzz the parser.

## Validation and amount calculation

`_fill` validates in this order (`OrderMixin.sol:263-342`):

1. extension commitment;
2. allowed sender, expiry, and optional series/epoch equality;
3. optional static predicate, accepting only an exact 32-byte return whose decoded word is `1`;
4. amount direction and taker threshold;
5. no-partial policy and nonzero amounts;
6. bitmap or remaining state update.

The default price formula floors a computed making amount and ceils a computed taking amount (`AmountCalculatorLib.sol:9-27`), favoring the maker at integer boundaries. Dynamic getter bytes begin with a 20-byte getter address and forward remaining data, full order, extension, hash, taker, request, and remaining amount (`OrderLib.sol:111-165`). Getters are `view` interface calls but can still revert, consume gas, or return adverse values; their address is maker-committed and taker slippage limits are the counterparty protection.

The rate checks use cross-multiplication. Ordinary checked arithmetic means huge values may revert rather than wrap. That can make a particular pathological order unavailable but does not silently bypass its taker limit.

## State and cancellation

`BitInvalidatorLib.Data` maps `nonce >> 8` to a 256-bit word; bit `nonce & 0xff` denotes consumed/cancelled (`contracts/libraries/BitInvalidatorLib.sol:18-61`). `bitsInvalidateForOrder` permits its caller to OR an additional mask only when its supplied traits select the bitmap path. Since all mutable state is keyed by `msg.sender`, a caller cannot cancel another maker's orders.

`RemainingInvalidator` is zero for a never-filled order and `~remaining` after a fill. `fullyFilled()` is all ones and decodes to zero (`contracts/libraries/RemainingInvalidatorLib.sol:24-79`). On a first fill the state is set before any callback; an EOA-maker permit call is the sole pre-state external call. For a remaining-based order, after `tryPermit` it explicitly demands that the record is still new and otherwise reverts `ReentrancyDetected` (`OrderMixin.sol:169-185`). A nested bit-order fill can cause the enclosing frame to later fail its bitmap update, rolling back the whole transaction; it cannot commit two fills.

`cancelOrder` switches purely on supplied traits: bitmap orders set a bit, remaining orders mark the passed hash fully filled. This is intentional and the caller's own state namespace is the authorization mechanism (`OrderMixin.sol:80-109`). Epoch invalidation is maker-controlled through inherited `advanceEpoch`; only orders carrying the epoch flag consult it.

## Transfers, WETH, permits, callbacks

After state update, pre-interaction is called (default listener is maker; the signed extension may prefix a target address). Then maker asset transfer occurs, optional taker interaction, taker asset transfer, optional post-interaction, and `OrderFilled` (`OrderMixin.sol:344-440`). A callback revert reverts all prior state and transfers atomically.

Ordinary token transfers use hand-built calldata `transferFrom(from,to,amount) || suffix`; success permits no return data or at least 32 bytes whose first word equals one (`OrderMixin.sol:509-522`). The suffix supports ERC-721/1155 and Permit2 proxy adapters. This intentionally trusts the selected token/proxy: fee-on-transfer, rebasing, dishonest return values, or nonstandard callback behavior are not balance-accounted for by LOP.

For WETH, the maker asset can be unwrapped to the target when the **taker** requests it; the taker asset can be supplied by `msg.value` only when it equals configured WETH, and the maker's trait selects whether it becomes WETH or ETH (`OrderMixin.sol:357-425`). ETH refunds/payments use unrestricted gas `call` and revert on failure. `OnlyWethReceiver` constrains direct ETH reception in the main mixin to WETH withdrawals, narrowing an accidental-ETH balance surface.

Native Permit2 paths provided by solidity-utils reject suffixes. The separate selector-compatible `Permit2Proxy`/`Permit2WitnessProxy` instead appear as the order asset and receive the signature/permit in the signed suffix. Permit2 SignatureTransfer nonces are single use; orders built around it are not intrinsically multi-fill compatible.

## Pseudocode: core fill

```text
hash := EIP712(order)
remaining := bitmap ? order.makingAmount : decodeRemaining(hash, order.makingAmount)
if first fill: validate EOA/EIP-1271 signature; optionally execute maker permit
validate extension, sender suffix, expiry, epoch, predicate
derive (making,taking), clamp to remaining, apply taker threshold
require permitted partiality and both values nonzero
write invalidator BEFORE all callbacks/transfers
pre-callback if signed
transfer maker asset to target (possibly unwrap WETH)
taker callback if supplied by caller
collect taker asset to receiver (possibly wrap/unwrap WETH)
post-callback if signed
emit remaining amount
```

The key audit invariant is that no successful external callback or transfer can observe the pre-fill validity state. The only special case, a first-fill maker permit, has the explicit remaining-order reentrancy guard described above.
