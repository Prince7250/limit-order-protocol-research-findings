# `contracts/extensions/FeeTaker.sol`

**Role:** LOP-only post-interaction and fee-aware getter. It parses recipients/flags, distributes received taker asset from itself, checks resolver whitelist/access token, and can chain a final post interaction (`79-197`). Owner may rescue funds held by this helper (`97-99`).

**Security:** fees require `order.receiver == FeeTaker` or revert `InconsistentFee`; otherwise it cannot silently take funds. Extension chooses recipients/fees but is maker-committed. ETH sends can reenter recipients after LOP state is settled; failure reverts atomically. Fee payload bounds need fuzz coverage.
