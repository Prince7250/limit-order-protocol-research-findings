# `contracts/interfaces/IPreInteraction.sol`

**Role:** callback ABI invoked after fill state is recorded and before maker-asset transfer. It receives the order, full extension, hash, taker, actual amounts, pre-fill remaining amount, and custom data.

**Security:** an implementation is arbitrary external code selected by signed extension. It can prepare approvals/funds but a revert rolls back the fill. It must not assume that order state is still unconsumed.
