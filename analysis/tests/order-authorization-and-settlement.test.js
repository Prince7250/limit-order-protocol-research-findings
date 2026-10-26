const { expect } = require('@1inch/solidity-utils');
const { constants } = require('@1inch/solidity-utils');
const { ether } = require('../../test/helpers/utils');
const { signOrder, buildOrder, buildTakerTraits, buildMakerTraits, buildMakerTraitsRFQ } = require('../../test/helpers/orderUtils');
const { deploySwapTokens } = require('../../test/helpers/fixtures');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const hre = require('hardhat');
const { ethers } = hre;
const solc = require('solc');

describe('H-08 Order Authorization vs Actual Settlement Invariants', function () {
    let addr, taker, solver, receiver, target;
    let dai, weth, swap, chainId;
    let ReentrantTokenFactory;

    before(async function () {
        [addr, taker, solver, receiver, target] = await ethers.getSigners();
        chainId = (await ethers.provider.getNetwork()).chainId;

        // Compile ReentrantPermitToken mock
        const tokenSource = `
        // SPDX-License-Identifier: MIT
        pragma solidity 0.8.30;

        contract ReentrantPermitTokenMock {
            mapping(address => uint256) public balanceOf;
            mapping(address => mapping(address => uint256)) public allowance;
            address public swapTarget;
            bool public shouldReenter;
            bytes public reenterData;

            constructor() {
                balanceOf[msg.sender] = 1000000 ether;
            }

            function setReentrancy(address _swap, bool _shouldReenter, bytes calldata _data) external {
                swapTarget = _swap;
                shouldReenter = _shouldReenter;
                reenterData = _data;
            }

            function transfer(address to, uint256 amount) external returns (bool) {
                balanceOf[msg.sender] -= amount;
                balanceOf[to] += amount;
                return true;
            }

            function transferFrom(address from, address to, uint256 amount) external returns (bool) {
                if (allowance[from][msg.sender] != type(uint256).max) {
                    allowance[from][msg.sender] -= amount;
                }
                balanceOf[from] -= amount;
                balanceOf[to] += amount;
                return true;
            }

            function approve(address spender, uint256 amount) external returns (bool) {
                allowance[msg.sender][spender] = amount;
                return true;
            }

            function approveToken(address token, address spender, uint256 amount) external {
                (bool s, ) = token.call(abi.encodeWithSignature("approve(address,uint256)", spender, amount));
                require(s, "approve failed");
            }

            function permit(
                address /* owner */,
                address /* spender */,
                uint256 /* value */,
                uint256 /* deadline */,
                uint8 /* v */,
                bytes32 /* r */,
                bytes32 /* s */
            ) external {
                if (shouldReenter) {
                    shouldReenter = false; // avoid infinite loop
                    (bool success, bytes memory ret) = swapTarget.call(reenterData);
                    if (!success) {
                        assembly {
                            revert(add(ret, 32), mload(ret))
                        }
                    }
                }
            }
        }
        `;

        const solcInput = {
            language: 'Solidity',
            sources: { 'ReentrantToken.sol': { content: tokenSource } },
            settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } } },
        };
        const output = JSON.parse(solc.compile(JSON.stringify(solcInput)));
        const compiled = output.contracts['ReentrantToken.sol'].ReentrantPermitTokenMock;
        ReentrantTokenFactory = new ethers.ContractFactory(compiled.abi, compiled.evm.bytecode.object, addr);
    });

    beforeEach(async function () {
        ({ dai, weth, swap } = await deploySwapTokens());

        // Fund accounts
        await dai.mint(taker, ether('10000'));
        await dai.mint(solver, ether('10000'));
        await weth.connect(addr).deposit({ value: ether('10') });

        // Approvals
        await dai.connect(taker).approve(swap, ether('10000'));
        await dai.connect(solver).approve(swap, ether('10000'));
        await weth.connect(addr).approve(swap, ether('10'));
    });

    describe('1. Access Control & Authorization Invariants', function () {
        it('allows only the designated solver to fill a private order (allowedSender)', async function () {
            // Maker designates solver as the exclusive allowed sender
            const order = buildOrder({
                maker: addr.address,
                makerAsset: await weth.getAddress(),
                takerAsset: await dai.getAddress(),
                makingAmount: ether('1'),
                takingAmount: ether('2000'),
                makerTraits: buildMakerTraits({ allowedSender: solver.address }),
            });

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));
            const takerTraits = buildTakerTraits({ makingAmount: true, threshold: order.takingAmount });

            // Negative control: unauthorized taker reverts with PrivateOrder()
            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args)
            ).to.be.revertedWithCustomError(swap, 'PrivateOrder');

            // Positive control: designated solver fills successfully
            await expect(
                swap.connect(solver).fillOrderArgs(order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args)
            ).to.changeTokenBalances(weth, [addr, solver], [ether('-1'), ether('1')]);
        });

        it('enforces order expiration strictly at block timestamp boundary', async function () {
            const now = await time.latest();
            const expirationTime = now + 100;

            const order = buildOrder({
                maker: addr.address,
                makerAsset: await weth.getAddress(),
                takerAsset: await dai.getAddress(),
                makingAmount: ether('1'),
                takingAmount: ether('2000'),
                makerTraits: buildMakerTraitsRFQ({ expiry: expirationTime }),
            });

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));
            const takerTraits = buildTakerTraits({ makingAmount: true, threshold: order.takingAmount });

            // Positive control: fill at expirationTime - 10 succeeds
            await time.increaseTo(expirationTime - 10);
            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args)
            ).to.changeTokenBalances(weth, [addr, taker], [ether('-1'), ether('1')]);

            // Re-sign for next test at expirationTime + 1
            const order2 = buildOrder({
                maker: addr.address,
                makerAsset: await weth.getAddress(),
                takerAsset: await dai.getAddress(),
                makingAmount: ether('1'),
                takingAmount: ether('2000'),
                makerTraits: buildMakerTraitsRFQ({ expiry: expirationTime, nonce: 1 }),
            });
            const sig2 = ethers.Signature.from(await signOrder(order2, chainId, await swap.getAddress(), addr));

            // Negative control: advance to expirationTime + 1 -> reverts with OrderExpired()
            await time.increaseTo(expirationTime + 1);
            await expect(
                swap.connect(taker).fillOrderArgs(order2, sig2.r, sig2.yParityAndS, order2.makingAmount, takerTraits.traits, takerTraits.args)
            ).to.be.revertedWithCustomError(swap, 'OrderExpired');
        });

        it('enforces SeriesEpochManager series validation and atomic cancellation via increaseEpoch', async function () {
            const series = 5n;
            const currentEpoch = await swap.epoch(addr.address, series);

            const order = buildOrder({
                maker: addr.address,
                makerAsset: await weth.getAddress(),
                takerAsset: await dai.getAddress(),
                makingAmount: ether('1'),
                takingAmount: ether('2000'),
                makerTraits: buildMakerTraits({
                    shouldCheckEpoch: true,
                    series: Number(series),
                    nonce: Number(currentEpoch),
                }),
            });

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));
            const takerTraits = buildTakerTraits({ makingAmount: true, threshold: order.takingAmount });

            // Maker bumps epoch for series 5
            await swap.connect(addr).increaseEpoch(series);

            // Negative control: order referencing old epoch reverts with WrongSeriesNonce()
            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args)
            ).to.be.revertedWithCustomError(swap, 'WrongSeriesNonce');
        });

        it('reverts when order configures both needCheckEpochManager and useBitInvalidator', async function () {
            // MakerTraitsRFQ sets allowMultipleFills: false (bit invalidator)
            const order = buildOrder({
                maker: addr.address,
                makerAsset: await weth.getAddress(),
                takerAsset: await dai.getAddress(),
                makingAmount: ether('1'),
                takingAmount: ether('2000'),
                makerTraits: buildMakerTraitsRFQ({ shouldCheckEpoch: true, series: 1, nonce: 0 }),
            });

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));
            const takerTraits = buildTakerTraits({ makingAmount: true, threshold: order.takingAmount });

            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args)
            ).to.be.revertedWithCustomError(swap, 'EpochManagerAndBitInvalidatorsAreIncompatible');
        });
    });

    describe('2. Asset Routing & Recipient Invariants', function () {
        it('routes taking tokens to custom receiver instead of maker', async function () {
            const order = buildOrder({
                maker: addr.address,
                receiver: receiver.address, // Custom recipient
                makerAsset: await weth.getAddress(),
                takerAsset: await dai.getAddress(),
                makingAmount: ether('1'),
                takingAmount: ether('2000'),
                makerTraits: buildMakerTraitsRFQ(),
            });

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));
            const takerTraits = buildTakerTraits({ makingAmount: true, threshold: order.takingAmount });

            // Maker balance of DAI does NOT change; receiver balance receives 2000 DAI
            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args)
            ).to.changeTokenBalances(dai, [addr, receiver, taker], [0, ether('2000'), ether('-2000')]);
        });

        it('routes maker tokens to custom taker target while pulling taking tokens from msg.sender', async function () {
            const order = buildOrder({
                maker: addr.address,
                makerAsset: await weth.getAddress(),
                takerAsset: await dai.getAddress(),
                makingAmount: ether('1'),
                takingAmount: ether('2000'),
                makerTraits: buildMakerTraitsRFQ(),
            });

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));
            // Taker specifies target = target.address
            const takerTraits = buildTakerTraits({
                makingAmount: true,
                target: target.address,
                threshold: order.takingAmount,
            });

            // Target receives WETH, taker (msg.sender) pays DAI
            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args)
            ).to.changeTokenBalances(weth, [addr, target, taker], [ether('-1'), ether('1'), 0]);
        });

        it('settles native ETH to maker and refunds excess ETH to taker', async function () {
            // Maker sells DAI to receive ETH (order.takerAsset == WETH, unwrapWeth == true)
            await dai.mint(addr, ether('2000'));
            await dai.connect(addr).approve(swap, ether('2000'));

            const order = buildOrder({
                maker: addr.address,
                makerAsset: await dai.getAddress(),
                takerAsset: await weth.getAddress(),
                makingAmount: ether('2000'),
                takingAmount: ether('1'),
                makerTraits: buildMakerTraitsRFQ({ unwrapWeth: true }),
            });

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));
            const takerTraits = buildTakerTraits({ makingAmount: true, threshold: order.takingAmount });

            // Taker sends 1.5 ETH (excess 0.5 ETH)
            const tx = swap.connect(taker).fillOrderArgs(
                order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args,
                { value: ether('1.5') }
            );

            // Maker receives exact 1 ETH in native ether
            await expect(tx).to.changeEtherBalances([addr, taker], [ether('1'), ether('-1')]);
        });

        it('reverts when taker sends insufficient ETH or unexpected ETH on non-WETH order', async function () {
            await dai.mint(addr, ether('2000'));
            await dai.connect(addr).approve(swap, ether('2000'));

            const orderWeth = buildOrder({
                maker: addr.address,
                makerAsset: await dai.getAddress(),
                takerAsset: await weth.getAddress(),
                makingAmount: ether('2000'),
                takingAmount: ether('1'),
                makerTraits: buildMakerTraitsRFQ({ unwrapWeth: true }),
            });
            const sigWeth = ethers.Signature.from(await signOrder(orderWeth, chainId, await swap.getAddress(), addr));
            const takerTraits = buildTakerTraits({ makingAmount: true, threshold: orderWeth.takingAmount });

            // Negative control 1: insufficient ETH (0.5 ETH for 1 ETH takingAmount) -> InvalidMsgValue()
            await expect(
                swap.connect(taker).fillOrderArgs(
                    orderWeth, sigWeth.r, sigWeth.yParityAndS, orderWeth.makingAmount, takerTraits.traits, takerTraits.args,
                    { value: ether('0.5') }
                )
            ).to.be.revertedWithCustomError(swap, 'InvalidMsgValue');

            // Negative control 2: unexpected ETH on non-WETH takerAsset -> InvalidMsgValue()
            const orderDai = buildOrder({
                maker: addr.address,
                makerAsset: await weth.getAddress(),
                takerAsset: await dai.getAddress(),
                makingAmount: ether('1'),
                takingAmount: ether('2000'),
                makerTraits: buildMakerTraitsRFQ(),
            });
            const sigDai = ethers.Signature.from(await signOrder(orderDai, chainId, await swap.getAddress(), addr));
            const takerTraitsDai = buildTakerTraits({ makingAmount: true, threshold: orderDai.takingAmount });
            await expect(
                swap.connect(taker).fillOrderArgs(
                    orderDai, sigDai.r, sigDai.yParityAndS, orderDai.makingAmount, takerTraitsDai.traits, takerTraitsDai.args,
                    { value: ether('1') }
                )
            ).to.be.revertedWithCustomError(swap, 'InvalidMsgValue');
        });

        it('unwraps WETH into native ETH for taker when takerTraits.unwrapWeth is set', async function () {
            const order = buildOrder({
                maker: addr.address,
                makerAsset: await weth.getAddress(),
                takerAsset: await dai.getAddress(),
                makingAmount: ether('1'),
                takingAmount: ether('2000'),
                makerTraits: buildMakerTraitsRFQ(),
            });

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));
            const takerTraits = buildTakerTraits({
                makingAmount: true,
                unwrapWeth: true, // Taker requests native ETH
                threshold: order.takingAmount,
            });

            // Taker receives 1 ETH native balance
            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args)
            ).to.changeEtherBalance(taker, ether('1'));
        });
    });

    describe('3. Amount Bounds, Partial Fills & Slippage Invariants', function () {
        it('enforces allowPartialFill = false by rejecting partial fills with PartialFillNotAllowed', async function () {
            const order = buildOrder({
                maker: addr.address,
                makerAsset: await weth.getAddress(),
                takerAsset: await dai.getAddress(),
                makingAmount: ether('2'),
                takingAmount: ether('4000'),
                makerTraits: buildMakerTraitsRFQ({ allowPartialFill: false }),
            });

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));
            const takerTraits = buildTakerTraits({ makingAmount: true, threshold: ether('2000') });

            // Negative control: fill 1 ETH out of 2 ETH reverts
            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, ether('1'), takerTraits.traits, takerTraits.args)
            ).to.be.revertedWithCustomError(swap, 'PartialFillNotAllowed');

            // Positive control: full fill (2 ETH) succeeds
            const takerTraitsFull = buildTakerTraits({ makingAmount: true, threshold: ether('4000') });
            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, ether('2'), takerTraitsFull.traits, takerTraitsFull.args)
            ).to.changeTokenBalances(weth, [addr, taker], [ether('-2'), ether('2')]);
        });

        it('reverts on zero fill amount with SwapWithZeroAmount', async function () {
            const order = buildOrder({
                maker: addr.address,
                makerAsset: await weth.getAddress(),
                takerAsset: await dai.getAddress(),
                makingAmount: ether('1'),
                takingAmount: ether('2000'),
                makerTraits: buildMakerTraitsRFQ(),
            });

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));
            const takerTraits = buildTakerTraits({ makingAmount: true, threshold: order.takingAmount });

            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, 0n, takerTraits.traits, takerTraits.args)
            ).to.be.revertedWithCustomError(swap, 'SwapWithZeroAmount');
        });

        it('enforces taker slippage protection thresholds in both making and taking modes', async function () {
            const order = buildOrder({
                maker: addr.address,
                makerAsset: await weth.getAddress(),
                takerAsset: await dai.getAddress(),
                makingAmount: ether('1'),
                takingAmount: ether('2000'),
                makerTraits: buildMakerTraitsRFQ(),
            });

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));

            // Mode 1: making amount mode with threshold too low (demands 1 ETH for at most 1999 DAI)
            const takerTraitsLowThreshold = buildTakerTraits({ makingAmount: true, threshold: ether('1999') });
            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, ether('1'), takerTraitsLowThreshold.traits, takerTraitsLowThreshold.args)
            ).to.be.revertedWithCustomError(swap, 'TakingAmountTooHigh');

            // Mode 2: taking amount mode with threshold too high (offers 2000 DAI demanding at least 1.1 ETH)
            const takerTraitsHighThreshold = buildTakerTraits({ makingAmount: false, threshold: ether('1.1') });
            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, ether('2000'), takerTraitsHighThreshold.traits, takerTraitsHighThreshold.args)
            ).to.be.revertedWithCustomError(swap, 'MakingAmountTooLow');
        });

        it('maintains strict partial-fill accounting across multiple partial fills and invalidates upon full fill', async function () {
            // Ensure taker has enough DAI for all 3 fills (total 20,000 DAI)
            await dai.mint(taker, ether('30000'));
            await dai.connect(taker).approve(swap, ether('30000'));

            const order = buildOrder({
                maker: addr.address,
                makerAsset: await weth.getAddress(),
                takerAsset: await dai.getAddress(),
                makingAmount: ether('10'),
                takingAmount: ether('20000'),
                makerTraits: buildMakerTraits({ allowPartialFills: true, allowMultipleFills: true }),
            });

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));

            const orderHash = await swap.hashOrder(order);

            // Fill 1: 40% (4 ETH) -> remaining 6 ETH
            const traits1 = buildTakerTraits({ makingAmount: true, threshold: ether('8000') });
            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, ether('4'), traits1.traits, traits1.args)
            ).to.changeTokenBalances(weth, [addr, taker], [ether('-4'), ether('4')]);
            expect(await swap.remainingInvalidatorForOrder(addr.address, orderHash)).to.equal(ether('6'));

            // Fill 2: 40% (4 ETH) -> remaining 2 ETH
            const traits2 = buildTakerTraits({ makingAmount: true, threshold: ether('8000') });
            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, ether('4'), traits2.traits, traits2.args)
            ).to.changeTokenBalances(weth, [addr, taker], [ether('-4'), ether('4')]);
            expect(await swap.remainingInvalidatorForOrder(addr.address, orderHash)).to.equal(ether('2'));

            // Fill 3: 20% (2 ETH) -> remaining 0 ETH (fully filled)
            const traits3 = buildTakerTraits({ makingAmount: true, threshold: ether('4000') });
            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, ether('2'), traits3.traits, traits3.args)
            ).to.changeTokenBalances(weth, [addr, taker], [ether('-2'), ether('2')]);

            // Fill 4: Attempting any additional fill on the completed order reverts with InvalidatedOrder()
            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, ether('1'), traits1.traits, traits1.args)
            ).to.be.revertedWithCustomError(swap, 'InvalidatedOrder');
        });
    });

    describe('4. Maker Permit Reentrancy Defense', function () {
        it('detects reentrancy during makerPermit execution and reverts with ReentrancyDetected (remaining invalidator)', async function () {
            const reentrantToken = await ReentrantTokenFactory.deploy();
            await reentrantToken.waitForDeployment();

            // Fund maker with reentrantToken and approve swap
            await reentrantToken.transfer(addr.address, ether('100'));
            await reentrantToken.connect(addr).approve(swap, ether('100'));

            // Fund reentrantToken with DAI and approve swap so the inner call can complete taking payment
            await dai.mint(await reentrantToken.getAddress(), ether('1000'));
            await reentrantToken.approveToken(await dai.getAddress(), await swap.getAddress(), ether('1000'));

            // Construct outer order whose extension includes makerPermit pointing to reentrantToken
            // permit calldata: 20 bytes token address + 224 bytes dummy permit data = 244 bytes
            const dummyPermitPayload = ethers.solidityPacked(
                ['address', 'bytes'],
                [await reentrantToken.getAddress(), '0x' + '00'.repeat(224)]
            );

            const outerOrder = buildOrder(
                {
                    maker: addr.address,
                    makerAsset: await reentrantToken.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: ether('1'),
                    takingAmount: ether('100'),
                    makerTraits: buildMakerTraits({ allowPartialFills: true, allowMultipleFills: true }),
                },
                {
                    permit: dummyPermitPayload,
                }
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(outerOrder, chainId, await swap.getAddress(), addr));
            const outerTakerTraits = buildTakerTraits({ makingAmount: true, extension: outerOrder.extension, threshold: outerOrder.takingAmount });

            // Inner call fills 0.5 ether of outerOrder with skipMakerPermit: true to avoid looping
            const innerTakerTraits = buildTakerTraits({
                makingAmount: true,
                skipMakerPermit: true,
                extension: outerOrder.extension,
                threshold: outerOrder.takingAmount,
            });

            const innerOrderData = swap.interface.encodeFunctionData('fillOrderArgs', [
                outerOrder,
                r,
                vs,
                ether('0.5'),
                innerTakerTraits.traits,
                innerTakerTraits.args,
            ]);

            // Configure reentrantToken to reenter swap with innerOrderData
            await reentrantToken.setReentrancy(await swap.getAddress(), true, innerOrderData);

            // Execution: outerOrder calls tryPermit -> reentrantToken.permit calls swap.fillOrderArgs ->
            // inner call alters _remainingInvalidator -> outer call resumes at line 182 and reverts with ReentrancyDetected()
            await expect(
                swap.connect(taker).fillOrderArgs(outerOrder, r, vs, outerOrder.makingAmount, outerTakerTraits.traits, outerTakerTraits.args)
            ).to.be.revertedWithCustomError(swap, 'ReentrancyDetected');
        });

        it('detects reentrancy during makerPermit execution and reverts with BitInvalidatedOrder (bit invalidator)', async function () {
            const reentrantToken = await ReentrantTokenFactory.deploy();
            await reentrantToken.waitForDeployment();

            // Fund maker with reentrantToken and approve swap
            await reentrantToken.transfer(addr.address, ether('100'));
            await reentrantToken.connect(addr).approve(swap, ether('100'));

            // Fund reentrantToken with DAI and approve swap
            await dai.mint(await reentrantToken.getAddress(), ether('1000'));
            await reentrantToken.approveToken(await dai.getAddress(), await swap.getAddress(), ether('1000'));

            const dummyPermitPayload = ethers.solidityPacked(
                ['address', 'bytes'],
                [await reentrantToken.getAddress(), '0x' + '00'.repeat(224)]
            );

            // Bit-invalidator order (allowMultipleFills: false)
            const bitOrder = buildOrder(
                {
                    maker: addr.address,
                    makerAsset: await reentrantToken.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: ether('1'),
                    takingAmount: ether('100'),
                    makerTraits: buildMakerTraitsRFQ(),
                },
                {
                    permit: dummyPermitPayload,
                }
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(bitOrder, chainId, await swap.getAddress(), addr));
            const outerTakerTraits = buildTakerTraits({ makingAmount: true, extension: bitOrder.extension, threshold: bitOrder.takingAmount });

            const innerTakerTraits = buildTakerTraits({
                makingAmount: true,
                skipMakerPermit: true,
                extension: bitOrder.extension,
                threshold: bitOrder.takingAmount,
            });

            const innerOrderData = swap.interface.encodeFunctionData('fillOrderArgs', [
                bitOrder,
                r,
                vs,
                bitOrder.makingAmount,
                innerTakerTraits.traits,
                innerTakerTraits.args,
            ]);

            await reentrantToken.setReentrancy(await swap.getAddress(), true, innerOrderData);

            // Inner call consumes the bit invalidator -> outer call reaches Step 5 and reverts with BitInvalidatedOrder()
            await expect(
                swap.connect(taker).fillOrderArgs(bitOrder, r, vs, bitOrder.makingAmount, outerTakerTraits.traits, outerTakerTraits.args)
            ).to.be.revertedWithCustomError(swap, 'BitInvalidatedOrder');
        });
    });

    describe('5. Settlement Rollback & Invalidator State Invariant', function () {
        it('rolls back decremented remainingMakingAmount when taker payment defaults in Step 9', async function () {
            const order = buildOrder({
                maker: addr.address,
                makerAsset: await weth.getAddress(),
                takerAsset: await dai.getAddress(),
                makingAmount: ether('5'),
                takingAmount: ether('10000'),
                makerTraits: buildMakerTraits({ allowPartialFills: true, allowMultipleFills: true }),
            });

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));
            const takerTraits = buildTakerTraits({ makingAmount: true, threshold: ether('10000') });

            // Reduce taker's allowance to 0 so Step 9 fails
            await dai.connect(taker).approve(swap, 0);

            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, ether('5'), takerTraits.traits, takerTraits.args)
            ).to.be.revertedWithCustomError(swap, 'TransferFromTakerToMakerFailed');

            // CRITICAL INVARIANT: Order was not consumed or partially invalidated!
            // Restore taker allowance and verify order can still be filled completely
            await dai.connect(taker).approve(swap, ether('10000'));

            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, ether('5'), takerTraits.traits, takerTraits.args)
            ).to.changeTokenBalances(weth, [addr, taker], [ether('-5'), ether('5')]);
        });
    });
});
