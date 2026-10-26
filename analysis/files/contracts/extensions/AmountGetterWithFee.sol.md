# `contracts/extensions/AmountGetterWithFee.sol`

**Role:** fee-aware pricing layer over `AmountGetterBase`. It parses integrator/resolver fee and whitelist data, reducing maker amount or increasing taking amount consistently (`24-120`).

**Security:** malformed short fee data panics/reverts; signed extension means it is a configuration/availability issue. Validates share and discount at 0..100. Whitelist compares only low 80 address bits, same compact-collision trade-off as private sender traits.
