# `contracts/OrderMixin.sol`

**Role:** protocol state machine. It inherits the EIP-712, predicate, epoch, pause, WETH-receiver, and permit mixins (`28`). Its private storage is WETH plus maker-keyed bitmap and remaining invalidators (`39-41`).

**Public behavior:** read invalidators (`50-66`); simulate arbitrary delegatecall but always revert its result (`71-75`); cancel by hash/bit/mask (`80-109`); calculate order hash (`114-116`); predicate check (`121-124`); EOA and EIP-1271 fill entry points (`129-239`).

**Fill algorithm:** first fill validates signature and perhaps executes maker permit (`169-185`); `_fill` validates extension/sender/expiry/epoch/predicate, calculates/checks amounts, and writes state (`263-342`); it then executes signed pre-callback, maker transfer, optional taker callback, taker transfer, signed post-callback, and event (`344-440`). `_parseArgs` derives slices from taker-controlled lengths (`451-480`). `_callTransferFromWithSuffix` manually builds ERC-20 transfer calldata and accepts empty or boolean-true returndata (`509-522`).

**Security:** state-before-callbacks is the central anti-replay/reentrancy invariant. Maker permit is the exceptional pre-state external call; remaining orders detect a changed state afterward. Arbitrary tokens/callbacks are deliberately supported but are trust boundaries; no balance-delta protection exists for fee/rebasing tokens. See core deep dive and execution traces.
