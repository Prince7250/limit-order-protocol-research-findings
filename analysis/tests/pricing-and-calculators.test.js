const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('@1inch/solidity-utils');
const { ethers } = require('hardhat');
const { ether } = require('../../test/helpers/utils');
const { deploySwap } = require('../../test/helpers/fixtures');
const { buildMakerTraits } = require('../../test/helpers/orderUtils');
const solc = require('solc');

describe('H-03 Pricing and Amount Calculation Security Review', function () {
    let addr, taker;
    let chainlinkCalc, dutchAuctionCalc, rangeAmountCalc, amountGetterWithFee, amountCalcWrapper;
    let ChainlinkCalcArtifact, RangeCalcArtifact, DutchCalcArtifact, FeeGetterArtifact;
    let MockConfigurableOracleFactory;

    before(async function () {
        [addr, taker] = await ethers.getSigners();

        // 1. Compile a configurable Chainlink oracle mock
        const oracleSource = `
        // SPDX-License-Identifier: MIT
        pragma solidity 0.8.30;

        contract ConfigurableOracleMock {
            uint8 public decimals;
            int256 public answer;
            uint256 public updatedAt;

            constructor(uint8 _decimals, int256 _answer, uint256 _updatedAt) {
                decimals = _decimals;
                answer = _answer;
                updatedAt = _updatedAt;
            }

            function setPrice(int256 _answer) external {
                answer = _answer;
                updatedAt = block.timestamp;
            }

            function setUpdatedAt(uint256 _updatedAt) external {
                updatedAt = _updatedAt;
            }

            function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
                return (1, answer, updatedAt, updatedAt, 1);
            }
        }
        `;

        const solcInput = {
            language: 'Solidity',
            sources: { 'Oracle.sol': { content: oracleSource } },
            settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } } },
        };
        const output = JSON.parse(solc.compile(JSON.stringify(solcInput)));
        const compiled = output.contracts['Oracle.sol'].ConfigurableOracleMock;
        MockConfigurableOracleFactory = new ethers.ContractFactory(compiled.abi, compiled.evm.bytecode.object, addr);

        // 2. Compile AmountCalculatorLib test wrapper
        const libWrapperSource = `
        // SPDX-License-Identifier: MIT
        pragma solidity 0.8.30;

        library AmountCalculatorLib {
            function getMakingAmount(uint256 orderMakerAmount, uint256 orderTakerAmount, uint256 swapTakerAmount) internal pure returns(uint256) {
                if ((swapTakerAmount | orderMakerAmount) >> 128 == 0) {
                    unchecked {
                        return (swapTakerAmount * orderMakerAmount) / orderTakerAmount;
                    }
                }
                return swapTakerAmount * orderMakerAmount / orderTakerAmount;
            }

            function getTakingAmount(uint256 orderMakerAmount, uint256 orderTakerAmount, uint256 swapMakerAmount) internal pure returns(uint256) {
                if ((swapMakerAmount | orderTakerAmount) >> 128 == 0) {
                    unchecked {
                        return (swapMakerAmount * orderTakerAmount + orderMakerAmount - 1) / orderMakerAmount;
                    }
                }
                return (swapMakerAmount * orderTakerAmount + orderMakerAmount - 1) / orderMakerAmount;
            }
        }

        contract AmountCalculatorLibWrapper {
            function getMakingAmount(uint256 orderMakerAmount, uint256 orderTakerAmount, uint256 swapTakerAmount) external pure returns(uint256) {
                return AmountCalculatorLib.getMakingAmount(orderMakerAmount, orderTakerAmount, swapTakerAmount);
            }
            function getTakingAmount(uint256 orderMakerAmount, uint256 orderTakerAmount, uint256 swapMakerAmount) external pure returns(uint256) {
                return AmountCalculatorLib.getTakingAmount(orderMakerAmount, orderTakerAmount, swapMakerAmount);
            }
        }
        `;

        const solcInputLib = {
            language: 'Solidity',
            sources: { 'LibWrapper.sol': { content: libWrapperSource } },
            settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } } },
        };
        const outputLib = JSON.parse(solc.compile(JSON.stringify(solcInputLib)));
        const compiledLib = outputLib.contracts['LibWrapper.sol'].AmountCalculatorLibWrapper;
        const LibWrapperFactory = new ethers.ContractFactory(compiledLib.abi, compiledLib.evm.bytecode.object, addr);
        amountCalcWrapper = await LibWrapperFactory.deploy();
        await amountCalcWrapper.waitForDeployment();

        // 3. Deploy in-scope calculators
        ChainlinkCalcArtifact = await ethers.getContractFactory('ChainlinkCalculator');
        chainlinkCalc = await ChainlinkCalcArtifact.deploy();
        await chainlinkCalc.waitForDeployment();

        DutchCalcArtifact = await ethers.getContractFactory('DutchAuctionCalculator');
        dutchAuctionCalc = await DutchCalcArtifact.deploy();
        await dutchAuctionCalc.waitForDeployment();

        RangeCalcArtifact = await ethers.getContractFactory('RangeAmountCalculator');
        rangeAmountCalc = await RangeCalcArtifact.deploy();
        await rangeAmountCalc.waitForDeployment();

        FeeGetterArtifact = await ethers.getContractFactory('AmountGetterWithFee');
        amountGetterWithFee = await FeeGetterArtifact.deploy();
        await amountGetterWithFee.waitForDeployment();
    });

    describe('1. ChainlinkCalculator Oracle & Precision Boundaries', function () {
        const dummyOrder = {
            salt: 0,
            maker: ethers.ZeroAddress,
            receiver: ethers.ZeroAddress,
            makerAsset: ethers.ZeroAddress,
            takerAsset: ethers.ZeroAddress,
            makingAmount: ether('10'),
            takingAmount: ether('20000'),
            makerTraits: 0,
        };

        it('reverts when oracle price is negative (SafeCast check)', async function () {
            const now = await time.latest();
            const oracle = await MockConfigurableOracleFactory.deploy(8, -1000n, now);
            await oracle.waitForDeployment();

            // Single price blob: [flags (1 byte)][oracle (20 bytes)][spread (32 bytes)]
            const blob = ethers.solidityPacked(
                ['bytes1', 'address', 'uint256'],
                ['0x00', await oracle.getAddress(), 1000000000n] // spread 1.0 (1e9)
            );

            // SafeCast in ChainlinkCalculator reverts when latestAnswer < 0
            const SafeCast = await ethers.getContractFactory('@openzeppelin/contracts/utils/math/SafeCast.sol:SafeCast');
            await expect(
                chainlinkCalc.getMakingAmount(dummyOrder, '0x', ethers.ZeroHash, taker.address, ether('100'), ether('100'), blob)
            ).to.be.revertedWithCustomError(
                SafeCast,
                'SafeCastOverflowedIntToUint'
            );
        });

        it('reverts when oracle price is zero (division by zero or zero swap amount)', async function () {
            const now = await time.latest();
            const oracle = await MockConfigurableOracleFactory.deploy(8, 0n, now);
            await oracle.waitForDeployment();

            // Inverted single price blob divides by latestAnswer
            const blobInverted = ethers.solidityPacked(
                ['bytes1', 'address', 'uint256'],
                ['0x80', await oracle.getAddress(), 1000000000n] // inverse: true
            );

            await expect(
                chainlinkCalc.getMakingAmount(dummyOrder, '0x', ethers.ZeroHash, taker.address, ether('100'), ether('100'), blobInverted)
            ).to.be.revertedWithPanic(0x12); // Division by zero
        });

        it('reverts when oracle price is stale (> 4 hours old)', async function () {
            const now = await time.latest();
            const fourHoursAndOneSecondAgo = now - (4 * 3600 + 1);
            const oracle = await MockConfigurableOracleFactory.deploy(8, 2000e8, fourHoursAndOneSecondAgo);
            await oracle.waitForDeployment();

            const blob = ethers.solidityPacked(
                ['bytes1', 'address', 'uint256'],
                ['0x00', await oracle.getAddress(), 1000000000n]
            );

            const tx = await chainlinkCalc.getMakingAmount.populateTransaction(dummyOrder, '0x', ethers.ZeroHash, taker.address, ether('100'), ether('100'), blob);
            await expect(
                addr.sendTransaction(tx)
            ).to.be.revertedWithCustomError(chainlinkCalc, 'StaleOraclePrice');
        });

        it('reverts doublePrice when oracles have different decimals', async function () {
            const now = await time.latest();
            const oracle1 = await MockConfigurableOracleFactory.deploy(8, 2000e8, now); // 8 decimals (e.g. ETH/USD)
            const oracle2 = await MockConfigurableOracleFactory.deploy(18, ether('1'), now); // 18 decimals (e.g. DAI/USD)
            await oracle1.waitForDeployment();
            await oracle2.waitForDeployment();

            const blob = ethers.solidityPacked(
                ['bytes1', 'address', 'address', 'int256', 'uint256'],
                ['0x40', await oracle1.getAddress(), await oracle2.getAddress(), 0n, 1000000000n] // double price flag
            );

            const tx = await chainlinkCalc.getMakingAmount.populateTransaction(dummyOrder, '0x', ethers.ZeroHash, taker.address, ether('100'), ether('100'), blob);
            await expect(
                addr.sendTransaction(tx)
            ).to.be.revertedWithCustomError(chainlinkCalc, 'DifferentOracleDecimals');
        });

        it('correctly calculates doublePrice when oracles have matching decimals', async function () {
            const now = await time.latest();
            // Oracle1: TokenA = $2000 (8 dec)
            const oracle1 = await MockConfigurableOracleFactory.deploy(8, 2000e8, now);
            // Oracle2: TokenB = $100 (8 dec)
            const oracle2 = await MockConfigurableOracleFactory.deploy(8, 100e8, now);
            await oracle1.waitForDeployment();
            await oracle2.waitForDeployment();

            // TokenA / TokenB = 2000 / 100 = 20 TokenB per TokenA
            // Amount = 2 TokenA -> Expected = 40 TokenB
            const blob = ethers.solidityPacked(
                ['bytes1', 'address', 'address', 'int256', 'uint256'],
                ['0x40', await oracle1.getAddress(), await oracle2.getAddress(), 0n, 1000000000n]
            );

            const result = await chainlinkCalc.getMakingAmount(dummyOrder, '0x', ethers.ZeroHash, taker.address, 2n, 2n, blob);
            expect(result).to.equal(40n);
        });
    });

    describe('2. DutchAuctionCalculator Arithmetic & Time Bounds', function () {
        it('decays price linearly from start to end over duration', async function () {
            const now = await time.latest();
            const startTime = now + 100;
            const endTime = now + 1100;
            const startTimeEndTime = (BigInt(startTime) << 128n) | BigInt(endTime);
            const startTaking = ether('100'); // Start price: 100
            const endTaking = ether('50');    // End price: 50

            const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
                ['uint256', 'uint256', 'uint256'],
                [startTimeEndTime, startTaking, endTaking]
            );

            const order = {
                salt: 0,
                maker: ethers.ZeroAddress,
                receiver: ethers.ZeroAddress,
                makerAsset: ethers.ZeroAddress,
                takerAsset: ethers.ZeroAddress,
                makingAmount: ether('10'), // 10 tokens
                takingAmount: ether('100'),
                makerTraits: 0,
            };

            // At start time: taking amount should be exactly startTaking (100)
            await time.increaseTo(startTime);
            const takingAtStart = await dutchAuctionCalc.getTakingAmount(order, '0x', ethers.ZeroHash, taker.address, ether('10'), ether('10'), extraData);
            expect(takingAtStart).to.equal(ether('100'));

            // At midpoint (now + 600): taking amount should be exactly 75
            await time.increaseTo(startTime + 500);
            const takingAtMid = await dutchAuctionCalc.getTakingAmount(order, '0x', ethers.ZeroHash, taker.address, ether('10'), ether('10'), extraData);
            expect(takingAtMid).to.equal(ether('75'));

            // At end time (endTime): taking amount should be exactly 50
            await time.increaseTo(endTime);
            const takingAtEnd = await dutchAuctionCalc.getTakingAmount(order, '0x', ethers.ZeroHash, taker.address, ether('10'), ether('10'), extraData);
            expect(takingAtEnd).to.equal(ether('50'));

            // Past end time (endTime + 1000): clamps to end price (50)
            await time.increaseTo(endTime + 1000);
            const takingPastEnd = await dutchAuctionCalc.getTakingAmount(order, '0x', ethers.ZeroHash, taker.address, ether('10'), ether('10'), extraData);
            expect(takingPastEnd).to.equal(ether('50'));
        });

        it('reverts if startTime >= endTime', async function () {
            const now = await time.latest();
            const startTime = now + 100;
            const endTime = startTime; // invalid range: startTime == endTime
            const startTimeEndTime = (BigInt(startTime) << 128n) | BigInt(endTime);

            const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
                ['uint256', 'uint256', 'uint256'],
                [startTimeEndTime, ether('100'), ether('50')]
            );

            const order = {
                salt: 0,
                maker: ethers.ZeroAddress,
                receiver: ethers.ZeroAddress,
                makerAsset: ethers.ZeroAddress,
                takerAsset: ethers.ZeroAddress,
                makingAmount: ether('10'),
                takingAmount: ether('100'),
                makerTraits: 0,
            };

            await time.increaseTo(startTime);
            await expect(
                dutchAuctionCalc.getTakingAmount(order, '0x', ethers.ZeroHash, taker.address, ether('10'), ether('10'), extraData)
            ).to.be.revertedWithPanic(0x12); // Division by zero (endTime - startTime == 0)
        });

        it('ceilDiv in getTakingAmount strictly favors the maker', async function () {
            const now = await time.latest();
            const startTime = now + 100;
            const endTime = now + 1100;
            const startTimeEndTime = (BigInt(startTime) << 128n) | BigInt(endTime);

            const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
                ['uint256', 'uint256', 'uint256'],
                [startTimeEndTime, 1000n, 1000n]
            );

            const order = {
                salt: 0,
                maker: ethers.ZeroAddress,
                receiver: ethers.ZeroAddress,
                makerAsset: ethers.ZeroAddress,
                takerAsset: ethers.ZeroAddress,
                makingAmount: 3n, // odd maker amount
                takingAmount: 1000n,
                makerTraits: 0,
            };

            await time.increaseTo(startTime + 500);
            // 1000 * 1 / 3 = 333.333... ceilDiv yields 334
            const taking = await dutchAuctionCalc.getTakingAmount(order, '0x', ethers.ZeroHash, taker.address, 1n, 3n, extraData);
            expect(taking).to.equal(334n);
        });

        it('reverts on checked multiplication overflow when makingAmount * takingAmount > type(uint256).max', async function () {
            const now = await time.latest();
            const startTime = now + 100;
            const endTime = now + 1100;
            const startTimeEndTime = (BigInt(startTime) << 128n) | BigInt(endTime);

            const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
                ['uint256', 'uint256', 'uint256'],
                [startTimeEndTime, ether('100'), ether('50')]
            );

            const hugeAmount = (1n << 130n);
            const order = {
                salt: 0,
                maker: ethers.ZeroAddress,
                receiver: ethers.ZeroAddress,
                makerAsset: ethers.ZeroAddress,
                takerAsset: ethers.ZeroAddress,
                makingAmount: hugeAmount,
                takingAmount: hugeAmount,
                makerTraits: 0,
            };

            await time.increaseTo(startTime);
            // hugeAmount * hugeAmount = 2^260 > type(uint256).max => Panic(0x11)
            await expect(
                dutchAuctionCalc.getMakingAmount(order, '0x', ethers.ZeroHash, taker.address, hugeAmount, hugeAmount, extraData)
            ).to.be.revertedWithPanic(0x11);
        });
    });

    describe('3. RangeAmountCalculator Curve & Invariant Tests', function () {
        it('reverts when priceEnd <= priceStart with IncorrectRange', async function () {
            await expect(
                rangeAmountCalc.getRangeTakerAmount(ether('4000'), ether('3000'), ether('10'), ether('1'), ether('10'))
            ).to.be.revertedWithCustomError(rangeAmountCalc, 'IncorrectRange');

            await expect(
                rangeAmountCalc.getRangeTakerAmount(ether('4000'), ether('4000'), ether('10'), ether('1'), ether('10'))
            ).to.be.revertedWithCustomError(rangeAmountCalc, 'IncorrectRange');
        });

        it('multiple partial fills sum up to the full fill taking amount within 1-2 wei tolerance', async function () {
            const priceStart = ether('3000');
            const priceEnd = ether('4000');
            const totalMakerAmount = ether('10'); // 10 ETH

            // Full single fill of 10 ETH: average price = 3500 DAI/ETH -> 35,000 DAI
            const singleFullTaking = await rangeAmountCalc.getRangeTakerAmount(
                priceStart, priceEnd, totalMakerAmount, totalMakerAmount, totalMakerAmount
            );
            expect(singleFullTaking).to.equal(ether('35000'));

            // 5 partial fills of 2 ETH each
            let cumulativeTaking = 0n;
            let remaining = totalMakerAmount;
            const slice = ether('2');

            for (let i = 0; i < 5; i++) {
                const takingPart = await rangeAmountCalc.getRangeTakerAmount(
                    priceStart, priceEnd, totalMakerAmount, slice, remaining
                );
                cumulativeTaking += takingPart;
                remaining -= slice;
            }

            // Sum of 5 partial fills exactly equals the single full fill
            expect(cumulativeTaking).to.equal(singleFullTaking);
        });

        it('each subsequent slice costs more as price increases along the range', async function () {
            const priceStart = ether('3000');
            const priceEnd = ether('4000');
            const totalMakerAmount = ether('10');

            const part1 = await rangeAmountCalc.getRangeTakerAmount(priceStart, priceEnd, totalMakerAmount, ether('2'), ether('10'));
            const part2 = await rangeAmountCalc.getRangeTakerAmount(priceStart, priceEnd, totalMakerAmount, ether('2'), ether('8'));
            const part3 = await rangeAmountCalc.getRangeTakerAmount(priceStart, priceEnd, totalMakerAmount, ether('2'), ether('6'));

            // As order is filled, price increases monotonically
            expect(part2).to.be.gt(part1);
            expect(part3).to.be.gt(part2);
        });

        it('reverts with Panic 0x11 when integer truncation causes sqrt to underflow bDivK + alreadyFilled (dust taking amounts)', async function () {
            // Precise fuzzed boundary where Math.sqrt(...) evaluates to 1 unit less than bDivK + alreadyFilledMakingAmount
            const pStart = 82989000000000000n;
            const pEnd = 172986000000000000n;
            const oMA = 100000000000000n;
            const rem = 71800000000000n;
            const taking = 173n; // Below threshold; causes sqrt underflow

            await expect(
                rangeAmountCalc.getRangeMakerAmount(pStart, pEnd, oMA, taking, rem)
            ).to.be.revertedWithPanic(0x11); // Arithmetic underflow panic

            // But taking above threshold succeeds cleanly
            const validRes = await rangeAmountCalc.getRangeMakerAmount(pStart, pEnd, oMA, 213n, rem);
            expect(validRes).to.equal(1956n);
        });

        it('reverts with Panic 0x12 when (priceEnd - priceStart) * 1e18 < orderMakingAmount (k == 0)', async function () {
            const pStart = 1000n;
            const pEnd = 1001n; // diff = 1
            const oMA = 10n * 10n**18n; // diff * 1e18 = 1e18 < 10e18 => k = 0

            await expect(
                rangeAmountCalc.getRangeMakerAmount(pStart, pEnd, oMA, 1000n, oMA)
            ).to.be.revertedWithPanic(0x12); // Division by zero
        });
    });

    describe('4. AmountGetterWithFee & Whitelist Validation', function () {
        it('reverts when integratorShare > 100 with InvalidIntegratorShare', async function () {
            const extraData = ethers.solidityPacked(
                ['uint16', 'uint8', 'uint16', 'uint8', 'uint8'],
                [1000, 101, 1000, 0, 0] // integratorShare = 101%
            );

            const dummyOrder = {
                salt: 0,
                maker: ethers.ZeroAddress,
                receiver: ethers.ZeroAddress,
                makerAsset: ethers.ZeroAddress,
                takerAsset: ethers.ZeroAddress,
                makingAmount: ether('100'),
                takingAmount: ether('100'),
                makerTraits: 0,
            };

            await expect(
                amountGetterWithFee.getTakingAmount(dummyOrder, '0x', ethers.ZeroHash, taker.address, ether('10'), ether('100'), extraData)
            ).to.be.revertedWithCustomError(amountGetterWithFee, 'InvalidIntegratorShare');
        });

        it('reverts when whitelistDiscountNumerator > 100 with InvalidWhitelistDiscountNumerator', async function () {
            const extraData = ethers.solidityPacked(
                ['uint16', 'uint8', 'uint16', 'uint8', 'uint8'],
                [1000, 50, 1000, 105, 0] // whitelistDiscountNumerator = 105%
            );

            const dummyOrder = {
                salt: 0,
                maker: ethers.ZeroAddress,
                receiver: ethers.ZeroAddress,
                makerAsset: ethers.ZeroAddress,
                takerAsset: ethers.ZeroAddress,
                makingAmount: ether('100'),
                takingAmount: ether('100'),
                makerTraits: 0,
            };

            await expect(
                amountGetterWithFee.getTakingAmount(dummyOrder, '0x', ethers.ZeroHash, taker.address, ether('10'), ether('100'), extraData)
            ).to.be.revertedWithCustomError(amountGetterWithFee, 'InvalidWhitelistDiscountNumerator');
        });

        it('correctly applies fee: non-whitelisted pays full fee, whitelisted receives discount', async function () {
            // integratorFee = 1000 (1%), resolverFee = 2000 (2%), whitelist discount = 50%
            const feeBase = ethers.solidityPacked(
                ['uint16', 'uint8', 'uint16', 'uint8'],
                [1000, 50, 2000, 50] // 50% discount on resolver fee
            );

            // Whitelist containing only `addr`
            const takerMasked = '0x' + (await addr.getAddress()).toLowerCase().slice(-20);
            const whitelistData = ethers.solidityPacked(
                ['uint8', 'bytes10'],
                [1, takerMasked]
            );

            const fullExtraData = ethers.solidityPacked(['bytes', 'bytes'], [feeBase, whitelistData]);

            const order = {
                salt: 0,
                maker: ethers.ZeroAddress,
                receiver: ethers.ZeroAddress,
                makerAsset: ethers.ZeroAddress,
                takerAsset: ethers.ZeroAddress,
                makingAmount: ether('100'),
                takingAmount: ether('100'),
                makerTraits: 0,
            };

            // 1. Non-whitelisted taker (`taker.address` is not in whitelist)
            // Total fee = 1% + 2% = 3% (3,000 / 100,000)
            // For 100 makingAmount, takingAmount = 100 * (103,000 / 100,000) = 103
            const takingNonWhitelisted = await amountGetterWithFee.getTakingAmount(
                order, '0x', ethers.ZeroHash, taker.address, ether('100'), ether('100'), fullExtraData
            );
            expect(takingNonWhitelisted).to.equal(ether('103'));

            // 2. Whitelisted taker (`addr.address` is in whitelist)
            // Resolver fee gets 50% discount: 2% * 50% = 1%
            // Total fee = 1% (integrator) + 1% (resolver) = 2% (2,000 / 100,000)
            // For 100 makingAmount, takingAmount = 100 * (102,000 / 100,000) = 102
            const takingWhitelisted = await amountGetterWithFee.getTakingAmount(
                order, '0x', ethers.ZeroHash, addr.address, ether('100'), ether('100'), fullExtraData
            );
            expect(takingWhitelisted).to.equal(ether('102'));
        });

        it('reverts on out-of-bounds calldata when whitelist data is truncated', async function () {
            // size = 5 (needs 51 bytes), but only 11 bytes provided
            const extraData = '0x0000000000000511223344';
            const dummyOrder = {
                salt: 0,
                maker: ethers.ZeroAddress,
                receiver: ethers.ZeroAddress,
                makerAsset: ethers.ZeroAddress,
                takerAsset: ethers.ZeroAddress,
                makingAmount: 100n,
                takingAmount: 100n,
                makerTraits: 0,
            };

            await expect(
                amountGetterWithFee.getTakingAmount(dummyOrder, '0x', ethers.ZeroHash, taker.address, 100n, 100n, extraData)
            ).to.be.reverted;
        });
    });

    describe('5. AmountCalculatorLib & Partial Fill Rounding Invariants', function () {
        it('reverts on division by zero when orderMakerAmount or orderTakerAmount is zero', async function () {
            await expect(
                amountCalcWrapper.getMakingAmount(100n, 0n, 50n)
            ).to.be.revertedWithPanic(0x12);

            await expect(
                amountCalcWrapper.getTakingAmount(0n, 100n, 50n)
            ).to.be.revertedWithPanic(0x12);
        });

        it('guarantees maker is never underpaid across arbitrary partial-fill splits (fuzz test)', async function () {
            const orderMakingAmount = ether('1000');
            const orderTakingAmount = ether('2500');

            // Test 20 random split configurations (2 to 8 slices)
            for (let testRun = 0; testRun < 20; testRun++) {
                const numSlices = Math.floor(Math.random() * 7) + 2; // 2 to 8 slices
                const rawWeights = Array.from({ length: numSlices }, () => Math.floor(Math.random() * 100) + 1);
                const totalWeight = rawWeights.reduce((a, b) => a + b, 0);

                let cumulativeMaking = 0n;
                let cumulativeTaking = 0n;

                for (let i = 0; i < numSlices; i++) {
                    let sliceMaking;
                    if (i === numSlices - 1) {
                        sliceMaking = orderMakingAmount - cumulativeMaking; // exact remainder
                    } else {
                        sliceMaking = (orderMakingAmount * BigInt(rawWeights[i])) / BigInt(totalWeight);
                    }
                    if (sliceMaking === 0n) continue;

                    cumulativeMaking += sliceMaking;
                    const sliceTaking = await amountCalcWrapper.getTakingAmount(orderMakingAmount, orderTakingAmount, sliceMaking);
                    cumulativeTaking += sliceTaking;
                }

                expect(cumulativeMaking).to.equal(orderMakingAmount);
                // Maker receives at least orderTakingAmount, taker pays up to numSlices wei extra due to ceilDiv
                expect(cumulativeTaking).to.be.gte(orderTakingAmount);
                expect(cumulativeTaking).to.be.lte(orderTakingAmount + BigInt(numSlices));
            }
        });
    });

    describe('6. Pausing vs Cancellation Protocol Sovereignty Invariant', function () {
        it('allows maker order cancellation while trading is paused', async function () {
            const { swap } = await deploySwap();

            // Pause the protocol
            await swap.pause();
            expect(await swap.paused()).to.be.true;

            const orderHash = ethers.keccak256('0x123456');

            // 1. Cancel remaining-invalidator order while paused
            const makerTraitsRemaining = buildMakerTraits({ useBitInvalidator: false });
            await expect(swap.cancelOrder(makerTraitsRemaining, orderHash))
                .to.emit(swap, 'OrderCancelled')
                .withArgs(orderHash);

            // Verify order is now fully cancelled (remaining is 0)
            const remaining = await swap.remainingInvalidatorForOrder(addr.address, orderHash);
            expect(remaining).to.equal(0n);

            // 2. Cancel bit-invalidator order while paused
            const makerTraitsBit = buildMakerTraits({ allowMultipleFills: false, nonce: 42 });
            await expect(swap.cancelOrder(makerTraitsBit, orderHash))
                .to.emit(swap, 'BitInvalidatorUpdated');

            // 3. Batch cancel while paused
            const hashes = [ethers.keccak256('0x01'), ethers.keccak256('0x02')];
            const traits = [makerTraitsRemaining, makerTraitsRemaining];
            await expect(swap.cancelOrders(traits, hashes))
                .to.emit(swap, 'OrderCancelled')
                .withArgs(hashes[0]);
        });
    });
});
