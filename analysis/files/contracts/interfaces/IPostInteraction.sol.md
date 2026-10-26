# `contracts/interfaces/IPostInteraction.sol`

**Role:** callback ABI invoked after both legs of payment (`7-29`).

**Security:** suitable for fee distribution/accounting but it is an external trust boundary. Any failure rolls back both token transfers and invalidator update; implementations must avoid assuming a non-reentrant environment.
