# `contracts/extensions/ERC1155Proxy.sol`

**Role:** selector-collision adapter forwarding a standard nominal amount as ERC-1155 quantity along with token/id/data in suffix (`20-24`).

**Security:** only immutable LOP owner can call. ERC-1155 safe transfer invokes receiver code, so it is an intentional external call after LOP state commit.
