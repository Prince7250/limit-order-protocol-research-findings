'use strict';

const assert = require('node:assert/strict');

// Exact OpenZeppelin Math.mulDiv implementation in BigInt
function mulDiv(x, y, denominator) {
    x = BigInt(x);
    y = BigInt(y);
    denominator = BigInt(denominator);

    if (denominator === 0n) {
        throw new Error('Panic(0x12): Division by zero');
    }

    const prod = x * y;
    const result = prod / denominator;

    if (result >= (1n << 256n)) {
        throw new Error('Panic(0x11): mulDiv overflow');
    }

    return result;
}

// AmountCalculatorLib.getTakingAmount
function getTakingAmount(orderMakerAmount, orderTakerAmount, swapMakerAmount) {
    orderMakerAmount = BigInt(orderMakerAmount);
    orderTakerAmount = BigInt(orderTakerAmount);
    swapMakerAmount = BigInt(swapMakerAmount);

    return (swapMakerAmount * orderTakerAmount + orderMakerAmount - 1n) / orderMakerAmount;
}

// AmountCalculatorLib.getMakingAmount
function getMakingAmount(orderMakerAmount, orderTakerAmount, swapTakerAmount) {
    orderMakerAmount = BigInt(orderMakerAmount);
    orderTakerAmount = BigInt(orderTakerAmount);
    swapTakerAmount = BigInt(swapTakerAmount);

    if (orderTakerAmount === 0n) {
        throw new Error('Panic(0x12): Division by zero in getMakingAmount');
    }

    return (swapTakerAmount * orderMakerAmount) / orderTakerAmount;
}

// Protocol guard: OrderMixin.sol:335
function verifyFillInvariant(makingAmount, takingAmount) {
    makingAmount = BigInt(makingAmount);
    takingAmount = BigInt(takingAmount);

    if (makingAmount * takingAmount === 0n) {
        throw new Error('SwapWithZeroAmount()');
    }
}

// SafeOrderBuilder scaling logic
function buildOrderTakingAmount(initialTakingAmount, makerLatestAnswer, makerOriginalAnswer, takerLatestAnswer, takerOriginalAnswer) {
    let takingAmount = BigInt(initialTakingAmount);

    // 1. Account for makerAsset volatility
    // In Solidity: uint256(latestAnswer)
    // For int256 < 0: uint256(negative) = 2^256 + negative
    const makerUint = makerLatestAnswer < 0n ? (1n << 256n) + BigInt(makerLatestAnswer) : BigInt(makerLatestAnswer);
    takingAmount = mulDiv(takingAmount, makerUint, makerOriginalAnswer);

    // 2. Account for takerAsset volatility
    const takerUint = takerLatestAnswer < 0n ? (1n << 256n) + BigInt(takerLatestAnswer) : BigInt(takerLatestAnswer);
    takingAmount = mulDiv(takingAmount, takerOriginalAnswer, takerUint);

    return takingAmount;
}

console.log('Running H-10 / LOP-C01 Empirical Arithmetic & Protocol Invariant Tests...\n');

// 1. Valid-Price Control
{
    const initialTaking = 100n;
    const makerOriginal = 250000000000000n;
    const makerLatest = 300000000000000n; // 1.2x price increase
    const takerOriginal = 250000000000000n;
    const takerLatest = 250000000000000n; // 1.0x

    const finalTaking = buildOrderTakingAmount(initialTaking, makerLatest, makerOriginal, takerLatest, takerOriginal);
    assert.equal(finalTaking, 120n, 'Valid price scaling failed');

    // Fill execution: maker gives 100, taker gives 120
    const makingAmount = 100n;
    const calculatedTaking = getTakingAmount(100n, finalTaking, makingAmount);
    assert.equal(calculatedTaking, 120n);
    assert.doesNotThrow(() => verifyFillInvariant(makingAmount, calculatedTaking), 'Valid fill failed invariant');
    console.log('[PASS] Test 1: Valid Price Control correctly computes takingAmount = 120 and passes SwapWithZeroAmount check.');
}

