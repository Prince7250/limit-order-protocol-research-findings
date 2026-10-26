# `contracts/libraries/ExtensionLib.sol`

**Role:** decoder for maker-committed extension bytes. The enum fixes nine field positions: two asset suffixes, two getter payloads, predicate, maker permit, pre/post interaction, custom data (`16-26`).

**Functions:** public internal accessors return calldata slices (`33-107`). `_get` loads first-word offsets and delegates bounds checked extraction to `OffsetsLib` (`121-133`). `customData` begins after offset 8's end.

**Security:** field bytes are signed indirectly through `OrderLib` hash commitment. A malformed but signed offset word can only sabotage the maker's order unless a collision is found; nevertheless bounds/monotonicity fuzzing is recommended. Callers must not interpret absent fields as trusted empty strings without checking their trait flags.
