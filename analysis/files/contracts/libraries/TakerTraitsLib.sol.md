# `contracts/libraries/TakerTraitsLib.sol`

**Role:** decodes taker-controlled flags, 24-bit extension/interaction lengths, and 185-bit threshold. Constants/format are in `10-33`.

**Functions:** `argsHasTarget`, two args lengths, making-mode, maker-WETH unwrap, skip maker permit, Permit2 use, and threshold (`40-106`).

**Security:** the taker selects these fields, so `OrderMixin` must validate their effects. Malformed declared lengths make calldata slicing revert before state change. Threshold zero expressly opts out of price protection; applications should set it for fill protection.
