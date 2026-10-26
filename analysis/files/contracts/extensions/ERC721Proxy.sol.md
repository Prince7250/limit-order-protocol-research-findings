# `contracts/extensions/ERC721Proxy.sol`

**Role:** immutable-owner adapter whose deliberately chosen function selector equals ERC-20 `transferFrom`. Its suffix supplies token ID and ERC-721 address (`20-25`).

**Security:** ignores nominal `amount` to avoid partial sale semantics for an NFT. Only LOP may invoke it. Recipient must be capable of receiving ERC-721 only if token uses additional rules; this variant calls non-safe `transferFrom`.
