# `contracts/extensions/ERC721ProxySafe.sol`

**Role:** safe-transfer ERC-721 selector-collision adapter. Same packed suffix/owner model as `ERC721Proxy`, but calls `safeTransferFrom` (`20-25`).

**Security:** receiver callback is arbitrary code, but LOP has already recorded state. The callback may cause composable reentrancy; transaction atomicity handles a revert.
