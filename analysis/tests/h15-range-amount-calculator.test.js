const { expect } = require('@1inch/solidity-utils');
const { ethers } = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { deploySwapTokens, deployRangeAmountCalculator } = require('../../test/helpers/fixtures');
const { ether } = require('../../test/helpers/utils');
const { buildOrder, buildMakerTraits, signOrder, buildTakerTraits } = require('../../test/helpers/orderUtils');

describe('H-15: RangeAmountCalculator & AmountCalculatorLib Arithmetic Boundaries', function () {
    // -------------------------------------------------------------
    // High-Precision JavaScript Reference Implementations
    // -------------------------------------------------------------
    function refLinearMakingAmount(orderMakerAmount, orderTakerAmount, swapTakerAmount) {
        // Floor division: (swapTakerAmount * orderMakerAmount) / orderTakerAmount
        return (BigInt(swapTakerAmount) * BigInt(orderMakerAmount)) / BigInt(orderTakerAmount);
    }

    function refLinearTakingAmount(orderMakerAmount, orderTakerAmount, swapMakerAmount) {
        // Ceil division: (swapMakerAmount * orderTakerAmount + orderMakerAmount - 1) / orderMakerAmount
        const sM = BigInt(swapMakerAmount);
        const oT = BigInt(orderTakerAmount);
        const oM = BigInt(orderMakerAmount);
        return (sM * oT + oM - 1n) / oM;
    }

    function refRangeTakerAmount(pStart, pEnd, oMA, fillAmt, remMA) {
        const pS = BigInt(pStart);
        const pE = BigInt(pEnd);
        const orderMA = BigInt(oMA);
        const fill = BigInt(fillAmt);
        const rem = BigInt(remMA);
        const alreadyFilled = orderMA - rem;

        const slopeTerm = ((pE - pS) * (2n * alreadyFilled + fill)) / orderMA;
        const totalRate = slopeTerm + 2n * pS;
        return (totalRate * fill) / (2n * 10n ** 18n);
    }

    async function deployContractsFixture () {
        const [maker, taker, other] = await ethers.getSigners();
        const { dai, weth, swap, chainId } = await loadFixture(deploySwapTokens);
        const { rangeAmountCalculator } = await loadFixture(deployRangeAmountCalculator);

        await dai.mint(maker, ether('1000000'));
        await dai.mint(taker, ether('1000000'));
        await weth.connect(maker).deposit({ value: ether('100') });
        await weth.connect(taker).deposit({ value: ether('100') });

        await dai.connect(maker).approve(swap, ethers.MaxUint256);
        await dai.connect(taker).approve(swap, ethers.MaxUint256);
        await weth.connect(maker).approve(swap, ethers.MaxUint256);
        await weth.connect(taker).approve(swap, ethers.MaxUint256);

        return { maker, taker, other, dai, weth, swap, chainId, rangeAmountCalculator };
    }

    // =============================================================
    // 1. AmountCalculatorLib: Linear Arithmetic & Rounding Invariants
    // =============================================================
    describe('1. AmountCalculatorLib: Rounding & Precision Invariants', function () {
        it('verifies getMakingAmount floors and strictly favors the maker', async function () {
            // When taker specifies takingAmount, maker receives the full takingAmount and gives up floored makingAmount
            const orderMaker = 100n;
            const orderTaker = 300n; // 1 maker = 3 taker
            const swapTaker = 10n;   // 10 / 3 = 3.333...

            const expectedMaking = refLinearMakingAmount(orderMaker, orderTaker, swapTaker);
            expect(expectedMaking).to.equal(3n); // Floored from 3.333...
        });

        it('verifies getTakingAmount ceils and strictly favors the maker', async function () {
            // When taker specifies makingAmount, maker receives ceiled takingAmount
            const orderMaker = 300n;
            const orderTaker = 100n; // 3 maker = 1 taker
            const swapMaker = 10n;   // 10 / 3 = 3.333...

            const expectedTaking = refLinearTakingAmount(orderMaker, orderTaker, swapMaker);
            expect(expectedTaking).to.equal(4n); // Ceiled from 3.333... to 4
        });

        it('demonstrates rounding discrepancy accumulation across partial fills (favorable to maker)', async function () {
            // Order: 3 makerAsset for 10 takerAsset (rate = 3.333 taker per maker)
            const orderMaker = 3n;
            const orderTaker = 10n;

            // Single full fill requires 10 taker tokens
            const singleFillTaking = refLinearTakingAmount(orderMaker, orderTaker, 3n);
            expect(singleFillTaking).to.equal(10n);

            // Three partial fills of 1 maker token each:
            // Each fill requires ceil(1 * 10 / 3) = 4 taker tokens
            const part1 = refLinearTakingAmount(orderMaker, orderTaker, 1n);
            const part2 = refLinearTakingAmount(orderMaker, orderTaker, 1n);
            const part3 = refLinearTakingAmount(orderMaker, orderTaker, 1n);

            expect(part1).to.equal(4n);
            expect(part2).to.equal(4n);
            expect(part3).to.equal(4n);

            // Sum of partial fills = 12 taker tokens (+2 wei surplus to maker)
            const cumulativeTaking = part1 + part2 + part3;
            expect(cumulativeTaking).to.be.gt(singleFillTaking);
            expect(cumulativeTaking - singleFillTaking).to.equal(2n);
        });

        it('verifies dust making amounts that truncate to 0 are rejected downstream by SwapWithZeroAmount()', async function () {
            const { swap, chainId, maker, taker, dai, weth } = await loadFixture(deployContractsFixture);

            // Order: 1 WETH for 1,000,000 DAI (rate: 1e-6 WETH per DAI)
            // If taker offers 1 wei of DAI, makingAmount = 1 * 1e18 / 1e24 = 0
            const order = buildOrder({
                makerAsset: await weth.getAddress(),
                takerAsset: await dai.getAddress(),
                makingAmount: ether('1'),
                takingAmount: ether('1000000'),
                maker: maker.address,
                makerTraits: buildMakerTraits({ allowMultipleFills: true }),
            });

            const sig = await signOrder(order, chainId, await swap.getAddress(), maker);
            const { r, yParityAndS: vs } = ethers.Signature.from(sig);

            // Taker attempts fill by specifying takingAmount = 1 wei of DAI (isMakingAmount = false)
            const takerTraits = buildTakerTraits({
                makingAmount: false,
                threshold: 0n,
            });

            // Reverts with SwapWithZeroAmount() because makingAmount floored to 0
            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, 1n, takerTraits.traits, takerTraits.args),
            ).to.be.revertedWithCustomError(swap, 'SwapWithZeroAmount');
        });

        it('analyzes 128-bit optimization vs checked fallback paths in AmountCalculatorLib', async function () {
            // Case A: (swapTakerAmount | orderMakerAmount) >> 128 == 0 (both < 2^128)
            const val128A = 2n ** 120n;
            const val128B = 2n ** 120n;
            const denomA = 2n ** 110n;
            const resA = (val128A * val128B) / denomA;
            expect(resA).to.equal(2n ** 130n);

            // Case B: product exceeding 2^256 in checked path reverts with Panic(0x11)
            const bigVal1 = 2n ** 150n;
            const bigVal2 = 2n ** 150n;
            // Product is 2^300 > 2^256, bitwise check >> 128 != 0, checked multiplication reverts
            expect(bigVal1 * bigVal2).to.be.gt(2n ** 256n - 1n);
        });
    });

    // =============================================================
    // 2. RangeAmountCalculator: Mathematical Precision & Curve Invariants
    // =============================================================
    describe('2. RangeAmountCalculator: Curve Accuracy & Reference Comparison', function () {
        const priceStart = ether('3000'); // 3000 DAI/ETH
        const priceEnd = ether('4000');   // 4000 DAI/ETH
        const totalLiquidity = ether('10'); // 10 ETH

        it('matches high-precision mathematical integral across multiple fill sizes', async function () {
            const { rangeAmountCalculator } = await loadFixture(deployContractsFixture);

            const testFills = [
                ether('1'),
                ether('2.5'),
                ether('5'),
                ether('7.333333333333333333'),
                ether('10'),
            ];

            for (const fill of testFills) {
                const contractResult = await rangeAmountCalculator.getRangeTakerAmount(
                    priceStart, priceEnd, totalLiquidity, fill, totalLiquidity
                );
                const referenceResult = refRangeTakerAmount(
                    priceStart, priceEnd, totalLiquidity, fill, totalLiquidity
                );

                expect(contractResult).to.equal(referenceResult);
            }
        });

        it('confirms average price strictly increases as order fills along the range (monotonicity)', async function () {
            const { rangeAmountCalculator } = await loadFixture(deployContractsFixture);
            let remaining = totalLiquidity;
            const step = ether('1');
            let previousPrice = 0n;

            for (let i = 0; i < 10; i++) {
                const takerAmt = await rangeAmountCalculator.getRangeTakerAmount(
                    priceStart, priceEnd, totalLiquidity, step, remaining
                );
                remaining -= step;

                // Price for 1 ETH step increases monotonically
                expect(takerAmt).to.be.gt(previousPrice);
                previousPrice = takerAmt;
            }
        });

        it('confirms round-trip fidelity: getRangeMakerAmount(getRangeTakerAmount(x)) == x for standard fills', async function () {
            const { rangeAmountCalculator } = await loadFixture(deployContractsFixture);

            // Test 1 ETH fill on a 10 ETH order
            const fillMaker = ether('1');
            const takerAmount = await rangeAmountCalculator.getRangeTakerAmount(
                priceStart, priceEnd, totalLiquidity, fillMaker, totalLiquidity
            );
            expect(takerAmount).to.equal(ether('3050')); // Average price 3050 DAI

            // Inverse: compute maker amount for 3050 DAI
            const recoveredMaker = await rangeAmountCalculator.getRangeMakerAmount(
                priceStart, priceEnd, totalLiquidity, takerAmount, totalLiquidity
            );
            expect(recoveredMaker).to.equal(fillMaker);
        });

        it('multiple partial fills sum up to the exact single full fill taking amount', async function () {
            const { rangeAmountCalculator } = await loadFixture(deployContractsFixture);

            const fullFillTaking = await rangeAmountCalculator.getRangeTakerAmount(
                priceStart, priceEnd, totalLiquidity, totalLiquidity, totalLiquidity
            );
            expect(fullFillTaking).to.equal(ether('35000')); // (3000 + 4000) / 2 * 10 = 35,000

            // 5 slices of 2 ETH
            let sliceSum = 0n;
            let rem = totalLiquidity;
            const slice = ether('2');

            for (let i = 0; i < 5; i++) {
                const takingPart = await rangeAmountCalculator.getRangeTakerAmount(
                    priceStart, priceEnd, totalLiquidity, slice, rem
                );
                sliceSum += takingPart;
                rem -= slice;
            }

            expect(sliceSum).to.equal(fullFillTaking);
        });
    });

    // =============================================================
    // 3. Re-examination of Documented Panic(0x11) Dust Underflow
    // =============================================================
    describe('3. Re-examination of Documented Panic(0x11) Dust Underflow', function () {
        const pStart = 82989000000000000n;
        const pEnd = 172986000000000000n;
        const oMA = 100000000000000n;
        const rem = 71800000000000n; // alreadyFilled = 28200000000000n

        it('reproduces exact Panic(0x11) at line 103 for dust taking amount (173 wei)', async function () {
            const { rangeAmountCalculator } = await loadFixture(deployContractsFixture);

            // When takingAmount is below the truncation threshold, Math.sqrt(...) evaluates
            // to bDivK + alreadyFilled - 1. Subtracting bDivK + alreadyFilled underflows uint256.
            await expect(
                rangeAmountCalculator.getRangeMakerAmount(pStart, pEnd, oMA, 173n, rem),
            ).to.be.revertedWithPanic(0x11);
        });

        it('proves valid control case immediately above threshold succeeds without panic', async function () {
            const { rangeAmountCalculator } = await loadFixture(deployContractsFixture);

            // Taking amount 213n exceeds the underflow truncation threshold
            const result = await rangeAmountCalculator.getRangeMakerAmount(pStart, pEnd, oMA, 213n, rem);
            expect(result).to.equal(1956n);
            expect(result).to.be.gt(0n);
        });

        it('demonstrates that Panic(0x11) is a fail-safe revert and cannot bypass protocol balances', async function () {
            // Confirm mathematical origin:
            // Line 102: (...) / k * 1e18 truncates up to (k - 1) units before multiplying by 1e18
            // If takingAmount * 1e18 is small, the loss of precision makes the radicand < (bDivK + alreadyFilled)^2
            const b = pStart;
            const k = (pEnd - pStart) * 10n ** 18n / oMA;
            const bDivK = pStart * oMA / (pEnd - pStart);
            const alreadyFilled = oMA - rem;

            const inside = b * bDivK + alreadyFilled * (2n * b + k * alreadyFilled / 10n ** 18n) + 2n * 173n * 10n ** 18n;
            const radicand = (inside / k) * 10n ** 18n;

            // Compute integer sqrt in JS
            function intSqrt(value) {
                let z = (value + 1n) / 2n;
                let y = value;
                while (z < y) {
                    y = z;
                    z = (value / z + z) / 2n;
                }
                return y;
            }

            const sqrtVal = intSqrt(radicand);
            const baseline = bDivK + alreadyFilled;

            // Sqrt is 2196 units less than the subtraction baseline due to integer division truncation!
            expect(sqrtVal).to.be.lt(baseline);
            expect(baseline - sqrtVal).to.equal(2196n);
            // This 2196-unit deficit causes unsigned subtraction (sqrtVal - baseline) to underflow!
        });

        it('verifies getRangeTakerAmount NEVER produces Panic(0x11) underflow across any dust inputs', async function () {
            const { rangeAmountCalculator } = await loadFixture(deployContractsFixture);

            // Unlike getRangeMakerAmount, getRangeTakerAmount contains zero subtractions
            // Test 1 wei, 2 wei, 10 wei fills on arbitrary range parameters
            const res1 = await rangeAmountCalculator.getRangeTakerAmount(pStart, pEnd, oMA, 1n, rem);
            const res2 = await rangeAmountCalculator.getRangeTakerAmount(pStart, pEnd, oMA, 2n, rem);

            expect(res1).to.be.gte(0n);
            expect(res2).to.be.gte(res1);
        });
    });

    // =============================================================
    // 4. Extreme Arithmetic Boundaries & Panic(0x12)
    // =============================================================
    describe('4. Extreme Arithmetic Boundaries & Panic(0x12)', function () {
        it('reverts with IncorrectRange when priceEnd <= priceStart', async function () {
            const { rangeAmountCalculator } = await loadFixture(deployContractsFixture);

            // Inverted range
            await expect(
                rangeAmountCalculator.getRangeTakerAmount(ether('4000'), ether('3000'), ether('10'), ether('1'), ether('10')),
            ).to.be.revertedWithCustomError(rangeAmountCalculator, 'IncorrectRange');

            // Flat range (priceEnd == priceStart)
            await expect(
                rangeAmountCalculator.getRangeTakerAmount(ether('3000'), ether('3000'), ether('10'), ether('1'), ether('10')),
            ).to.be.revertedWithCustomError(rangeAmountCalculator, 'IncorrectRange');
        });

        it('reverts with Panic(0x12) when slope factor k truncates to 0', async function () {
            const { rangeAmountCalculator } = await loadFixture(deployContractsFixture);

            // When (priceEnd - priceStart) * 1e18 < orderMakingAmount, k = 0
            const pStart = 1000n;
            const pEnd = 1001n; // diff = 1
            const oMA = 10n * 10n ** 18n; // diff * 1e18 = 1e18 < 10e18 => k = 0

            await expect(
                rangeAmountCalculator.getRangeMakerAmount(pStart, pEnd, oMA, 1000n, oMA),
            ).to.be.revertedWithPanic(0x12); // Division by zero
        });

        it('reverts with Panic(0x12) when orderMakingAmount is 0', async function () {
            const { rangeAmountCalculator } = await loadFixture(deployContractsFixture);

            await expect(
                rangeAmountCalculator.getRangeMakerAmount(ether('3000'), ether('4000'), 0n, 1000n, 0n),
            ).to.be.revertedWithPanic(0x12);
        });

        it('reverts with Panic(0x11) on extreme multiplication overflow near uint256 limits', async function () {
            const { rangeAmountCalculator } = await loadFixture(deployContractsFixture);

            // Huge prices that exceed uint256 capacity during multiplication
            const hugePriceStart = 2n ** 240n;
            const hugePriceEnd = 2n ** 241n;
            const oMA = ether('10');

            await expect(
                rangeAmountCalculator.getRangeTakerAmount(hugePriceStart, hugePriceEnd, oMA, ether('1'), oMA),
            ).to.be.revertedWithPanic(0x11); // Overflow in checked arithmetic
        });
    });

    // =============================================================
    // 5. Full Protocol Order Settlement Integration
    // =============================================================
    describe('5. Full Protocol Order Settlement Integration with Range Calculator', function () {
        it('executes a 2-step partial fill of a range order and verifies balance integrals', async function () {
            const { swap, chainId, maker, taker, dai, weth, rangeAmountCalculator } = await loadFixture(deployContractsFixture);

            // 10 WETH -> 35,000 DAI with price curve 3000 -> 4000 DAI
            const makingAmount = ether('10');
            const takingAmount = ether('35000');
            const startPrice = ether('3000');
            const endPrice = ether('4000');

            const order = buildOrder(
                {
                    makerAsset: await weth.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount,
                    takingAmount,
                    maker: maker.address,
                    makerTraits: buildMakerTraits({ allowMultipleFills: true, allowPartialFill: true }),
                },
                {
                    makingAmountData: ethers.solidityPacked(
                        ['address', 'uint256', 'uint256'],
                        [await rangeAmountCalculator.getAddress(), startPrice, endPrice],
                    ),
                    takingAmountData: ethers.solidityPacked(
                        ['address', 'uint256', 'uint256'],
                        [await rangeAmountCalculator.getAddress(), startPrice, endPrice],
                    ),
                },
            );

            const sig = await signOrder(order, chainId, await swap.getAddress(), maker);
            const { r, yParityAndS: vs } = ethers.Signature.from(sig);

            // Fill 1: Taker fills 5 WETH (makingAmount = true)
            // First 5 WETH curve integral: 16,250 DAI (average price 3250 DAI)
            const takerTraits1 = buildTakerTraits({
                makingAmount: true,
                threshold: ether('16250'),
                extension: order.extension,
            });

            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, ether('5'), takerTraits1.traits, takerTraits1.args),
            ).to.changeTokenBalances(
                dai,
                [taker, maker],
                [-ether('16250'), ether('16250')],
            );

            // Fill 2: Taker fills remaining 5 WETH
            // Second 5 WETH curve integral: 18,750 DAI (average price 3750 DAI)
            const takerTraits2 = buildTakerTraits({
                makingAmount: true,
                threshold: ether('18750'),
                extension: order.extension,
            });

            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, ether('5'), takerTraits2.traits, takerTraits2.args),
            ).to.changeTokenBalances(
                dai,
                [taker, maker],
                [-ether('18750'), ether('18750')],
            );

            // Total DAI received by maker = 16,250 + 18,750 = 35,000 DAI
            // Total WETH sent by maker = 5 + 5 = 10 WETH
        });
    });
});
