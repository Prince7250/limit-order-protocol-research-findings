# `contracts/extensions/DutchAuctionCalculator.sol`

**Role:** time-linear Dutch auction getter. Decodes packed start/end time and start/end taking amounts, clamps block timestamp into the interval, then calculates either direction (`15-58`).

**Security:** relies on block timestamp and requires `endTime > startTime` implicitly (otherwise division reverts). `takingAmount` endpoints and order amount need nonzero sane configuration. Miners' limited timestamp control and rounding are price-policy considerations.
