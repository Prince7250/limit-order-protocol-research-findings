# `contracts/helpers/SeriesNonceManager.sol`

**Role:** independently deployed predicate helper, not the state manager inherited by LOP. It stores `nonce[series][maker]` and provides time/nonce predicate helpers.

**Security:** any caller advances only its own nonce; 1..255 increments bound a single call. `timestampBelowAndNonceEquals` decodes 40-bit time/nonce, 16-bit series, and 160-bit account from packed input, so off-chain packing must match exactly.
