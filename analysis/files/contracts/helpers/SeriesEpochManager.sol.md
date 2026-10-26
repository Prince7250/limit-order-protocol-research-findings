# `contracts/helpers/SeriesEpochManager.sol`

**Role:** LOP-inherited maker-series epoch cancellation. It packs a 160-bit maker and 96-bit series into one mapping key (`21-26`).

**Functions:** reads `epoch`, increments by one, advances by 1..255 with event, and checks equality (`24-47`).

**Security:** only a maker mutates its packed key through `msg.sender`. `OrderMixin` uses this only for flagged, remaining-based orders and explicitly rejects epoch+bitmap combination.
