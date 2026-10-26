# `contracts/libraries/OffsetsLib.sol`

**Role:** decodes two 32-bit ends from packed offsets and returns a zero-copy calldata segment.

**Function:** `get` derives `begin`/`end`, sets returned slice metadata, and reverts `OffsetOutOfBounds` when `end > concat.length` (`26-38`).

**Security:** the assembly does not independently demand `begin <= end`; the resulting subtraction is unchecked assembly arithmetic. It is fed maker-committed extension data, so no untrusted-extension exploit path was established, but malformed-offset fuzzing should prove no unsafe downstream call is reachable.
