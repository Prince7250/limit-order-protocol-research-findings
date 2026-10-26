# `contracts/libraries/BitInvalidatorLib.sol`

**Role:** single-fill/cancellation bitmap storage. A nonce's upper bits select mapping slot; its low byte selects one bit.

**Functions:** `checkSlot` reads a word (`29-32`), `checkAndInvalidate` rejects an already-set bit and sets it (`40-46`), `massInvalidate` ORs nonce bit plus caller-supplied mask (`56-61`).

**Security:** it is always used beneath a maker-keyed mapping in `OrderMixin`, preventing cross-maker cancellation. The low-byte choice is deliberate; callers must understand that mass invalidation operates over a 256-order slot.
