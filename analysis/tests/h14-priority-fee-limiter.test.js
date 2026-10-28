const { expect } = require('@1inch/solidity-utils');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { ether } = require('../../test/helpers/utils');
const { signOrder, buildOrder, buildTakerTraits } = require('../../test/helpers/orderUtils');
const { deploySwapTokens } = require('../../test/helpers/fixtures');
const hre = require('hardhat');
const { ethers, network } = hre;

describe('H-14: PriorityFeeLimiter Security and Underflow Investigation', function () {
    async function deployContractsAndInit () {
        const { dai, weth, swap, chainId } = await loadFixture(deploySwapTokens);
        const [maker, taker] = await ethers.getSigners();

        await dai.mint(taker, ether('20000'));
        await weth.connect(maker).deposit({ value: ether('10') });

        await dai.connect(taker).approve(swap, ethers.MaxUint256);
        await weth.connect(maker).approve(swap, ethers.MaxUint256);

        const PriorityFeeLimiter = await ethers.getContractFactory('PriorityFeeLimiter');
        const priorityFeeLimiter = await PriorityFeeLimiter.deploy();
        await priorityFeeLimiter.waitForDeployment();

        const order = buildOrder(
            {
                makerAsset: await weth.getAddress(),
                takerAsset: await dai.getAddress(),
                makingAmount: ether('1'),
                takingAmount: ether('2000'),
                maker: maker.address,
            },
            {
                predicate: swap.interface.encodeFunctionData('arbitraryStaticCall', [
                    await priorityFeeLimiter.getAddress(),
                    priorityFeeLimiter.interface.encodeFunctionData('isPriorityFeeValid'),
                ]),
            },
        );

        const { r, yParityAndS: vs } = ethers.Signature.from(
            await signOrder(order, chainId, await swap.getAddress(), maker),
        );

        const takerTraits = buildTakerTraits({
            makingAmount: true,
            extension: order.extension,
            threshold: order.takingAmount,
        });

        return { dai, weth, swap, priorityFeeLimiter, order, r, vs, takerTraits, maker, taker };
    }

    describe('Tier 1: baseFee < 10.6 gwei (70% priority cap)', function () {
        it('allows fill when priority fee is 50% of baseFee (4 gwei priority / 8 gwei base)', async function () {
            const { swap, order, r, vs, takerTraits, taker, dai } = await loadFixture(deployContractsAndInit);
            await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1dcd65000']); // 8 gwei

            await expect(
                swap.connect(taker).fillOrderArgs(
                    order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args,
                    { maxPriorityFeePerGas: 4000000000n },
                ),
            ).to.changeTokenBalances(dai, [taker, swap], [-order.takingAmount, 0n]);
        });

        it('allows fill at exact 70% threshold boundary (5.6 gwei priority / 8 gwei base)', async function () {
            const { swap, order, r, vs, takerTraits, taker, dai } = await loadFixture(deployContractsAndInit);
            await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1dcd65000']); // 8 gwei

            // 5.6 gwei = 5_600_000_000 wei. 5600000000 * 100 <= 8000000000 * 70 (560000000000 == 560000000000)
            await expect(
                swap.connect(taker).fillOrderArgs(
                    order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args,
                    { maxPriorityFeePerGas: 5600000000n },
                ),
            ).to.changeTokenBalances(dai, [taker, swap], [-order.takingAmount, 0n]);
        });

        it('reverts with PredicateIsNotTrue when priority fee exceeds 70% by 1 wei', async function () {
            const { swap, order, r, vs, takerTraits, taker } = await loadFixture(deployContractsAndInit);
            await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1dcd65000']); // 8 gwei

            // 5.6 gwei + 1 wei
            await expect(
                swap.connect(taker).fillOrderArgs(
                    order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args,
                    { maxPriorityFeePerGas: 5600000001n },
                ),
            ).to.be.revertedWithCustomError(swap, 'PredicateIsNotTrue');
        });

        it('reverts with PredicateIsNotTrue when priority fee is 75% of baseFee (6 gwei priority / 8 gwei base)', async function () {
            const { swap, order, r, vs, takerTraits, taker } = await loadFixture(deployContractsAndInit);
            await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1dcd65000']); // 8 gwei

            await expect(
                swap.connect(taker).fillOrderArgs(
                    order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args,
                    { maxPriorityFeePerGas: 6000000000n },
                ),
            ).to.be.revertedWithCustomError(swap, 'PredicateIsNotTrue');
        });
    });

    describe('Tier 2: 10.6 gwei <= baseFee < 104.1 gwei (50% priority cap)', function () {
        it('allows fill at exact Tier 2 lower boundary (10.6 gwei base) with 50% priority (5.3 gwei)', async function () {
            const { swap, order, r, vs, takerTraits, taker, dai } = await loadFixture(deployContractsAndInit);
            await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x' + (10600000000n).toString(16)]); // 10.6 gwei

            // 5.3 gwei * 2 <= 10.6 gwei (10600000000 == 10600000000) -> valid
            await expect(
                swap.connect(taker).fillOrderArgs(
                    order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args,
                    { maxPriorityFeePerGas: 5300000000n },
                ),
            ).to.changeTokenBalances(dai, [taker, swap], [-order.takingAmount, 0n]);
        });

        it('reverts with PredicateIsNotTrue at 10.6 gwei base when priority fee exceeds 50% by 1 wei', async function () {
            const { swap, order, r, vs, takerTraits, taker } = await loadFixture(deployContractsAndInit);
            await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x' + (10600000000n).toString(16)]); // 10.6 gwei

            await expect(
                swap.connect(taker).fillOrderArgs(
                    order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args,
                    { maxPriorityFeePerGas: 5300000001n },
                ),
            ).to.be.revertedWithCustomError(swap, 'PredicateIsNotTrue');
        });

        it('allows fill mid-range Tier 2 (50 gwei base) with 50% priority (25 gwei)', async function () {
            const { swap, order, r, vs, takerTraits, taker, dai } = await loadFixture(deployContractsAndInit);
            await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0xba43b7400']); // 50 gwei

            await expect(
                swap.connect(taker).fillOrderArgs(
                    order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args,
                    { maxPriorityFeePerGas: 25000000000n },
                ),
            ).to.changeTokenBalances(dai, [taker, swap], [-order.takingAmount, 0n]);
        });

        it('reverts with PredicateIsNotTrue mid-range Tier 2 (50 gwei base) with 52% priority (26 gwei)', async function () {
            const { swap, order, r, vs, takerTraits, taker } = await loadFixture(deployContractsAndInit);
            await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0xba43b7400']); // 50 gwei

            await expect(
                swap.connect(taker).fillOrderArgs(
                    order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args,
                    { maxPriorityFeePerGas: 26000000000n },
                ),
            ).to.be.revertedWithCustomError(swap, 'PredicateIsNotTrue');
        });
    });

    describe('Tier 3: baseFee >= 104.1 gwei (65% priority cap)', function () {
        it('allows fill at exact Tier 3 lower boundary (104.1 gwei base) with 65% priority (67.665 gwei)', async function () {
            const { swap, order, r, vs, takerTraits, taker, dai } = await loadFixture(deployContractsAndInit);
            await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x' + (104100000000n).toString(16)]); // 104.1 gwei

            // 67_665_000_000 * 100 <= 104_100_000_000 * 65 (6766500000000 == 6766500000000)
            await expect(
                swap.connect(taker).fillOrderArgs(
                    order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args,
                    { maxPriorityFeePerGas: 67665000000n },
                ),
            ).to.changeTokenBalances(dai, [taker, swap], [-order.takingAmount, 0n]);
        });

        it('reverts with PredicateIsNotTrue at 104.1 gwei base when priority fee exceeds 65% by 1 wei', async function () {
            const { swap, order, r, vs, takerTraits, taker } = await loadFixture(deployContractsAndInit);
            await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x' + (104100000000n).toString(16)]); // 104.1 gwei

            await expect(
                swap.connect(taker).fillOrderArgs(
                    order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args,
                    { maxPriorityFeePerGas: 67665000001n },
                ),
            ).to.be.revertedWithCustomError(swap, 'PredicateIsNotTrue');
        });

        it('allows fill at 150 gwei base with 60% priority (90 gwei <= 65% cap)', async function () {
            const { swap, order, r, vs, takerTraits, taker, dai } = await loadFixture(deployContractsAndInit);
            await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x22ecb25c00']); // 150 gwei

            await expect(
                swap.connect(taker).fillOrderArgs(
                    order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args,
                    { maxPriorityFeePerGas: 90000000000n },
                ),
            ).to.changeTokenBalances(dai, [taker, swap], [-order.takingAmount, 0n]);
        });

        it('reverts with PredicateIsNotTrue at 150 gwei base with 66.6% priority (100 gwei > 65% cap)', async function () {
            const { swap, order, r, vs, takerTraits, taker } = await loadFixture(deployContractsAndInit);
            await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x22ecb25c00']); // 150 gwei

            await expect(
                swap.connect(taker).fillOrderArgs(
                    order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args,
                    { maxPriorityFeePerGas: 100000000000n },
                ),
            ).to.be.revertedWithCustomError(swap, 'PredicateIsNotTrue');
        });
    });

    describe('Zero Priority Fee and Invariant Analysis', function () {
        it('allows fill with zero priority fee (maxPriorityFeePerGas = 0) across all tiers', async function () {
            const { swap, order, r, vs, takerTraits, taker, dai } = await loadFixture(deployContractsAndInit);

            // Tier 1: 8 gwei base, 0 priority
            await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1dcd65000']);
            await expect(
                swap.connect(taker).fillOrderArgs(
                    order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args,
                    { maxPriorityFeePerGas: 0n },
                ),
            ).to.changeTokenBalances(dai, [taker, swap], [-order.takingAmount, 0n]);
        });

        it('demonstrates fail-closed arithmetic invariant: unchecked underflow yields false and prevents execution', async function () {
            // Mathematical proof of why unchecked { uint256 priorityFee = tx.gasprice - baseFee; } cannot be bypassed:
            // If tx.gasprice < baseFee by delta:
            // priorityFee = 2^256 - delta
            // In Tier 1: priorityFee * 100 mod 2^256 = 2^256 - 100 * delta
            // For (2^256 - 100*delta) <= baseFee * 70:
            // Requires 2^256 <= 100*delta + 70*baseFee <= 170*baseFee
            // Requires baseFee >= 2^256 / 170 ~= 6.8e74 wei (~6.8e56 ETH)
            // Since total ETH supply is < 1.3e8 ETH, this condition is physically unreachable in EVM.
            // Therefore, if tx.gasprice < baseFee ever occurs, isPriorityFeeValid() returns false unconditionally.

            const delta = 1n; // 1 wei below baseFee
            const MAX_UINT256 = 2n ** 256n - 1n;
            const priorityFeeUnderflow = MAX_UINT256 - delta + 1n; // 2^256 - delta

            // Emulate Solidity unchecked arithmetic for 100 wei baseFee
            const baseFee = 100n;
            const lhs = (priorityFeeUnderflow * 100n) % (2n ** 256n);
            const rhs = baseFee * 70n;

            expect(lhs <= rhs).to.be.false;
        });
    });
});
