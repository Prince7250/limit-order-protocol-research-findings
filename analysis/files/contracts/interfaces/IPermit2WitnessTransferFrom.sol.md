# `contracts/interfaces/IPermit2WitnessTransferFrom.sol`

**Role:** minimal Permit2 witness transfer ABI and its structs (`5-35`).

**Security:** the witness type string and Permit2 target must match the external deployment exactly. `Permit2WitnessProxy`'s fixed target is reviewed separately because chain selection is security-sensitive.
