# `contracts/mocks/WrappedTokenMock.sol`

Test WETH-like ERC-20 permit token. `deposit` mints to sender, `withdraw` burns and uses Solidity `transfer`, and receive calls deposit. It supports happy-path WETH/permit tests but its 2300-gas ETH transfer semantics differ from production WETH implementations that use `call`.
