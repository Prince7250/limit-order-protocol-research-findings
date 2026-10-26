# `contracts/extensions/RangeAmountCalculator.sol`

**Role:** volume-dependent range-order getter. It integrates a linear price curve for taking amount and inverts it using square root for making amount (`25-104`).

**Security:** `correctPrices` rejects non-increasing ranges. Arithmetic is checked; extreme parameters revert rather than wrap. Inverse formula/rounding should be fuzzed against the forward formula across repeated fills so no residual amount can be overdrawn.
