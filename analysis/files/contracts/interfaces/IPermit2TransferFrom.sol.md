# `contracts/interfaces/IPermit2TransferFrom.sol`

**Role:** minimal copy of Permit2 SignatureTransfer structures and `permitTransferFrom`. `TokenPermissions`, nonce/deadline `PermitTransferFrom`, and recipient/requested amount details are declared at `9-41`.

**Security:** this interface does not authenticate anything itself. Correctness depends on the deployed Permit2 code/address and signed nonce/deadline; `Permit2Proxy` is responsible for forwarding exactly the caller-provided details.
