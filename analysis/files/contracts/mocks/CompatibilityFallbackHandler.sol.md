# `contracts/mocks/CompatibilityFallbackHandler.sol`

Adapted Gnosis Safe test compatibility handler because the upstream handler does not compile under the selected compiler. It implements legacy/updated EIP-1271 forwarding, module enumeration, and revert-based Safe simulation. It is test-only; upstream Safe behavior, not this mock, is a production trust boundary.
