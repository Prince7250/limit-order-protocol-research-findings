# 1inch Limit Order Protocol — architecture and audit handbook

## Executive summary

This repository implements the EVM-side, off-chain-signed 1inch Limit Order Protocol. Makers create and EIP-712-sign orders off-chain; takers/resolvers submit fills on-chain. `OrderMixin` validates the exact signed policy, records fill/cancellation state, and atomically coordinates asset transfers plus optional maker-defined callbacks.

The checked-out target is **not an audited release**: it is clean `main` commit `50bd1300315606a3d32e9021898374c9d0dc2335`, package version `4.3.5`, 56 commits after tag `4.3.4`. The repository documentation calls `main` work-in-progress and names `4.3.2` (and older `4.0.0`) as audited tags. Do not inherit audit conclusions from those tags to this target.

## Navigation

- [Progress and evidence limits](PROGRESS.md)
- [Repository inventory](01-repository-inventory.md)
- [System architecture](02-system-architecture.md)
- [Core protocol deep dive](03-core-protocol-deep-dive.md)
- [Execution traces](04-execution-traces.md)
- [Test-suite analysis](05-test-suite-analysis.md)
- [Security review](06-security-review.md)
- [Dependencies and trust boundaries](07-dependencies-and-trust-boundaries.md)
- [Solidity learning guide](08-solidity-learning-guide.md)

Individual notes for all Solidity files are available under [`analysis/files/contracts/`](files/contracts/); current JS/config per-file coverage is the table in [the inventory](01-repository-inventory.md). This handbook is deliberately a first evidence-backed checkpoint, not a certification of the unaudited branch.

## Directory map

`contracts/` is the production and mock Solidity source tree. The concrete LOP lives in `LimitOrderProtocol.sol`, but the protocol behavior is mainly in `OrderMixin.sol` and `OrderLib.sol`. `libraries/` contains packed trait, extension, accounting, offset, and math logic; `helpers/` adds predicates, epoch/nonces, Safe integration, and registration; `extensions/` adds optional pricing, token adapters, fee, native-order, and Permit2 systems. `test/` is the Hardhat suite and helper code. `deploy/`, `config/`, and `deployments/` form deployment automation/configuration/manifests. `docs/` is generated/source documentation and root markdown includes maintained guides.

## Protocol invariants

1. A first fill must validate the EIP-712 signature (EOA) or EIP-1271 signature (contract) for the order domain.
2. The extension supplied to a fill must match the maker-committed low 160-bit hash fragment, or no extension can be supplied.
3. A successful fill records a bit or reduced remaining amount before callbacks/transfers.
4. A bitmap nonce can be consumed once; a remaining-based order cannot fill after its remaining amount is zero.
5. Successful fills never use zero maker/taker nominal amounts and cannot exceed remaining maker amount.
6. Taker thresholds, if nonzero, bound the final amount relationship after clamping.
7. Any later failure rolls the entire transaction back.

## Lifecycle in one view

Maker signs order + optional extension → relayer distributes it → taker calls a fill entry point → LOP verifies signature/state/policy → computes pricing → commits invalidator → executes optional interactions and bidirectional transfer → emits remaining amount. Maker can invalidate directly by hash/bitmap or by series epoch. Native orders place ETH into a deterministic WETH-holding ERC-1271 clone before the same LOP fill path.

## Security posture

The core does several difficult things well: replay prevention is stateful and precedes external calls; standard domains bind chain and contract; extension bytes are committed; amount rounding has maker-protective direction; and the tests cover a broad set of normal/failure cases. Its flexibility also intentionally expands trust boundaries: tokens, callbacks, predicates, calculators, Permit2 targets, oracle feeds, Safe contracts, and deployment settings all matter.

Two actionable current-branch concerns are recorded in the security review: a likely zkSync incompatibility in the new Permit2 witness helper, and a confirmed ineffective deployment chain-ID guard in the non-witness Permit2 proxy script. Neither is claimed as a demonstrated deployed-funds exploit. `native-swap.md` is also stale in security-relevant operational details.

## Testing status

The documented nonparallel command `yarn test:ci` was attempted but could not start because this environment lacks Yarn and dependencies. No test outcome is inferred from source presence. See the test document for exact test inventory and recommended fuzz/invariant work.

## Glossary

| Term | Meaning here |
|---|---|
| Maker | Party offering maker asset and signing order policy. |
| Taker/resolver | Transaction sender filling an order and providing taker asset or interaction. |
| Making/taking amount | Asset amount sent by maker / paid by taker. |
| Maker/Taker traits | Packed policy words controlling fill, sender, arguments, price, permits, and ETH behavior. |
| Extension | Maker-committed packed bytes containing optional dynamic behavior. |
| Bitmap invalidator | 256-order slot used by non-multi-fill orders. |
| Remaining invalidator | Complement-encoded amount used for partial multiple fills. |
| Predicate | Static condition evaluated before a fill. |
| Pre/taker/post interaction | Ordered arbitrary-code hooks around transfers. |
| Permit2 | Uniswap signature-transfer authorization system. |
| Native order | ETH-maker order implemented via WETH-funded deterministic EIP-1271 clone. |

## Highest-priority next steps

Run the lockfile-resolved suite, add parser/math/reentrancy fuzzing, test zkSync Permit2 witness configuration, and compare any production deployment bytecode/immutables against an audited tag. Then review external dependency code and on-chain integrations in the specific deployment scope.
