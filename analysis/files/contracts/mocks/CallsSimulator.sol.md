# `contracts/mocks/CallsSimulator.sol`

Test-only delegatecall payload for LOP `simulate`. It calls paired targets/data, encodes each boolean success in a deliberately reverted `CALL_RESULTS_...` string. Inputs are length-checked; target calls are intentionally arbitrary and must never be treated as a production sandbox.
