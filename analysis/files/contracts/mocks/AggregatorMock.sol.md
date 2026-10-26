# `contracts/mocks/AggregatorMock.sol`

Test-only fixed-price Chainlink V2/V3 implementation. Returns 18 decimals and a timestamp 100 seconds old; nonzero round IDs revert. It validates calculator wiring/freshness paths, not real oracle behavior or stale/negative-answer edges.
