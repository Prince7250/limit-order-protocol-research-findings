# `contracts/libraries/Errors.sol`

**Role:** shared custom errors `InvalidMsgValue` and `ETHTransferFailed` for native-WETH branches. It carries no state or functions beyond declarations.

**Security:** callers use the errors to distinguish non-WETH ETH misuse from recipient/refund delivery failure. ETH paths must remain atomic; callers must not catch-and-ignore these reverts.
