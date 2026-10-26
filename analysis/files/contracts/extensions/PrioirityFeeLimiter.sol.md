# `contracts/extensions/PrioirityFeeLimiter.sol`

**Role:** predicate helper (filename has a typo) that caps priority fee as a percentage of `block.basefee` across three fee bands (`6-25`).

**Security:** uses unchecked `tx.gasprice - basefee`; EIP-1559 normally guarantees nonnegative priority fee, but nonstandard chain semantics should be checked. It is maker-selected policy, not a protocol access control.
