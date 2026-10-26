# `contracts/libraries/MakerTraitsLib.sol`

**Role:** decodes `MakerTraits` packed into `uint256`. Flags and low-field positions are documented in lines `11-27` and constants at `30-46`.

**Functions:** reads extension, allowed-sender suffix, expiry, nonce/epoch, and series (`54-104`); reads fill/callback/epoch/Permit2/WETH flags (`112-180`); `useBitInvalidator` returns true unless *both* partial and multiple fills are allowed (`151-153`).

**Security:** allowed sender intentionally compares only low 80 address bits (`64-67`), a gas/storage trade-off. Expiration is strict less-than, so equality is valid. Trait decoding controls the invalidation mechanism and consequently must remain bit-compatible with off-chain utilities.
