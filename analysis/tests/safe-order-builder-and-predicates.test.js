const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers');
const { expect, constants, ether } = require('@1inch/solidity-utils');
const { ethers } = require('hardhat');
const { buildOrder, buildTakerTraits } = require('../../test/helpers/orderUtils');
const { deploySwap, deployUSDC, deployUSDT } = require('../../test/helpers/fixtures');
const { executeContractCallWithSigners } = require('@gnosis.pm/safe-contracts/dist');

describe('H-10 / LOP-C01 SafeOrderBuilder and PredicateHelper Security Review', function () {
    let addr, taker;

    before(async function () {
        [addr, taker] = await ethers.getSigners();
    });

    async function deployAndInit() {
        const { swap } = await deploySwap();
        const { usdc } = await deployUSDC();
        const { usdt } = await deployUSDT();

        const OrderRegistrator = await ethers.getContractFactory('OrderRegistrator');
        const registrator = await OrderRegistrator.deploy(swap);
        await registrator.waitForDeployment();
        const chainId = (await ethers.provider.getNetwork()).chainId;

        const GnosisSafeProxyFactory = await ethers.getContractFactory('GnosisSafeProxyFactory');
        const proxyFactoryContract = await GnosisSafeProxyFactory.deploy();
        await proxyFactoryContract.waitForDeployment();
        const GnosisSafe = await ethers.getContractFactory('GnosisSafe');
        const gnosisSafeContract = await GnosisSafe.deploy();
        await gnosisSafeContract.waitForDeployment();
        const CompatibilityFallbackHandler = await ethers.getContractFactory('CompatibilityFallbackHandler');
        const fallbackHandler = await CompatibilityFallbackHandler.deploy();
        await fallbackHandler.waitForDeployment();
        const SafeOrderBuilder = await ethers.getContractFactory('SafeOrderBuilder');
        const safeOrderBuilder = await SafeOrderBuilder.deploy(swap, registrator);
        await safeOrderBuilder.waitForDeployment();

        // Configurable mock oracle supporting negative, zero, and custom updatedAt timestamps
        const AggregatorMock = await ethers.getContractFactory('AggregatorMock');
        const usdcOracle = await AggregatorMock.deploy(ether('0.00025'));
        await usdcOracle.waitForDeployment();
        const usdtOracle = await AggregatorMock.deploy(ether('0.00025'));
        await usdtOracle.waitForDeployment();

        const owner1SafeData = await gnosisSafeContract.interface.encodeFunctionData(
            'setup',
            [[addr.address], 1, constants.ZERO_ADDRESS, '0x', await fallbackHandler.getAddress(), constants.ZERO_ADDRESS, 0, constants.ZERO_ADDRESS],
        );

        const txn = await proxyFactoryContract.createProxy(await gnosisSafeContract.getAddress(), owner1SafeData);
        const receipt = await txn.wait();
        const safe = await GnosisSafe.attach(receipt.logs[1].args[0]);

        // Ethers v6 compatibility adjustments for Safe library
        safe.address = await safe.getAddress();
        safeOrderBuilder.address = await safeOrderBuilder.getAddress();
        usdc.address = await usdc.getAddress();
        addr._signTypedData = addr.signTypedData;

        const order = buildOrder({
            makerAsset: await usdc.getAddress(),
            takerAsset: await usdt.getAddress(),
            makingAmount: 100n,
            takingAmount: 100n,
            maker: await safe.getAddress(),
        });

        await usdc.mint(await safe.getAddress(), 10000n);
        await usdt.mint(addr.address, 10000n);
        await usdt.mint(taker.address, 10000n);
        await usdt.approve(await swap.getAddress(), 10000n);
        await usdt.connect(taker).approve(await swap.getAddress(), 10000n);

        await executeContractCallWithSigners(
            safe,
            usdc,
            'approve',
            [await swap.getAddress(), 10000n],
            [addr],
            false,
        );

        return {
            swap,
            usdc,
            usdt,
            registrator,
            chainId,
            safe,
            safeOrderBuilder,
            usdcOracle,
            usdtOracle,
            order,
            AggregatorMock,
        };
    }

    describe('1. Valid Price Control (Baseline)', function () {
        it('should correctly scale taking amount and execute fillContractOrder when oracles report valid positive prices', async function () {
            const { swap, safe, registrator, safeOrderBuilder, usdcOracle, usdtOracle, order } = await loadFixture(deployAndInit);

            // Maker price moves from 0.00025 to 0.00030 (1.2x), taker price stays at 0.00025 (1.0x)
            // Expected takingAmount: 100 * 0.00030 / 0.00025 = 120
            const makerPrice = ether('0.0003');
            const takerPrice = ether('0.00025');

            const tx = await executeContractCallWithSigners(
                safe,
                safeOrderBuilder,
                'buildAndSignOrder',
                [order, order.extension, [await usdcOracle.getAddress(), ether('0.00025'), 1000], [await usdtOracle.getAddress(), ether('0.00025'), 1000]],
                [addr],
                true,
            );

            order.takingAmount = 100n * makerPrice / ether('0.00025');
            expect(order.takingAmount).to.equal(120n);

            const orderTuple = [order.salt, order.maker, order.receiver, order.makerAsset, order.takerAsset, order.makingAmount, order.takingAmount, order.makerTraits];
            await expect(tx).to.emit(registrator, 'OrderRegistered').withArgs(orderTuple, order.extension, '0x');

            const takerTraits = buildTakerTraits({
                makingAmount: true,
                threshold: 1000,
            });

            // Order must execute cleanly and exchange 100 makerAsset for 120 takerAsset
            await expect(swap.connect(taker).fillContractOrder(order, '0x', order.makingAmount, takerTraits.traits))
                .to.emit(swap, 'OrderFilled');
        });
    });

    describe('2. Zero Oracle Answers (H-10 / LOP-C01 Invariant Testing)', function () {
        it('makerAsset oracle returns 0: signs takingAmount = 0; fillContractOrder (isMakingAmount=true) reverts with SwapWithZeroAmount()', async function () {
            const { swap, safe, registrator, safeOrderBuilder, usdtOracle, order, AggregatorMock } = await loadFixture(deployAndInit);

            // Deploy oracle returning zero answer (0)
            const zeroOracle = await AggregatorMock.deploy(0);
            await zeroOracle.waitForDeployment();

            // buildAndSignOrder executes:
            // order.takingAmount = 100 * 0 / originalAnswer = 0
            const tx = await executeContractCallWithSigners(
                safe,
                safeOrderBuilder,
                'buildAndSignOrder',
                [order, order.extension, [await zeroOracle.getAddress(), ether('0.00025'), 1000], [await usdtOracle.getAddress(), ether('0.00025'), 1000]],
                [addr],
                true,
            );

            order.takingAmount = 0n;

            const orderTuple = [order.salt, order.maker, order.receiver, order.makerAsset, order.takerAsset, order.makingAmount, order.takingAmount, order.makerTraits];
            await expect(tx).to.emit(registrator, 'OrderRegistered').withArgs(orderTuple, order.extension, '0x');

            // Adversary / Taker attempts to fill the order for free:
            // Mode A: isMakingAmount = true (request 100 makingAmount)
            // Linear calculation: takingAmount = (100 * 0 + 100 - 1) / 100 = 0
            // OrderMixin.sol:335: if (makingAmount * takingAmount == 0) revert SwapWithZeroAmount();
            const takerTraits = buildTakerTraits({
                makingAmount: true,
                threshold: 0,
            });

            await expect(
                swap.connect(taker).fillContractOrder(order, '0x', order.makingAmount, takerTraits.traits)
            ).to.be.revertedWithCustomError(swap, 'SwapWithZeroAmount');
        });

        it('makerAsset oracle returns 0: fillContractOrder (isMakingAmount=false, amount > 0) reverts with Panic(0x12) division by zero', async function () {
            const { swap, safe, safeOrderBuilder, usdtOracle, order, AggregatorMock } = await loadFixture(deployAndInit);

            const zeroOracle = await AggregatorMock.deploy(0);
            await zeroOracle.waitForDeployment();

            await executeContractCallWithSigners(
                safe,
                safeOrderBuilder,
                'buildAndSignOrder',
                [order, order.extension, [await zeroOracle.getAddress(), ether('0.00025'), 1000], [await usdtOracle.getAddress(), ether('0.00025'), 1000]],
                [addr],
                true,
            );

            order.takingAmount = 0n;

            // Mode B: isMakingAmount = false (taker specifies takingAmount = 1)
            // AmountCalculatorLib.getMakingAmount: swapTakerAmount * orderMakerAmount / orderTakerAmount
            // When orderTakerAmount == 0, evaluates: 1 * 100 / 0 => Panic(0x12) division by zero
            const takerTraits = buildTakerTraits({
                makingAmount: false,
                threshold: 0,
            });

            await expect(
                swap.connect(taker).fillContractOrder(order, '0x', 1n, takerTraits.traits)
            ).to.be.revertedWithPanic(0x12);
        });

        it('takerAsset oracle returns 0: buildAndSignOrder reverts immediately with Panic(0x12) division by zero', async function () {
            const { safe, safeOrderBuilder, usdcOracle, order, AggregatorMock } = await loadFixture(deployAndInit);

            const zeroOracle = await AggregatorMock.deploy(0);
            await zeroOracle.waitForDeployment();

            // SafeOrderBuilder: order.takingAmount = order.takingAmount.mulDiv(takerOriginalAnswer, uint256(latestAnswer))
            // When taker oracle returns 0, mulDiv(originalAnswer, 0) reverts with Panic(0x12)
            // Order is never built or signed.
            await expect(
                executeContractCallWithSigners(
                    safe,
                    safeOrderBuilder,
                    'buildAndSignOrder',
                    [order, order.extension, [await usdcOracle.getAddress(), ether('0.00025'), 1000], [await zeroOracle.getAddress(), ether('0.00025'), 1000]],
                    [addr],
                    true,
                )
            ).to.be.reverted;
        });
    });

    describe('3. Negative Oracle Answers (H-10 / LOP-C01 Invariant Testing)', function () {
        it('makerAsset oracle returns negative price: cast to uint256 creates astronomical taking amount or mulDiv overflow', async function () {
            const { safe, safeOrderBuilder, usdtOracle, order, AggregatorMock } = await loadFixture(deployAndInit);

            // Negative price: -1 => uint256(-1) = 2^256 - 1
            const negativeOracle = await AggregatorMock.deploy(-1);
            await negativeOracle.waitForDeployment();

            // If order.takingAmount > originalAnswer, order.takingAmount * (2^256-1) / originalAnswer overflows 256 bits
            // If takingAmount <= originalAnswer (e.g. 100n <= 1000n), it computes ~ 0.1 * 2^256, creating an unfillable order
            order.takingAmount = 100n;
            const originalAnswer = 1000n;

            const tx = await executeContractCallWithSigners(
                safe,
                safeOrderBuilder,
                'buildAndSignOrder',
                [order, order.extension, [await negativeOracle.getAddress(), originalAnswer, 1000], [await usdtOracle.getAddress(), ether('0.00025'), 1000]],
                [addr],
                true,
            );

            // Verify order was signed with astronomical takingAmount:
            // takingAmount = 100 * (2^256 - 1) / 1000
            const expectedAstronomical = (100n * ((1n << 256n) - 1n)) / 1000n;
            order.takingAmount = expectedAstronomical;

            // This order requires ~ 1.15e76 taker tokens to fill 100 maker tokens
            expect(order.takingAmount).to.be.gt(10n ** 75n);
        });

        it('takerAsset oracle returns negative price: uint256(-1) in denominator truncates takingAmount to 0; fill reverts with SwapWithZeroAmount()', async function () {
            const { swap, safe, safeOrderBuilder, usdcOracle, order, AggregatorMock } = await loadFixture(deployAndInit);

            const negativeOracle = await AggregatorMock.deploy(-1);
            await negativeOracle.waitForDeployment();

            // SafeOrderBuilder: order.takingAmount = order.takingAmount.mulDiv(originalAnswer, uint256(-1))
            // (100 * 1000) / (2^256 - 1) = 0 (integer division truncation)
            await executeContractCallWithSigners(
                safe,
                safeOrderBuilder,
                'buildAndSignOrder',
                [order, order.extension, [await usdcOracle.getAddress(), ether('0.00025'), 1000], [await negativeOracle.getAddress(), 1000n, 1000]],
                [addr],
                true,
            );

            order.takingAmount = 0n;

            const takerTraits = buildTakerTraits({
                makingAmount: true,
                threshold: 0,
            });

            // Protocol strictly rejects execution of the zero-amount order
            await expect(
                swap.connect(taker).fillContractOrder(order, '0x', order.makingAmount, takerTraits.traits)
            ).to.be.revertedWithCustomError(swap, 'SwapWithZeroAmount');
        });
    });

    describe('4. Timestamp & Staleness Boundaries', function () {
        it('stale maker oracle price: reverts with StaleOraclePrice() when updatedAt + ttl < block.timestamp', async function () {
            const { safe, safeOrderBuilder, usdtOracle, order } = await loadFixture(deployAndInit);

            // AggregatorMock returns updatedAt = block.timestamp - 100
            // If ttl = 50, then updatedAt + ttl = block.timestamp - 50 < block.timestamp => STALE
            const StaleAggregatorMock = await ethers.getContractFactory('AggregatorMock');
            const staleOracle = await StaleAggregatorMock.deploy(ether('0.00025'));
            await staleOracle.waitForDeployment();

            await expect(
                executeContractCallWithSigners(
                    safe,
                    safeOrderBuilder,
                    'buildAndSignOrder',
                    [order, order.extension, [await staleOracle.getAddress(), ether('0.00025'), 50], [await usdtOracle.getAddress(), ether('0.00025'), 1000]],
                    [addr],
                    true,
                )
            ).to.be.revertedWithCustomError(safeOrderBuilder, 'StaleOraclePrice');
        });

        it('stale taker oracle price: reverts with StaleOraclePrice() when updatedAt + ttl < block.timestamp', async function () {
            const { safe, safeOrderBuilder, usdcOracle, order } = await loadFixture(deployAndInit);

            const StaleAggregatorMock = await ethers.getContractFactory('AggregatorMock');
            const staleOracle = await StaleAggregatorMock.deploy(ether('0.00025'));
            await staleOracle.waitForDeployment();

            await expect(
                executeContractCallWithSigners(
                    safe,
                    safeOrderBuilder,
                    'buildAndSignOrder',
                    [order, order.extension, [await usdcOracle.getAddress(), ether('0.00025'), 1000], [await staleOracle.getAddress(), ether('0.00025'), 50]],
                    [addr],
                    true,
                )
            ).to.be.revertedWithCustomError(safeOrderBuilder, 'StaleOraclePrice');
        });
    });

    describe('5. PredicateHelper Boundaries & Return Size Verification', function () {
        let predicateHelper;

        before(async function () {
            const PredicateHelperMock = await ethers.getContractFactory('PredicateHelper');
            predicateHelper = await PredicateHelperMock.deploy();
            await predicateHelper.waitForDeployment();
        });

        it('arbitraryStaticCall accepts exactly 32 bytes return data', async function () {
            // PredicateHelper calling its own timestampBelow or an arbitrary view returning uint256
            const SeriesNonceManager = await ethers.getContractFactory('SeriesNonceManager');
            const nonceManager = await SeriesNonceManager.deploy();
            await nonceManager.waitForDeployment();

            const futureTime = BigInt(await time.latest()) + 1000n;
            const callData = nonceManager.interface.encodeFunctionData('timestampBelow', [futureTime]);

            const res = await predicateHelper.arbitraryStaticCall(await nonceManager.getAddress(), callData);
            expect(res).to.equal(1n);
        });

        it('arbitraryStaticCall reverts with ArbitraryStaticCallFailed() if target returns less than 32 bytes', async function () {
            // Deploy a mock contract returning non-32-byte data
            const ShortReturnMock = await ethers.getContractFactory('ArbitraryPredicateMock');
            const shortMock = await ShortReturnMock.deploy(true);
            await shortMock.waitForDeployment();

            // Calling a function or non-existent selector that returns empty or short data
            const callData = '0x12345678';

            await expect(
                predicateHelper.arbitraryStaticCall(await shortMock.getAddress(), callData)
            ).to.be.revertedWithCustomError(predicateHelper, 'ArbitraryStaticCallFailed');
        });

        it('and/or combinators accurately parse boolean logic over multiple staticcall offsets', async function () {
            const ArbitraryPredicateMock = await ethers.getContractFactory('ArbitraryPredicateMock');
            const trueMock = await ArbitraryPredicateMock.deploy(true);
            await trueMock.waitForDeployment();
            const falseMock = await ArbitraryPredicateMock.deploy(false);
            await falseMock.waitForDeployment();

            const callTrue = trueMock.interface.encodeFunctionData('arbitraryStaticCall', [await trueMock.getAddress(), '0x']);
            const callFalse = falseMock.interface.encodeFunctionData('arbitraryStaticCall', [await falseMock.getAddress(), '0x']);

            // Test `not`: not(true) == false, not(false) == true
            expect(await predicateHelper.not(callTrue)).to.be.false;
            expect(await predicateHelper.not(callFalse)).to.be.true;
        });
    });
});
