'use strict';

const assert = require('node:assert/strict');

// Model PredicateHelper offset parser
function parseOffsets(offsets, dataLength) {
    offsets = BigInt(offsets);
    const slices = [];
    let previous = 0n;

    for (let current; (current = offsets & 0xffffffffn) !== 0n; offsets >>= 32n) {
        if (current < previous) {
            throw new Error('Panic(0x32): Non-monotonic calldata slice (start > end)');
        }
        if (current > BigInt(dataLength)) {
            throw new Error('Panic(0x32): Calldata slice out of bounds (end > length)');
        }
        slices.push({ start: Number(previous), end: Number(current) });
        previous = current;
    }

    return slices;
}

// Model PredicateHelper.or
function evaluateOr(offsets, dataLength, subcallEvaluator) {
    offsets = BigInt(offsets);
    let previous = 0n;

    for (let current; (current = offsets & 0xffffffffn) !== 0n; offsets >>= 32n) {
        try {
            if (current < previous || current > BigInt(dataLength)) {
                throw new Error('Panic(0x32)');
            }
            const { success, res } = subcallEvaluator(Number(previous), Number(current));
            if (success && res === 1n) {
                return true;
            }
        } catch {
            // Reverting subcall in staticcallForUint results in success = false
        }
        previous = current;
    }
    return false;
}

// Model PredicateHelper.and
function evaluateAnd(offsets, dataLength, subcallEvaluator) {
    offsets = BigInt(offsets);
    let previous = 0n;

    for (let current; (current = offsets & 0xffffffffn) !== 0n; offsets >>= 32n) {
        try {
            if (current < previous || current > BigInt(dataLength)) {
                return false;
            }
            const { success, res } = subcallEvaluator(Number(previous), Number(current));
            if (!success || res !== 1n) {
                return false;
            }
        } catch {
            return false;
        }
        previous = current;
    }
    return true; // Vacuous truth for empty conjunction
}

// Model PredicateHelper._staticcallForUint return-size check
function staticcallForUint(returnDataSize, returnWord, targetIsContract) {
    // In EVM staticcall to EOA: call success = true, returndatasize = 0
    if (!targetIsContract) {
        returnDataSize = 0;
    }

    // assembly: success := and(status, eq(returndatasize(), 32))
    const success = (returnDataSize === 32);
    const res = success ? BigInt(returnWord) : 0n;

    return { success, res };
}

// Model SeriesNonceManager.timestampBelowAndNonceEquals bit unpacking
function unpackTimestampBelowAndNonceEquals(timeNonceSeriesAccount) {
    const val = BigInt(timeNonceSeriesAccount);

    const account = val & ((1n << 160n) - 1n);
    const series = (val >> 160n) & 0xffffn; // uint16
    const nonce = (val >> 176n) & 0xffffffffffn; // uint40
    const time = (val >> 216n) & 0xffffffffffn; // uint40

    return { account, series, nonce, time };
}

// Pack helper for SeriesNonceManager
function packTimestampBelowAndNonceEquals(time, nonce, series, account) {
    let val = BigInt(account) & ((1n << 160n) - 1n);
    val |= (BigInt(series) & 0xffffn) << 160n;
    val |= (BigInt(nonce) & 0xffffffffffn) << 176n;
    val |= (BigInt(time) & 0xffffffffffn) << 216n;
    return val;
}

// Model SeriesEpochManager key packing
function packEpochKey(maker, series) {
    return (BigInt(maker) & ((1n << 160n) - 1n)) | ((BigInt(series) & ((1n << 96n) - 1n)) << 160n);
}

console.log('Running H-11 PredicateHelper, OrderRegistrator & Nonce Invalidation Tests...\n');

