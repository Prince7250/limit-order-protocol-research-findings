# `contracts/extensions/ChainlinkCalculator.sol`

**Role:** `IAmountGetter` implementation deriving terms from one or two Chainlink feeds. Supports inverse and double-price flags in tightly packed `extraData` (`19-105`).

**Security:** checks only `updatedAt + 4 hours >= block.timestamp`; positive answer enforcement occurs through `SafeCast.toUint256`. It does not inspect `roundId`, `answeredInRound`, sequencer status, feed migration, or feed-specific decimal/economic correctness. Those are integration assumptions and should be selected by the maker with a taker threshold.
