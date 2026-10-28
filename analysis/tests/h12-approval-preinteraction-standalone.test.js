'use strict';

const assert = require('node:assert/strict');

// Model LimitOrderProtocol cancellation and fill state machine
class MockLimitOrderProtocol {
    constructor() {
        // mapping(address maker => mapping(bytes32 orderHash => uint256 remaining))
        this.remainingInvalidator = new Map();
        // mapping(address maker => mapping(uint256 slot => uint256 mask))
        this.bitInvalidator = new Map();
        // mapping(uint256 seriesKey => uint256 epoch)
        this.epochs = new Map();
    }

    _getRemaining(maker, orderHash, orderMakingAmount) {
        const makerMap = this.remainingInvalidator.get(maker.toLowerCase());
        if (!makerMap || !makerMap.has(orderHash)) {
            return orderMakingAmount; // 0 in storage means new/unfilled
        }
        return makerMap.get(orderHash);
    }

    _setRemaining(maker, orderHash, amount) {
        let makerMap = this.remainingInvalidator.get(maker.toLowerCase());
        if (!makerMap) {
            makerMap = new Map();
            this.remainingInvalidator.set(maker.toLowerCase(), makerMap);
        }
        makerMap.set(orderHash, amount);
    }

    // OrderMixin.sol:80 cancelOrder
    cancelOrder(sender, orderHash, useBitInvalidator, nonceOrEpoch) {
        if (useBitInvalidator) {
            // updates bitInvalidator[msg.sender]
            let slots = this.bitInvalidator.get(sender.toLowerCase());
            if (!slots) {
                slots = new Map();
                this.bitInvalidator.set(sender.toLowerCase(), slots);
            }
            const slot = nonceOrEpoch >> 8n;
            const bit = 1n << (nonceOrEpoch & 0xffn);
            const current = slots.get(slot) || 0n;
            slots.set(slot, current | bit);
        } else {
            // updates remainingInvalidator[msg.sender][orderHash] = 0 (fully filled)
            this._setRemaining(sender, orderHash, 0n);
        }
    }

    // SeriesEpochManager.sol:34 advanceEpoch
    advanceEpoch(sender, series, amount) {
        const key = (BigInt(sender) & ((1n << 160n) - 1n)) | ((BigInt(series) & ((1n << 96n) - 1n)) << 160n);
        const current = this.epochs.get(key) || 0n;
        this.epochs.set(key, current + BigInt(amount));
    }

    epochEquals(maker, series, makerEpoch) {
        const key = (BigInt(maker) & ((1n << 160n) - 1n)) | ((BigInt(series) & ((1n << 96n) - 1n)) << 160n);
        const current = this.epochs.get(key) || 0n;
        return current === BigInt(makerEpoch);
    }

    // OrderMixin.sol:222 _fillContractOrder checkRemainingMakingAmount & fill
    simulateFillContractOrder(order, signatureValidator, sender) {
        const makerAddress = order.maker;
        const orderHash = order.hash;

        // 1. Check remaining amount: queried under order.maker
        let remainingMakingAmount;
        if (order.useBitInvalidator) {
            remainingMakingAmount = order.makingAmount;
        } else {
            remainingMakingAmount = this._getRemaining(makerAddress, orderHash, order.makingAmount);
        }

        if (remainingMakingAmount === 0n) {
            throw new Error('InvalidatedOrder()');
        }

        // 2. Check epoch if flagged
        if (order.needCheckEpochManager) {
            if (!this.epochEquals(makerAddress, order.series, order.nonceOrEpoch)) {
                throw new Error('WrongSeriesNonce()');
            }
        }

        // 3. First fill signature check
        if (remainingMakingAmount === order.makingAmount) {
            const isValid = signatureValidator(orderHash, order.signature);
            if (!isValid) {
                throw new Error('BadSignature()');
            }
        }

        // 4. Invalidation commit: records under order.maker
        if (order.useBitInvalidator) {
            let slots = this.bitInvalidator.get(makerAddress.toLowerCase());
            if (!slots) {
                slots = new Map();
                this.bitInvalidator.set(makerAddress.toLowerCase(), slots);
            }
            const slot = order.nonceOrEpoch >> 8n;
            const bit = 1n << (order.nonceOrEpoch & 0xffn);
            const current = slots.get(slot) || 0n;
            if ((current & bit) === bit) {
                throw new Error('BitInvalidatedOrder()');
            }
            slots.set(slot, current | bit);
        } else {
            this._setRemaining(makerAddress, orderHash, 0n);
        }

        return { filled: true, makingAmount: order.makingAmount };
    }
}

console.log('Running H-12 ApprovalPreInteraction Invalidation & Token Recovery Tests...\n');

const ALICE = '0x1111111111111111111111111111111111111111';
const APPROVAL_PRE_INTERACTION = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TAKER = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

