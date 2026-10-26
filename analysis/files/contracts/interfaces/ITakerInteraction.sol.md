# `contracts/interfaces/ITakerInteraction.sol`

**Role:** callback ABI between maker-to-taker and taker-to-maker transfers (`7-34`), enabling a resolver to transform maker assets into payment.

**Security:** chosen by transaction sender rather than maker, but only after maker asset has been delivered to target and state is committed. It must arrange taker funds/allowance before protocol collection and cannot rely on ETH as taker asset according to the interface note.
