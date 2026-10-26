# `contracts/extensions/NativeOrderFactory.sol`

**Role:** creates deterministic EIP-1167 clones for ETH-maker orders. Constructor deploys a shared implementation; `create` requires original maker is sender, a nonzero/nonfactory receiver, and exact ETH/making amount, then creates clone by original order hash and funds/approves it (`16-76`).

**Security:** same original order cannot create another clone because its CREATE2 address is occupied. Clone address is signature proof, so all original order fields must be committed. Owner-only `rescueFunds` applies factory balance; active escrow belongs in clones. Constructor's LOP/WETH/access-token/domain configuration is critical.
