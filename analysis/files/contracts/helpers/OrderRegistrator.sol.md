# `contracts/helpers/OrderRegistrator.sol`

**Role:** public, one-time announcement service. It validates extension commitment, asks configured LOP to hash order, validates EOA/EIP-1271 signature, records first timestamp, and emits complete payload (`32-56`).

**Security:** any relayer can announce a valid order; duplicate hashes revert. It does not reserve funds, validate fillability, or make an order private. Its LOP address is immutable, so deployment configuration scopes its EIP-712 domain.
