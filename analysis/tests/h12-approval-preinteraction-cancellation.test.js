const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { expect, ether, constants } = require('@1inch/solidity-utils');
const hre = require('hardhat');
const { ethers } = hre;
const {
    signOrder,
    buildOrder,
    buildOrderData,
    buildTakerTraits,
    buildMakerTraits,
    buildMakerTraitsRFQ,
} = require('../../test/helpers/orderUtils');
const { deploySwapTokens } = require('../../test/helpers/fixtures');

describe('H-12 ApprovalPreInteraction Invalidation and Recovery Verification', function () {
    let addr, addr1;

    before(async function () {
        [addr, addr1] = await ethers.getSigners();
    });

    async function deployContracts() {
        const { dai, weth, swap, chainId } = await deploySwapTokens();

        const ApprovalPreInteraction = await ethers.getContractFactory('ApprovalPreInteraction');
        const approvalPreInteraction = await ApprovalPreInteraction.deploy(swap, addr1);
        await approvalPreInteraction.waitForDeployment();

        return { dai, weth, swap, chainId, approvalPreInteraction };
    }

    describe('Case A (Control): Standard EOA Maker Cancellation', function () {
        it('normal maker cancels order and subsequent fill is rejected with InvalidatedOrder', async function () {
            const { dai, weth, swap, chainId } = await loadFixture(deployContracts);

            await weth.connect(addr1).deposit({ value: ether('1') });
            await weth.connect(addr1).approve(swap, ether('1'));
            await dai.mint(addr, ether('2000'));
            await dai.connect(addr).approve(swap, ether('2000'));

            // Standard order with allowMultipleFills: true (remaining invalidator path)
            const order = buildOrder({
                maker: addr1.address,
                makerAsset: await weth.getAddress(),
                takerAsset: await dai.getAddress(),
                makingAmount: ether('1'),
                takingAmount: ether('2000'),
                makerTraits: buildMakerTraits({ allowMultipleFills: true }),
            });

            const data = buildOrderData(chainId, await swap.getAddress(), order);
            const orderHash = ethers.TypedDataEncoder.hash(data.domain, data.types, data.value);
            const { compactSerialized: sig } = ethers.Signature.from(
                await signOrder(order, chainId, await swap.getAddress(), addr1)
            );
            const { r, yParityAndS: vs } = ethers.Signature.from(sig);

            // Maker cancels order directly on swap
            await swap.connect(addr1).cancelOrder(order.makerTraits, orderHash);

            // Storage check: remainingInvalidator for addr1 is 0 (fully filled)
            expect(await swap.remainingInvalidatorForOrder(addr1.address, orderHash)).to.equal(0n);

            // Attempting to fill cancelled order must revert with InvalidatedOrder
            const takerTraits = buildTakerTraits({ makingAmount: true, threshold: order.takingAmount });
            await expect(
                swap.connect(addr).fillOrder(order, r, vs, order.makingAmount, takerTraits.traits)
            ).to.be.revertedWithCustomError(swap, 'InvalidatedOrder');
        });
    });

    describe('Case B (Extension-Maker Cancellation): Signer cancellation is ineffective for ApprovalPreInteraction', function () {
        it('subcase 1: remaining-amount invalidation (allowMultipleFills: true) — cancellation updates signer storage but leaves contract untouched', async function () {
            const { dai, weth, swap, chainId, approvalPreInteraction } = await loadFixture(deployContracts);
            const approvalPreInteractionAddress = await approvalPreInteraction.getAddress();

            await dai.mint(addr, ether('2000'));
            await dai.connect(addr).approve(swap, ether('2000'));
            await weth.connect(addr1).deposit({ value: ether('1') });
            await weth.connect(addr1).transfer(approvalPreInteractionAddress, ether('1'));

            // Order using remaining invalidator (allowMultipleFills: true)
            const order = buildOrder({
                maker: approvalPreInteractionAddress,
                makerAsset: await weth.getAddress(),
                takerAsset: await dai.getAddress(),
                makingAmount: ether('1'),
                takingAmount: ether('2000'),
                makerTraits: buildMakerTraits({ allowMultipleFills: true }),
            });

            // Set _NEED_PREINTERACTION_FLAG (bit 252)
            order.makerTraits = BigInt(order.makerTraits) | (1n << 252n);

            const data = buildOrderData(chainId, await swap.getAddress(), order);
            const orderHash = ethers.TypedDataEncoder.hash(data.domain, data.types, data.value);
            const { compactSerialized: sig } = ethers.Signature.from(
                await signOrder(order, chainId, await swap.getAddress(), addr1)
            );

            // Signer attempts to cancel order via public swap.cancelOrder
            await swap.connect(addr1).cancelOrder(order.makerTraits, orderHash);

            // Invalidation check on storage:
            // 1. Storage under addr1 is marked fully filled (remaining = 0)
            expect(await swap.remainingInvalidatorForOrder(addr1.address, orderHash)).to.equal(0n);
            // 2. Raw storage under approvalPreInteraction is 0 (untouched / isNewOrder == true)
            expect(await swap.rawRemainingInvalidatorForOrder(approvalPreInteractionAddress, orderHash)).to.equal(0n);
            // 3. remainingInvalidatorForOrder for untouched order reverts with RemainingInvalidatedOrder per library design
            await expect(
                swap.remainingInvalidatorForOrder(approvalPreInteractionAddress, orderHash)
            ).to.be.revertedWithCustomError(swap, 'RemainingInvalidatedOrder');

            // Taker attempts to fill the order — fill SUCCEEDS despite cancelOrder having been called!
            const takerTraits = buildTakerTraits({ makingAmount: true, threshold: order.takingAmount });
            await expect(
                swap.connect(addr).fillContractOrder(order, sig, order.makingAmount, takerTraits.traits)
            ).to.not.be.reverted;

            // Escrowed tokens were drained from approvalPreInteraction
            expect(await weth.balanceOf(approvalPreInteractionAddress)).to.equal(0n);
        });

        it('subcase 2: bit invalidation (RFQ order) — cancelOrder updates signer bit-slot but leaves contract bit-slot untouched', async function () {
            const { dai, weth, swap, chainId, approvalPreInteraction } = await loadFixture(deployContracts);
            const approvalPreInteractionAddress = await approvalPreInteraction.getAddress();

            await dai.mint(addr, ether('2000'));
            await dai.connect(addr).approve(swap, ether('2000'));
            await weth.connect(addr1).deposit({ value: ether('1') });
            await weth.connect(addr1).transfer(approvalPreInteractionAddress, ether('1'));

            const orderNonce = 0;
            const order = buildOrder({
                maker: approvalPreInteractionAddress,
                makerAsset: await weth.getAddress(),
                takerAsset: await dai.getAddress(),
                makingAmount: ether('1'),
                takingAmount: ether('2000'),
                makerTraits: buildMakerTraitsRFQ({ nonce: orderNonce }),
            });

            // Set _NEED_PREINTERACTION_FLAG (bit 252)
            order.makerTraits = BigInt(order.makerTraits) | (1n << 252n);

            const data = buildOrderData(chainId, await swap.getAddress(), order);
            const orderHash = ethers.TypedDataEncoder.hash(data.domain, data.types, data.value);
            const { compactSerialized: sig } = ethers.Signature.from(
                await signOrder(order, chainId, await swap.getAddress(), addr1)
            );

            // Signer attempts to cancel RFQ order
            await swap.connect(addr1).cancelOrder(order.makerTraits, orderHash);

            // Check bit invalidator storage:
            // addr1 bit 0 is invalidated (mask = 1)
            expect(await swap.bitInvalidatorForOrder(addr1.address, orderNonce)).to.equal(1n);
            // approvalPreInteraction bit 0 is completely UNTOUCHED (mask = 0)
            expect(await swap.bitInvalidatorForOrder(approvalPreInteractionAddress, orderNonce)).to.equal(0n);

            // Taker fills RFQ order — SUCCEEDS because order.maker's bit-slot was untouched
            const takerTraits = buildTakerTraits({ makingAmount: true, threshold: order.takingAmount });
            await expect(
                swap.connect(addr).fillContractOrder(order, sig, order.makingAmount, takerTraits.traits)
            ).to.not.be.reverted;

            expect(await weth.balanceOf(approvalPreInteractionAddress)).to.equal(0n);
        });
    });

    describe('Case C (Epoch Invalidation): Signer advanceEpoch fails to invalidate ApprovalPreInteraction order', function () {
        it('epoch check is verified active on order, but advanceEpoch by signer leaves contract epoch unchanged', async function () {
            const { dai, weth, swap, chainId, approvalPreInteraction } = await loadFixture(deployContracts);
            const approvalPreInteractionAddress = await approvalPreInteraction.getAddress();

            await dai.mint(addr, ether('2000'));
            await dai.connect(addr).approve(swap, ether('2000'));
            await weth.connect(addr1).deposit({ value: ether('1') });
            await weth.connect(addr1).transfer(approvalPreInteractionAddress, ether('1'));

            const series = 1n;
            const epoch = 0n;

            // Explicitly set shouldCheckEpoch: true (supported repository helper option)
            const order = buildOrder({
                maker: approvalPreInteractionAddress,
                makerAsset: await weth.getAddress(),
                takerAsset: await dai.getAddress(),
                makingAmount: ether('1'),
                takingAmount: ether('2000'),
                makerTraits: buildMakerTraits({
                    series: series,
                    nonce: epoch,
                    shouldCheckEpoch: true,
                }),
            });

            // Set _NEED_PREINTERACTION_FLAG (bit 252)
            order.makerTraits = BigInt(order.makerTraits) | (1n << 252n);

            // Verification that epoch-check trait is explicitly enabled (bit 250)
            const NEED_CHECK_EPOCH_MANAGER_FLAG = 1n << 250n;
            expect(BigInt(order.makerTraits) & NEED_CHECK_EPOCH_MANAGER_FLAG).to.equal(NEED_CHECK_EPOCH_MANAGER_FLAG);

            const { compactSerialized: sig } = ethers.Signature.from(
                await signOrder(order, chainId, await swap.getAddress(), addr1)
            );

            // Signer advances their epoch for this series from 0 to 1
            await swap.connect(addr1).advanceEpoch(series, 1n);

            // Storage state verification:
            // 1. addr1's epoch is now 1
            expect(await swap.epochEquals(addr1.address, series, 1n)).to.be.true;
            // 2. ApprovalPreInteraction's epoch is still 0
            expect(await swap.epochEquals(approvalPreInteractionAddress, series, 0n)).to.be.true;

            // Fill succeeds because epoch check evaluates order.maker (approvalPreInteraction), which is still epoch 0
            const takerTraits = buildTakerTraits({ makingAmount: true, threshold: order.takingAmount });
            await expect(
                swap.connect(addr).fillContractOrder(order, sig, order.makingAmount, takerTraits.traits)
            ).to.not.be.reverted;

            expect(await weth.balanceOf(approvalPreInteractionAddress)).to.equal(0n);
        });
    });

    describe('Case D (Recovery): Self-fill order enables signer to sweep escrowed tokens', function () {
        it('allows signer (addr1) to sweep/recover escrowed tokens via a 1-wei self-fill order', async function () {
            const { dai, weth, swap, chainId, approvalPreInteraction } = await loadFixture(deployContracts);
            const approvalPreInteractionAddress = await approvalPreInteraction.getAddress();

            // Escrow 5 WETH into ApprovalPreInteraction
            await weth.connect(addr1).deposit({ value: ether('5') });
            await weth.connect(addr1).transfer(approvalPreInteractionAddress, ether('5'));
            expect(await weth.balanceOf(approvalPreInteractionAddress)).to.equal(ether('5'));

            // Signer constructs recovery order:
            // - maker = approvalPreInteraction
            // - receiver = addr1
            // - makingAmount = full stuck balance (5 WETH)
            // - takerAsset = DAI (or any token)
            // - takingAmount = 1 wei
            const recoveryOrder = buildOrder({
                maker: approvalPreInteractionAddress,
                receiver: addr1.address,
                makerAsset: await weth.getAddress(),
                takerAsset: await dai.getAddress(),
                makingAmount: ether('5'),
                takingAmount: 1n,
                makerTraits: buildMakerTraitsRFQ(),
            });
            recoveryOrder.makerTraits = BigInt(recoveryOrder.makerTraits) | (1n << 252n);

            const { compactSerialized: recoverySig } = ethers.Signature.from(
                await signOrder(recoveryOrder, chainId, await swap.getAddress(), addr1)
            );

            // addr1 prepares 1 wei of DAI and approves swap
            await dai.mint(addr1, 1n);
            await dai.connect(addr1).approve(swap, 1n);

            const prevAddr1Balance = await weth.balanceOf(addr1.address);

            // addr1 executes the self-fill recovery transaction
            const takerTraits = buildTakerTraits({ makingAmount: true, threshold: 1n });
            await swap.connect(addr1).fillContractOrder(
                recoveryOrder,
                recoverySig,
                recoveryOrder.makingAmount,
                takerTraits.traits
            );

            // Verification:
            // 1. ApprovalPreInteraction balance is completely drained
            expect(await weth.balanceOf(approvalPreInteractionAddress)).to.equal(0n);
            // 2. addr1 received all 5 WETH
            expect(await weth.balanceOf(addr1.address)).to.equal(prevAddr1Balance + ether('5'));
        });
    });
});
