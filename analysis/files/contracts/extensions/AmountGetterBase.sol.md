# `contracts/extensions/AmountGetterBase.sol`

**Role:** optional delegating getter. External methods forward to overridable internals; those either call a 20-byte-prefixed nested getter or apply `Math.mulDiv` linear pricing (`17-78`).

**Security:** nested getter choice/data is signed extension policy. `mulDiv` avoids intermediate overflow and takes a ceiling for taking amount. Empty/short data is deliberately the default formula.