// 1. PredicateHelper Offset Parsing & Vacuous Truth
{
    // Normal 3 slices: [0..20], [20..40], [40..60]
    // Packed offsets: 20 | (40 << 32) | (60 << 64)
    const offsets = 20n | (40n << 32n) | (60n << 64n);
    const slices = parseOffsets(offsets, 100);
    assert.equal(slices.length, 3);
    assert.deepEqual(slices[0], { start: 0, end: 20 });
    assert.deepEqual(slices[1], { start: 20, end: 40 });
    assert.deepEqual(slices[2], { start: 40, end: 60 });
    console.log('[PASS] Test 1a: Sequential offset parsing correctly unpacks 3 calldata slices.');

    // Vacuous truth: offsets == 0
    // or(0) must return false; and(0) must return true
    assert.equal(evaluateOr(0n, 100, () => ({ success: true, res: 1n })), false);
    assert.equal(evaluateAnd(0n, 100, () => ({ success: true, res: 1n })), true);
    console.log('[PASS] Test 1b: Vacuous truth verified (or(0) = false, and(0) = true).');

    // Non-monotonic offsets [50, 20]
    const nonMonotonic = 50n | (20n << 32n);
    assert.throws(
        () => parseOffsets(nonMonotonic, 100),
        /Non-monotonic calldata slice/,
        'Non-monotonic offsets must trigger bounds check'
    );
    // In and(), a non-monotonic slice safely evaluates to false
    assert.equal(evaluateAnd(nonMonotonic, 100, () => ({ success: true, res: 1n })), false);
    console.log('[PASS] Test 1c: Non-monotonic offsets strictly evaluate to false / revert bounds.');

    // Out of bounds offsets [20, 150] with dataLength = 100
    const outOfBounds = 20n | (150n << 32n);
    assert.throws(
        () => parseOffsets(outOfBounds, 100),
        /Calldata slice out of bounds/,
        'End > length must trigger bounds check'
    );
    assert.equal(evaluateAnd(outOfBounds, 100, () => ({ success: true, res: 1n })), false);
    console.log('[PASS] Test 1d: Slices exceeding calldata length safely fail closed.');

    // Null termination: [20, 0, 50] stops at 0
    const nullTerminated = 20n | (0n << 32n) | (50n << 64n);
    const ntSlices = parseOffsets(nullTerminated, 100);
    assert.equal(ntSlices.length, 1, 'Loop should stop at first zero uint32');
    console.log('[PASS] Test 1e: Loop stops at first 0 uint32, honoring null-terminated format.');
}

// 2. PredicateHelper Return Data Size (returndatasize == 32)
{
    // Exactly 32 bytes returned
    const validCall = staticcallForUint(32, 1n, true);
    assert.equal(validCall.success, true);
    assert.equal(validCall.res, 1n);

    // Call to EOA (returndatasize == 0)
    const eoaCall = staticcallForUint(0, 0n, false);
    assert.equal(eoaCall.success, false, 'EOA call must fail returndatasize == 32 check');

    // Short return (e.g. 4 bytes revert selector or custom short data)
    const shortCall = staticcallForUint(4, 0x12345678n, true);
    assert.equal(shortCall.success, false, 'Return size < 32 must fail');

    // Long return (e.g. 64 bytes dynamic array or tuple)
    const longCall = staticcallForUint(64, 1n, true);
    assert.equal(longCall.success, false, 'Return size > 32 must fail');

    // PredicateHelper.not logic: return success && res == 0
    // If subcall failed (e.g. reverted or returned non-32 bytes), not() must return false, NOT true!
    const notOnFailure = shortCall.success && (shortCall.res === 0n);
    assert.equal(notOnFailure, false, 'not() on a failing subcall must safely evaluate to false');
    console.log('[PASS] Test 2: staticcall returndatasize == 32 strictly enforced; EOA and non-32 byte calls fail closed.');
}

