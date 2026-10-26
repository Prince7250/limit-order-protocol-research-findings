# `contracts/mocks/TakerContract.sol`

Minimal test wrapper forwarding payable `fillOrder` to configured `IOrderMixin`. It isolates `msg.sender`/value behavior and has no validation beyond LOP's own checks.
