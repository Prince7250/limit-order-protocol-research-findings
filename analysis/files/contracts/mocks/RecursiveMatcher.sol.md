# `contracts/mocks/RecursiveMatcher.sol`

Test-only matcher that executes nested fills or external calls. It demonstrates that LOP permits intended recursion after invalidation state update. It is central evidence for composability but does not exhaust malicious-reentrancy cases.