// 2. Maker Asset Oracle returns 0
{
    const initialTaking = 100n;
    const makerOriginal = 250000000000000n;
    const makerLatest = 0n; // Zero price
    const takerOriginal = 250000000000000n;
    const takerLatest = 250000000000000n;

    const finalTaking = buildOrderTakingAmount(initialTaking, makerLatest, makerOriginal, takerLatest, takerOriginal);
    assert.equal(finalTaking, 0n, 'Maker oracle zero should result in takingAmount = 0');
    console.log('[PASS] Test 2a: SafeOrderBuilder with maker oracle = 0 creates order with takingAmount = 0.');

    // Mode A: Taker attempts fill specifying makingAmount = 100 (isMakingAmount = true)
    const makingAmount = 100n;
    const calculatedTaking = getTakingAmount(100n, finalTaking, makingAmount);
    assert.equal(calculatedTaking, 0n, 'Calculated taking amount must be 0');

    // Protocol check: OrderMixin line 335
    assert.throws(
        () => verifyFillInvariant(makingAmount, calculatedTaking),
        /SwapWithZeroAmount\(\)/,
        'Protocol must revert with SwapWithZeroAmount'
    );
    console.log('[PASS] Test 2b: OrderMixin strictly reverts with SwapWithZeroAmount() when taker fills with isMakingAmount = true.');

    // Mode B: Taker attempts fill specifying takingAmount = 1 (isMakingAmount = false)
    assert.throws(
        () => getMakingAmount(100n, finalTaking, 1n),
        /Panic\(0x12\): Division by zero in getMakingAmount/,
        'Linear calculation must revert on division by zero when orderTakerAmount == 0'
    );
    console.log('[PASS] Test 2c: OrderMixin reverts with division-by-zero Panic(0x12) when taker fills with isMakingAmount = false.');
}

// 3. Taker Asset Oracle returns 0
{
    const initialTaking = 100n;
    const makerOriginal = 250000000000000n;
    const makerLatest = 250000000000000n;
    const takerOriginal = 250000000000000n;
    const takerLatest = 0n; // Taker oracle reports 0

    assert.throws(
        () => buildOrderTakingAmount(initialTaking, makerLatest, makerOriginal, takerLatest, takerOriginal),
        /Panic\(0x12\): Division by zero/,
        'mulDiv by 0 must revert during order construction'
    );
    console.log('[PASS] Test 3: Taker asset oracle = 0 causes immediate revert with Panic(0x12) in SafeOrderBuilder (order never signed).');
}

// 4. Maker Asset Oracle returns negative (-1)
{
    const initialTaking = 100n;
    const makerOriginal = 1000n;
    const makerLatest = -1n;
    const takerOriginal = 250000000000000n;
    const takerLatest = 250000000000000n;

    // Case 4A: initialTaking <= makerOriginal => produces astronomical taking amount
    const astronomicalTaking = buildOrderTakingAmount(initialTaking, makerLatest, makerOriginal, takerLatest, takerOriginal);
    assert.ok(astronomicalTaking > 10n ** 75n, 'Should produce astronomical taking amount');
    console.log(`[PASS] Test 4a: Maker oracle = -1 produces astronomical takingAmount = ${astronomicalTaking} (unfillable).`);

    // Case 4B: initialTaking > makerOriginal => mulDiv overflow
    assert.throws(
        () => buildOrderTakingAmount(2000n, makerLatest, 1000n, takerLatest, takerOriginal),
        /mulDiv overflow/,
        'mulDiv overflow when result exceeds 256 bits'
    );
    console.log('[PASS] Test 4b: Maker oracle = -1 with takingAmount > originalAnswer reverts with mulDiv overflow.');
}

// 5. Taker Asset Oracle returns negative (-1)
{
    const initialTaking = 100n;
    const makerOriginal = 250000000000000n;
    const makerLatest = 250000000000000n;
    const takerOriginal = 1000n;
    const takerLatest = -1n; // Denominator is 2^256 - 1

    // 100 * 1000 / (2^256 - 1) = 0
    const finalTaking = buildOrderTakingAmount(initialTaking, makerLatest, makerOriginal, takerLatest, takerOriginal);
    assert.equal(finalTaking, 0n, 'Integer division must truncate to 0');
    console.log('[PASS] Test 5a: Taker oracle = -1 truncates takingAmount to 0 in SafeOrderBuilder.');

    // Protocol check: OrderMixin line 335
    assert.throws(
        () => verifyFillInvariant(100n, getTakingAmount(100n, finalTaking, 100n)),
        /SwapWithZeroAmount\(\)/,
        'Protocol must revert with SwapWithZeroAmount'
    );
    console.log('[PASS] Test 5b: Protocol strictly rejects resulting zero-amount order with SwapWithZeroAmount().');
}

console.log('\nAll 8 empirical arithmetic and protocol invariant tests passed cleanly (Exit 0).');