// 3. OrderRegistrator Announcement & Duplicate Protection
{
    const announcedAt = new Map();

    function registerOrder(orderHash, timestamp) {
        if (announcedAt.has(orderHash) && announcedAt.get(orderHash) !== 0) {
            throw new Error(`OrderAlreadyRegistered(${orderHash})`);
        }
        announcedAt.set(orderHash, timestamp);
        return { orderHash, timestamp };
    }

    const testOrderHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    const t1 = 1700000000;

    // First registration succeeds
    registerOrder(testOrderHash, t1);
    assert.equal(announcedAt.get(testOrderHash), t1);

    // Duplicate registration strictly reverts
    assert.throws(
        () => registerOrder(testOrderHash, t1 + 10),
        /OrderAlreadyRegistered/,
        'Duplicate registration must revert'
    );

    // Front-running simulation:
    // Third-party relayer submits registration first:
    const relayerOrderHash = '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff';
    registerOrder(relayerOrderHash, 1700000050);

    // Maker subsequently tries to register:
    assert.throws(
        () => registerOrder(relayerOrderHash, 1700000055),
        /OrderAlreadyRegistered/
    );
    // Order remains registered at relayer's timestamp, order integrity intact
    assert.equal(announcedAt.get(relayerOrderHash), 1700000050);
    console.log('[PASS] Test 3: OrderRegistrator correctly enforces single announcement and rejects duplicates.');
}

// 4. SeriesNonceManager & SeriesEpochManager Bit-Packing
{
    const account = 0x71C8418037Ab880b97153024cd42b7497756295an;
    const series = 1234n;
    const nonce = 567890n;
    const time = 1750000000n;

    const packed = packTimestampBelowAndNonceEquals(time, nonce, series, account);
    const unpacked = unpackTimestampBelowAndNonceEquals(packed);

    assert.equal(unpacked.account, account);
    assert.equal(unpacked.series, series);
    assert.equal(unpacked.nonce, nonce);
    assert.equal(unpacked.time, time);
    console.log('[PASS] Test 4a: SeriesNonceManager 256-bit packing/unpacking is 100% loss-free across all 4 fields.');

    // SeriesEpochManager key packing: uint160(maker) | (series << 160)
    const epochSeries = 99999n;
    const key = packEpochKey(account, epochSeries);
    const extractedMaker = key & ((1n << 160n) - 1n);
    const extractedSeries = key >> 160n;
    assert.equal(extractedMaker, account);
    assert.equal(extractedSeries, epochSeries);
    console.log('[PASS] Test 4b: SeriesEpochManager key packing uint160(maker) | (series << 160) preserves both values.');

    // Advance bounds check: amount == 0 or amount > 255
    function checkAdvanceAmount(amount) {
        if (amount === 0 || amount > 255) {
            throw new Error('AdvanceNonceFailed()');
        }
    }
    assert.throws(() => checkAdvanceAmount(0), /AdvanceNonceFailed/);
    assert.throws(() => checkAdvanceAmount(256), /AdvanceNonceFailed/);
    assert.doesNotThrow(() => checkAdvanceAmount(1));
    assert.doesNotThrow(() => checkAdvanceAmount(255));
    console.log('[PASS] Test 4c: advanceNonce/advanceEpoch strictly bounds increment to [1..255].');
}

// 5. Invalidation Logic & Conflict Detection Invariants
{
    // MakerTraits.useBitInvalidator: !allowPartialFills || !allowMultipleFills
    function useBitInvalidator(allowPartialFills, allowMultipleFills) {
        return !allowPartialFills || !allowMultipleFills;
    }

    assert.equal(useBitInvalidator(false, false), true);  // Single fill, no partial => Bit
    assert.equal(useBitInvalidator(true, false), true);   // Single fill, partial => Bit
    assert.equal(useBitInvalidator(false, true), true);   // Multi fill, no partial => Bit
    assert.equal(useBitInvalidator(true, true), false);   // Multi fill, partial => Remaining

    // Conflict detection in OrderMixin.sol:287
    function checkEpochCompatibility(isBitInvalidator, checkEpochManager) {
        if (checkEpochManager && isBitInvalidator) {
            throw new Error('EpochManagerAndBitInvalidatorsAreIncompatible()');
        }
    }
    assert.throws(
        () => checkEpochCompatibility(true, true),
        /EpochManagerAndBitInvalidatorsAreIncompatible/
    );
    assert.doesNotThrow(() => checkEpochCompatibility(false, true));
    console.log('[PASS] Test 5: Invalidator modes and EpochManager compatibility conflicts strictly validated.');
}

console.log('\nAll 11 empirical H-11 security and boundary tests passed cleanly (Exit 0).');
