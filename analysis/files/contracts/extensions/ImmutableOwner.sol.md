# `contracts/extensions/ImmutableOwner.sol`

**Role:** immutable access-control base for selector-collision proxies. Stores `IMMUTABLE_OWNER` and gates functions with `onlyImmutableOwner` (`9-18`).

**Security:** no ownership transfer or recovery exists. Constructor must receive the exact LOP/router that is intended to invoke the proxy; a wrong owner permanently disables or mis-scopes it.
