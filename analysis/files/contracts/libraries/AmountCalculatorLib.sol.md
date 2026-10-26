# `contracts/libraries/AmountCalculatorLib.sol`

**Role:** default proportional price math. `getMakingAmount` floors `swapTaker * maker / taker`; `getTakingAmount` ceils `swapMaker * taker / maker` (`9-27`). It uses unchecked multiplication only when both factors fit 128 bits.

**Security:** floor/ceil directions protect the maker from rounding leakage. Larger products are checked by Solidity and revert on overflow, favoring availability failure over an incorrect wrapped amount. Zero denominator/remainder is guarded by the calling fill path or causes a revert.
