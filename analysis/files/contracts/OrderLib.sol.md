# `contracts/OrderLib.sol`

**Role:** pure/view order mechanics. Imports ECDSA/Address helpers, trait/extension libraries, default amount math, and the optional amount-getter interface.

**Functions:** `hash` and `hashMemory` construct the exact static EIP-712 struct hash using assembly (`55-88`); `getReceiver` defaults zero receiver to maker (`95-98`); `calculateMakingAmount` and `calculateTakingAmount` either use linear math or call the first 20-byte getter address in signed extension data (`111-165`); `isValidExtension` enforces the `HAS_EXTENSION` flag and low-160-bit Keccak salt commitment (`175-183`).

**Security:** assembly constants `_ORDER_STRUCT_SIZE=0x100` and `_DATA_HASH_SIZE=0x120` must stay synchronized with `IOrderMixin.Order`. Dynamic getters are signed policy but arbitrary external code; the taker threshold is its practical protection. The 160-bit extension commitment is collision-resistant under normal cryptographic assumptions, but is truncated rather than full-hash equality.
