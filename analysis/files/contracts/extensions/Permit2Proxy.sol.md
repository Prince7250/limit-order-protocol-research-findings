# `contracts/extensions/Permit2Proxy.sol`

**Role:** immutable-owner selector-collision proxy for Permit2 `permitTransferFrom`. Constructor accepts an explicit chain's Permit2 address and verifies the crafted function selector equals ERC-20 `transferFrom` (`16-60`).

**Security:** only LOP/router owner can forward permits. Permit nonce/deadline/token/amount verification belongs to the external Permit2. A signed order suffix must bind this data; Permit2 SignatureTransfer nonce reuse makes partial multi-fill unsuitable. Deployment script chain validation has a confirmed defect in `analysis/06-security-review.md`.
