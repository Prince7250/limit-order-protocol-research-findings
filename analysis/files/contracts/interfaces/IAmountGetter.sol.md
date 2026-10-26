# `contracts/interfaces/IAmountGetter.sol`

**Role:** dynamic pricing ABI. `getMakingAmount` and `getTakingAmount` receive full order/extension/hash, taker, requested amount, remaining amount, and opaque trailing data.

**Security:** getters execute as external `view` calls selected by maker-signed extension. `view` does not make a getter trustworthy: it can revert, observe state, use oracle data, or consume gas. Taker thresholds should bound adverse results.
