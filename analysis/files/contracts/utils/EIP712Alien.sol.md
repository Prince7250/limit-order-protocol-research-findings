# `contracts/utils/EIP712Alien.sol`

**Role:** EIP-712 domain helper used by native-order factory/clone code. Unlike OpenZeppelin's normal implementation, constructor accepts an `alien` verifying-contract address, so execution context and signed-domain address can differ.

**Functions/state:** constructor caches name/version/type hash, chain ID, and domain separator (`52-62`); `_domainSeparatorV4` returns cache on original chain or rebuilds on a chain-ID change (`67-73`); `_hashTypedDataV4` applies the EIP-712 envelope (`102-104`).

**Security:** this is safe only when the chosen `alien` address is intentional. Native clones rely on it to validate an LOP-domain order, so a constructor/configuration error changes signature scope. Chain-ID recomputation protects fork replay; immutables prevent post-deployment retargeting.
