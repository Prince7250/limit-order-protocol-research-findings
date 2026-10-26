# `contracts/LimitOrderProtocol.sol`

**Role:** concrete deployment of the core mixin. It inherits OpenZeppelin `EIP712`, `Ownable`, `Pausable`, and `OrderMixin` (`31-36`). Constructor accepts immutable WETH, starts owner as deployer, and gives `OrderMixin` its WETH receiver constraint (`38`).

**Entry points:** `DOMAIN_SEPARATOR()` exposes the current EIP-712 separator (`42-44`); `pause()` and `unpause()` are owner-only (`49-58`). All fill functions are inherited. Pausing gates only `_fill`, so reads/cancellations remain possible.

**Security:** owner key controls availability, not direct user-asset withdrawal. No proxy/upgrader exists. The comments still mention RFQ, but this source has no RFQ mixin/function; source, not this stale comment, defines the actual API.

**Callers/tests:** deployed by `test/helpers/fixtures.js`; pause behavior is covered near `test/LimitOrderProtocol.js:2266`.
