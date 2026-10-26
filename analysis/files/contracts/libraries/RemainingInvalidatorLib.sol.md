# `contracts/libraries/RemainingInvalidatorLib.sol`

**Role:** encodes remaining maker amount as a complement. Raw zero means a fresh order; raw `~remaining` means it has been touched; all ones means fully filled/cancelled.

**Functions:** `isNewOrder`, two `remaining` variants, `remains`, and `fullyFilled` occupy `24-79`.

**Security:** caller must use the two-argument `remaining` for an unknown order; the one-argument variant intentionally reverts. `remains` is unchecked but called after computed `makingAmount <= remaining`; that precondition is essential to prevent underflow.
