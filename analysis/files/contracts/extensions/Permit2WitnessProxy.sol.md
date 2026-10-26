# `contracts/extensions/Permit2WitnessProxy.sol`

**Role:** selector-collision proxy for Permit2 witness transfers. It hardcodes a witness type string and non-zkSync Permit2 address, and forwards permit/witness/signature only for immutable owner (`12-50`).

**Security:** the hardcoded address conflicts with a deployment script that supports zkSync, where Permit2 uses a different address. This is finding LOP-01: do not treat this helper as chain-agnostic; make its Permit2 target constructor-configurable and test chain-specific behavior.
