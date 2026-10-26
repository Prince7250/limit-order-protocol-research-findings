# `contracts/helpers/SafeOrderBuilder.sol`

**Role:** Gnosis Safe helper that adjusts taking amount using two fresh Chainlink answers, marks the Safe message hash as preapproved, and registers with `OrderRegistrator` (`47-73`).

**Security:** it inherits Safe storage and is intended to execute in Safe context. Oracle TTL is caller-supplied and negative answers are cast to `uint256`, so a malformed feed response reverts rather than becoming sane pricing. Safe owner/module/fallback authority and order registrator configuration are external trust assumptions.
