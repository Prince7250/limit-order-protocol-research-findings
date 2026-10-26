# `contracts/extensions/NativeOrderImpl.sol`

**Role:** clone implementation/contract maker. Factory-only deposit wraps ETH and approves LOP. `isValidSignature` reads original order from signature bytes, checks predicted clone address, patches maker to clone, and compares LOP-domain hash (`85-110`). Maker can cancel/withdraw; access-token resolver can cancel expired orders for bounded reward (`112-172`).

**Security:** deterministic clone validation ties a clone to its original order. WETH is fully withdrawn before external ETH sends during cancellation, preventing reentrant repeated withdrawal. `rewardLimit` above available balance causes a checked subtraction revert (caller can retry lower). Fuzz short signature bytes and reentrant recipient paths. The 70,000 gas lower bound is source truth, not the stale native guide.