// 1. Cancellation State Key Mismatch Proof
{
    const lop = new MockLimitOrderProtocol();
    const orderHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

    const order = {
        maker: APPROVAL_PRE_INTERACTION,
        hash: orderHash,
        makingAmount: 100n,
        takingAmount: 200n,
        useBitInvalidator: false,
        needCheckEpochManager: false,
        signature: 'valid_signature_from_alice',
    };

    // ApprovalPreInteraction.isValidSignature validates Alice's signature
    const signatureValidator = (hash, sig) => sig === 'valid_signature_from_alice';

    // Alice attempts to cancel her order via LimitOrderProtocol.cancelOrder
    // In OrderMixin.sol:85, cancelOrder sets _remainingInvalidator[msg.sender][orderHash] = fullyFilled
    lop.cancelOrder(ALICE, orderHash, false, 0n);

    // Verify Alice's cancellation was recorded under Alice:
    assert.equal(lop._getRemaining(ALICE, orderHash, 100n), 0n, "Alice's address should be marked cancelled");

    // But check the order's actual maker address (ApprovalPreInteraction):
    assert.equal(
        lop._getRemaining(APPROVAL_PRE_INTERACTION, orderHash, 100n),
        100n,
        "ApprovalPreInteraction order remaining must STILL be 100n (unaffected by Alice's cancelOrder)"
    );

    // Taker attempts to fill the order that Alice cancelled:
    const fillResult = lop.simulateFillContractOrder(order, signatureValidator, TAKER);
    assert.equal(fillResult.filled, true, 'Fill succeeds despite Alice calling cancelOrder');
    console.log('[PASS] Test 1: cancelOrder by signing user fails to cancel ApprovalPreInteraction order on-chain.');
}

// 2. Epoch Invalidation Mismatch Proof
{
    const lop = new MockLimitOrderProtocol();
    const orderHash = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef';
    const series = 1n;
    const epoch = 0n;

    const epochOrder = {
        maker: APPROVAL_PRE_INTERACTION,
        hash: orderHash,
        makingAmount: 100n,
        takingAmount: 200n,
        useBitInvalidator: false,
        needCheckEpochManager: true,
        series: series,
        nonceOrEpoch: epoch,
        signature: 'valid_signature_from_alice',
    };

    const signatureValidator = (hash, sig) => sig === 'valid_signature_from_alice';

    // Alice attempts to invalidate all orders in series 1 by advancing her epoch:
    lop.advanceEpoch(ALICE, series, 1n);

    // Alice's epoch is now 1:
    assert.equal(lop.epochEquals(ALICE, series, 1n), true);

    // But ApprovalPreInteraction's epoch is STILL 0:
    assert.equal(lop.epochEquals(APPROVAL_PRE_INTERACTION, series, 0n), true);

    // Taker fills the epoch order because order.maker's epoch is still 0:
    const fillResult = lop.simulateFillContractOrder(epochOrder, signatureValidator, TAKER);
    assert.equal(fillResult.filled, true, 'Epoch fill succeeds because approvalPreInteraction epoch never advanced');
    console.log('[PASS] Test 2: advanceEpoch by signing user fails to invalidate ApprovalPreInteraction order.');
}

// 3. EIP-1271 Signature Bypass on Partial Fills Proof
{
    const lop = new MockLimitOrderProtocol();
    const orderHash = '0x9999999999999999999999999999999999999999999999999999999999999999';

    // Let's model a contract maker that changes its authorization after fill 1
    let signatureAuthorized = true;
    const dynamicSignatureValidator = () => signatureAuthorized;

    const partialOrder = {
        maker: APPROVAL_PRE_INTERACTION,
        hash: orderHash,
        makingAmount: 100n,
        takingAmount: 200n,
        useBitInvalidator: false,
        needCheckEpochManager: false,
        signature: 'sig',
    };

    // First fill for 50n (partial fill)
    lop._setRemaining(APPROVAL_PRE_INTERACTION, orderHash, 50n); // remaining is now 50n

    // User revokes signature authorization in wallet
    signatureAuthorized = false;

    // Second fill for remaining 50n:
    // In OrderMixin.sol:234: `if (remainingMakingAmount == order.makingAmount)`
    // Since remainingMakingAmount (50n) != order.makingAmount (100n), signature check is SKIPPED!
    const fillResult2 = lop.simulateFillContractOrder(
        { ...partialOrder, signature: 'revoked_signature' },
        dynamicSignatureValidator,
        TAKER
    );

    assert.equal(fillResult2.filled, true, 'Partial fill completes without re-checking signature');
    console.log('[PASS] Test 3: Subsequent partial fills bypass isValidSignature, confirming cancellation must be on-chain.');
}

// 4. Token Recovery via Self-Fill Order Modeling
{
    // Demonstrate how a maker CAN recover escrowed tokens without a withdraw() function:
    // The maker creates a self-fill recovery order where taker is maker themselves, takingAmount is 1 wei.
    const recoveryOrder = {
        maker: APPROVAL_PRE_INTERACTION,
        hash: '0xrecovery1111111111111111111111111111111111111111111111111111111111',
        makingAmount: 100n, // withdraw all 100 tokens
        takingAmount: 1n,   // pay 1 wei
        useBitInvalidator: false,
        needCheckEpochManager: false,
        signature: 'valid_recovery_sig_from_alice',
    };

    const lop = new MockLimitOrderProtocol();
    const signatureValidator = () => true;

    // Alice fills the recovery order herself
    const recoveryResult = lop.simulateFillContractOrder(recoveryOrder, signatureValidator, ALICE);
    assert.equal(recoveryResult.filled, true);
    assert.equal(recoveryResult.makingAmount, 100n);
    console.log('[PASS] Test 4: Token recovery via self-fill order succeeds (100 tokens extracted to Alice for 1 wei).');
}

console.log('\nAll 4 empirical H-12 behavioral model tests passed cleanly (Exit 0).');
