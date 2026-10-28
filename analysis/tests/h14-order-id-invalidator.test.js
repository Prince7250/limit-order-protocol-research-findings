const { expect } = require('@1inch/solidity-utils');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { ether } = require('../../test/helpers/utils');
const { signOrder, buildOrder, buildMakerTraits, buildTakerTraits } = require('../../test/helpers/orderUtils');
const { deploySwapTokens } = require('../../test/helpers/fixtures');
const { ethers } = require('hardhat');

describe('H-14: OrderIdInvalidator Security Investigation', function () {
    async function deployContractsAndTokens () {
        const { dai, weth, swap, chainId } = await loadFixture(deploySwapTokens);
        const [makerA, makerB, taker, attacker] = await ethers.getSigners();

        await dai.mint(makerA, ether('1000'));
        await dai.mint(makerB, ether('1000'));
        await weth.connect(taker).deposit({ value: ether('10') });
        await weth.connect(attacker).deposit({ value: ether('10') });

        await dai.connect(makerA).approve(swap, ethers.MaxUint256);
        await dai.connect(makerB).approve(swap, ethers.MaxUint256);
        await weth.connect(taker).approve(swap, ethers.MaxUint256);
        await weth.connect(attacker).approve(swap, ethers.MaxUint256);

        const OrderIdInvalidator = await ethers.getContractFactory('OrderIdInvalidator');
        const orderIdInvalidator = await OrderIdInvalidator.deploy(await swap.getAddress());
        await orderIdInvalidator.waitForDeployment();

        return { dai, weth, swap, chainId, orderIdInvalidator, makerA, makerB, taker, attacker };
    }

    function formatPreInteraction (invalidatorAddress, orderIdHex) {
        return invalidatorAddress + orderIdHex.padStart(8, '0');
    }

    describe('Access Control', function () {
        it('should revert with AccessDenied if called directly by non-protocol address', async function () {
            const { orderIdInvalidator, attacker } = await loadFixture(deployContractsAndTokens);

            const dummyOrder = {
                salt: 0n,
                maker: attacker.address,
                receiver: ethers.ZeroAddress,
                makerAsset: ethers.ZeroAddress,
                takerAsset: ethers.ZeroAddress,
                makingAmount: 0n,
                takingAmount: 0n,
                makerTraits: 0n,
            };

            await expect(
                orderIdInvalidator.connect(attacker).preInteraction(
                    dummyOrder,
                    '0x',
                    ethers.keccak256('0x1234'),
                    attacker.address,
                    0n,
                    0n,
                    0n,
                    '0x00000001',
                ),
            ).to.be.revertedWithCustomError(orderIdInvalidator, 'AccessDenied');
        });
    });

    describe('Order Execution and Invalidation Invariants', function () {
        it('should successfully execute a single order with unused orderId', async function () {
            const { dai, weth, swap, chainId, orderIdInvalidator, makerA, taker } = await loadFixture(deployContractsAndTokens);
            const orderId = 1001n;
            const preInteraction = formatPreInteraction(await orderIdInvalidator.getAddress(), orderId.toString(16));

            const order = buildOrder(
                {
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount: ether('100'),
                    takingAmount: ether('0.1'),
                    maker: makerA.address,
                    makerTraits: buildMakerTraits({ allowMultipleFills: true }),
                },
                { preInteraction },
            );

            const signature = await signOrder(order, chainId, await swap.getAddress(), makerA);
            const { r, yParityAndS: vs } = ethers.Signature.from(signature);
            const takerTraits = buildTakerTraits({
                threshold: ether('0.1'),
                makingAmount: true,
                extension: order.extension,
            });

            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, ether('100'), takerTraits.traits, takerTraits.args),
            ).to.changeTokenBalances(dai, [makerA, taker], [-ether('100'), ether('100')]);
        });

        it('should allow multiple partial fills of the SAME order with identical orderHash', async function () {
            const { dai, weth, swap, chainId, orderIdInvalidator, makerA, taker } = await loadFixture(deployContractsAndTokens);
            const orderId = 1002n;
            const preInteraction = formatPreInteraction(await orderIdInvalidator.getAddress(), orderId.toString(16));

            const order = buildOrder(
                {
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount: ether('100'),
                    takingAmount: ether('0.1'),
                    maker: makerA.address,
                    makerTraits: buildMakerTraits({ allowMultipleFills: true, allowPartialFill: true }),
                },
                { preInteraction },
            );

            const signature = await signOrder(order, chainId, await swap.getAddress(), makerA);
            const { r, yParityAndS: vs } = ethers.Signature.from(signature);
            const takerTraits = buildTakerTraits({
                threshold: ether('0.1'),
                makingAmount: true,
                extension: order.extension,
            });

            // Fill 1: 50%
            await swap.connect(taker).fillOrderArgs(order, r, vs, ether('50'), takerTraits.traits, takerTraits.args);

            // Fill 2: remaining 50% under same orderHash
            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, ether('50'), takerTraits.traits, takerTraits.args),
            ).to.changeTokenBalances(dai, [makerA, taker], [-ether('50'), ether('50')]);
        });

        it('should permanently reject a second order with the SAME orderId but different hash', async function () {
            const { dai, weth, swap, chainId, orderIdInvalidator, makerA, taker } = await loadFixture(deployContractsAndTokens);
            const orderId = 1003n;
            const preInteraction = formatPreInteraction(await orderIdInvalidator.getAddress(), orderId.toString(16));

            const order1 = buildOrder(
                {
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount: ether('100'),
                    takingAmount: ether('0.1'),
                    maker: makerA.address,
                    makerTraits: buildMakerTraits({ allowMultipleFills: true }),
                },
                { preInteraction },
            );

            const order2 = buildOrder(
                {
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount: ether('200'), // Different amount -> different hash
                    takingAmount: ether('0.2'),
                    maker: makerA.address,
                    makerTraits: buildMakerTraits({ allowMultipleFills: true }),
                },
                { preInteraction },
            );

            const sig1 = await signOrder(order1, chainId, await swap.getAddress(), makerA);
            const sig2 = await signOrder(order2, chainId, await swap.getAddress(), makerA);

            const { r: r1, yParityAndS: vs1 } = ethers.Signature.from(sig1);
            const takerTraits1 = buildTakerTraits({
                threshold: ether('0.1'),
                makingAmount: true,
                extension: order1.extension,
            });
            await swap.connect(taker).fillOrderArgs(order1, r1, vs1, ether('100'), takerTraits1.traits, takerTraits1.args);

            // Now order2 with same orderId MUST revert with InvalidOrderHash
            const { r: r2, yParityAndS: vs2 } = ethers.Signature.from(sig2);
            const takerTraits2 = buildTakerTraits({
                threshold: ether('0.2'),
                makingAmount: true,
                extension: order2.extension,
            });

            await expect(
                swap.connect(taker).fillOrderArgs(order2, r2, vs2, ether('200'), takerTraits2.traits, takerTraits2.args),
            ).to.be.revertedWithCustomError(orderIdInvalidator, 'InvalidOrderHash');
        });

        it('demonstrates dust-fill lock: 1-wei fill permanently invalidates competing quote under same orderId', async function () {
            const { dai, weth, swap, chainId, orderIdInvalidator, makerA, attacker, taker } = await loadFixture(deployContractsAndTokens);
            const sharedOrderId = 7777n;
            const preInteraction = formatPreInteraction(await orderIdInvalidator.getAddress(), sharedOrderId.toString(16));

            // Maker signs quote A (offered to public/arbitrageur) and quote B (preferred quote) sharing orderId
            const quoteA = buildOrder(
                {
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount: ether('100'),
                    takingAmount: ether('0.1'),
                    maker: makerA.address,
                    makerTraits: buildMakerTraits({ allowMultipleFills: true, allowPartialFill: true }),
                },
                { preInteraction },
            );

            const quoteB = buildOrder(
                {
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount: ether('100'),
                    takingAmount: ether('0.09'), // Better price for maker
                    maker: makerA.address,
                    makerTraits: buildMakerTraits({ allowMultipleFills: true, allowPartialFill: true }),
                },
                { preInteraction },
            );

            const sigA = await signOrder(quoteA, chainId, await swap.getAddress(), makerA);
            const sigB = await signOrder(quoteB, chainId, await swap.getAddress(), makerA);

            // Attacker snipes 1 wei of quote A
            const { r: rA, yParityAndS: vsA } = ethers.Signature.from(sigA);
            const takerTraitsA = buildTakerTraits({
                threshold: 1n,
                makingAmount: true,
                extension: quoteA.extension,
            });

            await swap.connect(attacker).fillOrderArgs(quoteA, rA, vsA, 1000n, takerTraitsA.traits, takerTraitsA.args);

            // Now quote B is permanently bricked for that orderId
            const { r: rB, yParityAndS: vsB } = ethers.Signature.from(sigB);
            const takerTraitsB = buildTakerTraits({
                threshold: ether('0.09'),
                makingAmount: true,
                extension: quoteB.extension,
            });

            await expect(
                swap.connect(taker).fillOrderArgs(quoteB, rB, vsB, ether('100'), takerTraitsB.traits, takerTraitsB.args),
            ).to.be.revertedWithCustomError(orderIdInvalidator, 'InvalidOrderHash');
        });

        it('verifies independent orderIds operate without mutual interference', async function () {
            const { dai, weth, swap, chainId, orderIdInvalidator, makerA, taker } = await loadFixture(deployContractsAndTokens);
            const orderId1 = 8881n;
            const orderId2 = 8882n;

            const order1 = buildOrder(
                {
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount: ether('50'),
                    takingAmount: ether('0.05'),
                    maker: makerA.address,
                    makerTraits: buildMakerTraits({ allowMultipleFills: true }),
                },
                { preInteraction: formatPreInteraction(await orderIdInvalidator.getAddress(), orderId1.toString(16)) },
            );

            const order2 = buildOrder(
                {
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount: ether('50'),
                    takingAmount: ether('0.05'),
                    maker: makerA.address,
                    makerTraits: buildMakerTraits({ allowMultipleFills: true }),
                },
                { preInteraction: formatPreInteraction(await orderIdInvalidator.getAddress(), orderId2.toString(16)) },
            );

            const sig1 = await signOrder(order1, chainId, await swap.getAddress(), makerA);
            const sig2 = await signOrder(order2, chainId, await swap.getAddress(), makerA);

            const { r: r1, yParityAndS: vs1 } = ethers.Signature.from(sig1);
            const takerTraits1 = buildTakerTraits({
                threshold: ether('0.05'),
                makingAmount: true,
                extension: order1.extension,
            });
            await swap.connect(taker).fillOrderArgs(order1, r1, vs1, ether('50'), takerTraits1.traits, takerTraits1.args);

            const { r: r2, yParityAndS: vs2 } = ethers.Signature.from(sig2);
            const takerTraits2 = buildTakerTraits({
                threshold: ether('0.05'),
                makingAmount: true,
                extension: order2.extension,
            });
            // Order 2 succeeds because it uses orderId2
            await expect(
                swap.connect(taker).fillOrderArgs(order2, r2, vs2, ether('50'), takerTraits2.traits, takerTraits2.args),
            ).to.changeTokenBalances(dai, [makerA, taker], [-ether('50'), ether('50')]);
        });

        it('verifies multi-maker isolation: Maker B can use the same orderId as Maker A', async function () {
            const { dai, weth, swap, chainId, orderIdInvalidator, makerA, makerB, taker } = await loadFixture(deployContractsAndTokens);
            const sharedId = 9999n;
            const preInteraction = formatPreInteraction(await orderIdInvalidator.getAddress(), sharedId.toString(16));

            const orderA = buildOrder(
                {
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount: ether('40'),
                    takingAmount: ether('0.04'),
                    maker: makerA.address,
                    makerTraits: buildMakerTraits({ allowMultipleFills: true }),
                },
                { preInteraction },
            );

            const orderB = buildOrder(
                {
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount: ether('60'),
                    takingAmount: ether('0.06'),
                    maker: makerB.address,
                    makerTraits: buildMakerTraits({ allowMultipleFills: true }),
                },
                { preInteraction },
            );

            const sigA = await signOrder(orderA, chainId, await swap.getAddress(), makerA);
            const sigB = await signOrder(orderB, chainId, await swap.getAddress(), makerB);

            // Execute orderA
            const { r: rA, yParityAndS: vsA } = ethers.Signature.from(sigA);
            const takerTraitsA = buildTakerTraits({
                threshold: ether('0.04'),
                makingAmount: true,
                extension: orderA.extension,
            });
            await swap.connect(taker).fillOrderArgs(orderA, rA, vsA, ether('40'), takerTraitsA.traits, takerTraitsA.args);

            // Execute orderB with same orderId -> MUST SUCCEED because maker is different
            const { r: rB, yParityAndS: vsB } = ethers.Signature.from(sigB);
            const takerTraitsB = buildTakerTraits({
                threshold: ether('0.06'),
                makingAmount: true,
                extension: orderB.extension,
            });
            await expect(
                swap.connect(taker).fillOrderArgs(orderB, rB, vsB, ether('60'), takerTraitsB.traits, takerTraitsB.args),
            ).to.changeTokenBalances(dai, [makerB, taker], [-ether('60'), ether('60')]);
        });

        it('verifies no reset, cancel, or clearance mechanism exists on OrderIdInvalidator', async function () {
            const { orderIdInvalidator } = await loadFixture(deployContractsAndTokens);

            // Introspect functions on OrderIdInvalidator contract
            const functionNames = orderIdInvalidator.interface.fragments
                .filter(f => f.type === 'function')
                .map(f => f.name);
            expect(functionNames).to.deep.equal(['preInteraction']);

            // No cancelOrderId, no clear, no reset, no admin methods exist
            expect(orderIdInvalidator.cancelOrderId).to.be.undefined;
            expect(orderIdInvalidator.clearOrderId).to.be.undefined;
            expect(orderIdInvalidator.reset).to.be.undefined;
        });

        it('handles extraData with empty bytes (defaults orderId to 0)', async function () {
            const { dai, weth, swap, chainId, orderIdInvalidator, makerA, taker } = await loadFixture(deployContractsAndTokens);
            // Pre-interaction with zero extraData (only the 20-byte address)
            const preInteraction = await orderIdInvalidator.getAddress();

            const order = buildOrder(
                {
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount: ether('10'),
                    takingAmount: ether('0.01'),
                    maker: makerA.address,
                    makerTraits: buildMakerTraits({ allowMultipleFills: true }),
                },
                { preInteraction },
            );

            const sig = await signOrder(order, chainId, await swap.getAddress(), makerA);
            const { r, yParityAndS: vs } = ethers.Signature.from(sig);
            const takerTraits = buildTakerTraits({
                threshold: ether('0.01'),
                makingAmount: true,
                extension: order.extension,
            });

            // Empty extraData is cast to bytes4(""), which is 0x00000000 -> orderId = 0
            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, ether('10'), takerTraits.traits, takerTraits.args),
            ).to.changeTokenBalances(dai, [makerA, taker], [-ether('10'), ether('10')]);
        });
    });
});
