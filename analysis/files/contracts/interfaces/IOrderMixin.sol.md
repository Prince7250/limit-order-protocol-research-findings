# `contracts/interfaces/IOrderMixin.sol`

**Role:** canonical core ABI. Defines static `Order`, all fill/cancellation errors, events, EOA/contract fill entry points, invalidator reads, and `hashOrder` (`14-213`).

**Security:** ABI stability is critical: `OrderLib` assembly hashes exactly this struct layout, while off-chain signing helpers must encode the same eight fields. The interface's return values/events are the reliable integration source; comments referring to old `order.info` in invalidator getters are stale.
