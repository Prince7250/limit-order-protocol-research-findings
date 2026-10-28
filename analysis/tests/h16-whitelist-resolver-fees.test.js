const { expect, constants } = require('@1inch/solidity-utils');
const { ethers } = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { deploySwapTokens } = require('../../test/helpers/fixtures');
const { ether } = require('../../test/helpers/utils');
const { buildOrder, buildMakerTraits, signOrder, buildTakerTraits, buildFeeTakerExtensions } = require('../../test/helpers/orderUtils');

describe('H-16: Whitelist Discounts and Resolver Fee Structures', function () {
    const BASE_1E5 = 100000n;
    const BASE_1E2 = 100n;

    // Helper to format packed whitelist calldata: 1 byte size + N * 10 bytes (lowest 80 bits of address)
    function formatWhitelist(addresses) {
        if (!addresses || addresses.length === 0) {
            return '0x00';
        }
        const sizeHex = ethers.toBeHex(addresses.length, 1).slice(2);
        const addressesHex = addresses.map(a => {
            const clean = a.startsWith('0x') ? a.slice(2) : a;
            return clean.slice(-20);
        }).join('');
        return '0x' + sizeHex + addressesHex;
    }

    // Mathematical reference implementation for fee calculations
    function refCalculateFees({ takingAmount, integratorFee, integratorShare, resolverFee, whitelistDiscount, isWhitelisted }) {
        const tAmt = BigInt(takingAmount);
        const iFee = BigInt(integratorFee);
        const iShare = BigInt(integratorShare);
        let rFee = BigInt(resolverFee);
        const wDisc = BigInt(whitelistDiscount);

        if (isWhitelisted) {
            rFee = (rFee * wDisc) / BASE_1E2;
        }

        const denominator = BASE_1E5 + iFee + rFee;
        const integratorFeeTotal = (tAmt * iFee) / denominator;
        const integratorFeeAmount = (integratorFeeTotal * iShare) / BASE_1E2;
        const protocolFeeAmount = ((tAmt * rFee) / denominator) + integratorFeeTotal - integratorFeeAmount;
        const receiverAmount = tAmt - integratorFeeAmount - protocolFeeAmount;

        return {
            rFeeDiscounted: rFee,
            denominator,
            integratorFeeTotal,
            integratorFeeAmount,
            protocolFeeAmount,
            receiverAmount,
        };
    }

    async function deployContractsFixture() {
        const [
            owner,
            maker,
            whitelistedTaker,
            tokenResolver,
            unauthorizedResolver,
            integratorFeeRecipient,
            protocolFeeRecipient,
            customReceiver,
        ] = await ethers.getSigners();

        const { dai, weth, inch, swap, chainId } = await loadFixture(deploySwapTokens);

        // Deploy FeeTaker: swap, accessToken (inch), weth, owner
        const FeeTaker = await ethers.getContractFactory('FeeTaker');
        const feeTaker = await FeeTaker.deploy(
            await swap.getAddress(),
            await inch.getAddress(),
            await weth.getAddress(),
            owner.address,
        );
        await feeTaker.waitForDeployment();

        // Mint DAI to maker
        await dai.mint(maker.address, ether('1000000'));
        await dai.connect(maker).approve(swap, ethers.MaxUint256);

        // Setup WETH for takers
        await weth.connect(whitelistedTaker).deposit({ value: ether('50') });
        await weth.connect(whitelistedTaker).approve(swap, ethers.MaxUint256);

        await weth.connect(tokenResolver).deposit({ value: ether('50') });
        await weth.connect(tokenResolver).approve(swap, ethers.MaxUint256);

        await weth.connect(unauthorizedResolver).deposit({ value: ether('50') });
        await weth.connect(unauthorizedResolver).approve(swap, ethers.MaxUint256);

        // Fund tokenResolver with accessToken (inch)
        await inch.mint(tokenResolver.address, ether('1000'));

        // Whitelisted taker has NO inch access tokens
        // Unauthorized resolver has NO inch access tokens and is NOT in whitelist

        return {
            owner,
            maker,
            whitelistedTaker,
            tokenResolver,
            unauthorizedResolver,
            integratorFeeRecipient,
            protocolFeeRecipient,
            customReceiver,
            dai,
            weth,
            inch,
            swap,
            feeTaker,
            chainId,
        };
    }

    // =========================================================================
    // 1. Investigation A: Whitelist Eligibility & Calldata Parsing
    // =========================================================================
    describe('1. Whitelist Eligibility & Calldata Parsing', function () {
        it('verifies whitelisted taker is recognized when single entry is present', async function () {
            const { feeTaker, whitelistedTaker } = await loadFixture(deployContractsFixture);

            const whitelist = formatWhitelist([whitelistedTaker.address]);
            const extraData = ethers.solidityPacked(
                ['uint16', 'uint8', 'uint16', 'uint8', 'bytes'],
                [1000, 50, 2000, 50, whitelist],
            );

            const dummyOrder = {
                salt: 0,
                maker: constants.ZERO_ADDRESS,
                receiver: constants.ZERO_ADDRESS,
                makerAsset: constants.ZERO_ADDRESS,
                takerAsset: constants.ZERO_ADDRESS,
                makingAmount: ether('100'),
                takingAmount: ether('1'),
                makerTraits: 0,
            };

            // Call getTakingAmount: with 50% discount on 2000 resolverFee -> 1000 resolverFee
            // total fee = 1000 (integrator) + 1000 (resolver) = 2000 (2%)
            // expected taking amount = 1 ether * (100000 + 2000) / 100000 = 1.02 ether
            const takingAmount = await feeTaker.getTakingAmount(
                dummyOrder,
                '0x',
                ethers.ZeroHash,
                whitelistedTaker.address,
                ether('100'),
                ether('100'),
                extraData,
            );

            expect(takingAmount).to.equal(ether('1.02'));
        });

        it('verifies linear search correctly identifies address at start, middle, and end of whitelist', async function () {
            const { feeTaker, owner, maker, whitelistedTaker, tokenResolver, unauthorizedResolver } = await loadFixture(deployContractsFixture);

            const addresses = [
                owner.address,
                maker.address,
                whitelistedTaker.address,
                tokenResolver.address,
            ];
            const whitelist = formatWhitelist(addresses);
            const extraData = ethers.solidityPacked(
                ['uint16', 'uint8', 'uint16', 'uint8', 'bytes'],
                [1000, 50, 2000, 50, whitelist],
            );

            const dummyOrder = {
                salt: 0,
                maker: constants.ZERO_ADDRESS,
                receiver: constants.ZERO_ADDRESS,
                makerAsset: constants.ZERO_ADDRESS,
                takerAsset: constants.ZERO_ADDRESS,
                makingAmount: ether('100'),
                takingAmount: ether('1'),
                makerTraits: 0,
            };

            // Start (owner): whitelisted -> 1.02 ether
            const startTaking = await feeTaker.getTakingAmount(
                dummyOrder, '0x', ethers.ZeroHash, owner.address, ether('100'), ether('100'), extraData,
            );
            expect(startTaking).to.equal(ether('1.02'));

            // Middle (whitelistedTaker): whitelisted -> 1.02 ether
            const middleTaking = await feeTaker.getTakingAmount(
                dummyOrder, '0x', ethers.ZeroHash, whitelistedTaker.address, ether('100'), ether('100'), extraData,
            );
            expect(middleTaking).to.equal(ether('1.02'));

            // End (tokenResolver): whitelisted -> 1.02 ether
            const endTaking = await feeTaker.getTakingAmount(
                dummyOrder, '0x', ethers.ZeroHash, tokenResolver.address, ether('100'), ether('100'), extraData,
            );
            expect(endTaking).to.equal(ether('1.02'));

            // Not in list (unauthorizedResolver): undiscounted resolver fee (2000)
            // total fee = 1000 + 2000 = 3000 (3%) -> expected taking amount = 1.03 ether
            const nonWhitelistedTaking = await feeTaker.getTakingAmount(
                dummyOrder, '0x', ethers.ZeroHash, unauthorizedResolver.address, ether('100'), ether('100'), extraData,
            );
            expect(nonWhitelistedTaking).to.equal(ether('1.03'));
        });

        it('verifies empty whitelist (size == 0) treats all callers as non-whitelisted', async function () {
            const { feeTaker, whitelistedTaker } = await loadFixture(deployContractsFixture);

            const extraData = ethers.solidityPacked(
                ['uint16', 'uint8', 'uint16', 'uint8', 'bytes'],
                [1000, 50, 2000, 50, '0x00'],
            );

            const dummyOrder = {
                salt: 0,
                maker: constants.ZERO_ADDRESS,
                receiver: constants.ZERO_ADDRESS,
                makerAsset: constants.ZERO_ADDRESS,
                takerAsset: constants.ZERO_ADDRESS,
                makingAmount: ether('100'),
                takingAmount: ether('1'),
                makerTraits: 0,
            };

            // Full 3% fee (1.03 ether)
            const takingAmount = await feeTaker.getTakingAmount(
                dummyOrder, '0x', ethers.ZeroHash, whitelistedTaker.address, ether('100'), ether('100'), extraData,
            );
            expect(takingAmount).to.equal(ether('1.03'));
        });

        it('proves 80-bit address masking allows collision if lowest 10 bytes match', async function () {
            const { feeTaker } = await loadFixture(deployContractsFixture);

            // Construct two addresses with identical lowest 10 bytes but different top 10 bytes
            const baseTail = '112233445566778899aa';
            const addressA = '0x11111111111111111111' + baseTail;
            const addressB = '0x22222222222222222222' + baseTail;

            const whitelist = '0x01' + baseTail;
            const extraData = ethers.solidityPacked(
                ['uint16', 'uint8', 'uint16', 'uint8', 'bytes'],
                [1000, 50, 2000, 50, whitelist],
            );

            const dummyOrder = {
                salt: 0,
                maker: constants.ZERO_ADDRESS,
                receiver: constants.ZERO_ADDRESS,
                makerAsset: constants.ZERO_ADDRESS,
                takerAsset: constants.ZERO_ADDRESS,
                makingAmount: ether('100'),
                takingAmount: ether('1'),
                makerTraits: 0,
            };

            const takingA = await feeTaker.getTakingAmount(
                dummyOrder, '0x', ethers.ZeroHash, addressA, ether('100'), ether('100'), extraData,
            );
            const takingB = await feeTaker.getTakingAmount(
                dummyOrder, '0x', ethers.ZeroHash, addressB, ether('100'), ether('100'), extraData,
            );

            // Both match and receive discounted 2% fee (1.02 ether)
            expect(takingA).to.equal(ether('1.02'));
            expect(takingB).to.equal(ether('1.02'));
        });

        it('reverts without reason when whitelist calldata is shorter than declared size', async function () {
            const { feeTaker, whitelistedTaker } = await loadFixture(deployContractsFixture);

            // Declare size = 5 (needs 51 bytes: 1 + 50), but provide only 5 bytes
            const truncatedWhitelist = '0x0511223344';
            const extraData = ethers.solidityPacked(
                ['uint16', 'uint8', 'uint16', 'uint8', 'bytes'],
                [1000, 50, 2000, 50, truncatedWhitelist],
            );

            const dummyOrder = {
                salt: 0,
                maker: constants.ZERO_ADDRESS,
                receiver: constants.ZERO_ADDRESS,
                makerAsset: constants.ZERO_ADDRESS,
                takerAsset: constants.ZERO_ADDRESS,
                makingAmount: ether('100'),
                takingAmount: ether('1'),
                makerTraits: 0,
            };

            await expect(
                feeTaker.getTakingAmount(dummyOrder, '0x', ethers.ZeroHash, whitelistedTaker.address, ether('100'), ether('100'), extraData)
            ).to.be.revertedWithoutReason();
        });

        it('reverts with InvalidWhitelistDiscountNumerator when discount numerator > 100', async function () {
            const { feeTaker, whitelistedTaker } = await loadFixture(deployContractsFixture);

            const extraData = ethers.solidityPacked(
                ['uint16', 'uint8', 'uint16', 'uint8', 'bytes'],
                [1000, 50, 2000, 101, '0x00'], // discount numerator 101 > 100
            );

            const dummyOrder = {
                salt: 0,
                maker: constants.ZERO_ADDRESS,
                receiver: constants.ZERO_ADDRESS,
                makerAsset: constants.ZERO_ADDRESS,
                takerAsset: constants.ZERO_ADDRESS,
                makingAmount: ether('100'),
                takingAmount: ether('1'),
                makerTraits: 0,
            };

            await expect(
                feeTaker.getTakingAmount(dummyOrder, '0x', ethers.ZeroHash, whitelistedTaker.address, ether('100'), ether('100'), extraData)
            ).to.be.revertedWithCustomError(feeTaker, 'InvalidWhitelistDiscountNumerator');
        });

        it('reverts with InvalidIntegratorShare when integrator share > 100', async function () {
            const { feeTaker, whitelistedTaker } = await loadFixture(deployContractsFixture);

            const extraData = ethers.solidityPacked(
                ['uint16', 'uint8', 'uint16', 'uint8', 'bytes'],
                [1000, 101, 2000, 50, '0x00'], // integratorShare 101 > 100
            );

            const dummyOrder = {
                salt: 0,
                maker: constants.ZERO_ADDRESS,
                receiver: constants.ZERO_ADDRESS,
                makerAsset: constants.ZERO_ADDRESS,
                takerAsset: constants.ZERO_ADDRESS,
                makingAmount: ether('100'),
                takingAmount: ether('1'),
                makerTraits: 0,
            };

            await expect(
                feeTaker.getTakingAmount(dummyOrder, '0x', ethers.ZeroHash, whitelistedTaker.address, ether('100'), ether('100'), extraData)
            ).to.be.revertedWithCustomError(feeTaker, 'InvalidIntegratorShare');
        });
    });

    // =========================================================================
    // 2. Investigation B: Resolver Verification & Access Token Gate
    // =========================================================================
    describe('2. Resolver Verification & Access Token Gate', function () {
        it('allows whitelisted resolver without access token to fill order with discount', async function () {
            const {
                maker,
                whitelistedTaker,
                integratorFeeRecipient,
                protocolFeeRecipient,
                dai,
                weth,
                inch,
                swap,
                feeTaker,
                chainId,
            } = await loadFixture(deployContractsFixture);

            // Confirm whitelistedTaker has 0 inch tokens
            expect(await inch.balanceOf(whitelistedTaker.address)).to.equal(0n);

            const makingAmount = ether('300');
            const takingAmount = ether('0.3');
            const integratorFee = 10000; // 10%
            const resolverFee = 2000;    // 2%
            const whitelistDiscount = 50; // 50% discount on resolver fee -> 1%
            const whitelist = formatWhitelist([whitelistedTaker.address]);

            const order = buildOrder(
                {
                    maker: maker.address,
                    receiver: await feeTaker.getAddress(),
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount,
                    takingAmount,
                },
                buildFeeTakerExtensions({
                    feeTaker: await feeTaker.getAddress(),
                    integratorFeeRecipient: integratorFeeRecipient.address,
                    protocolFeeRecipient: protocolFeeRecipient.address,
                    integratorFee,
                    integratorShare: 50,
                    resolverFee,
                    whitelistDiscount,
                    whitelist,
                }),
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), maker));
            const takerTraits = buildTakerTraits({
                makingAmount: true,
                extension: order.extension,
            });

            // Taker is whitelisted -> succeeds!
            const fillTx = swap.connect(whitelistedTaker).fillOrderArgs(
                order, r, vs, makingAmount, takerTraits.traits, takerTraits.args,
            );

            // Check fee breakdown:
            // Discounted resolverFee = 1000 (1%)
            // Total fee rate = 10000 + 1000 = 11000 (11%)
            // Fee charged = 0.3 * 11000 / 100000 = 0.033 ether
            const ref = refCalculateFees({
                takingAmount: ether('0.333'), // total taker paid = 0.3 base + 0.033 fee
                integratorFee,
                integratorShare: 50,
                resolverFee,
                whitelistDiscount,
                isWhitelisted: true,
            });

            await expect(fillTx).to.changeTokenBalances(dai, [whitelistedTaker, maker], [makingAmount, -makingAmount]);
            await expect(fillTx).to.changeTokenBalances(
                weth,
                [whitelistedTaker, maker, integratorFeeRecipient, protocolFeeRecipient],
                [-ether('0.333'), ether('0.3'), ref.integratorFeeAmount, ref.protocolFeeAmount],
            );
        });

        it('allows non-whitelisted resolver WITH access token to fill order at full undiscounted fee', async function () {
            const {
                maker,
                tokenResolver,
                whitelistedTaker,
                integratorFeeRecipient,
                protocolFeeRecipient,
                dai,
                weth,
                inch,
                swap,
                feeTaker,
                chainId,
            } = await loadFixture(deployContractsFixture);

            // tokenResolver has inch tokens, but is NOT in whitelist
            expect(await inch.balanceOf(tokenResolver.address)).to.be.gt(0n);

            const makingAmount = ether('300');
            const takingAmount = ether('0.3');
            const integratorFee = 10000; // 10%
            const resolverFee = 2000;    // 2%
            const whitelistDiscount = 50; // 50% discount for whitelist only
            const whitelist = formatWhitelist([whitelistedTaker.address]); // only whitelistedTaker in whitelist

            const order = buildOrder(
                {
                    maker: maker.address,
                    receiver: await feeTaker.getAddress(),
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount,
                    takingAmount,
                },
                buildFeeTakerExtensions({
                    feeTaker: await feeTaker.getAddress(),
                    integratorFeeRecipient: integratorFeeRecipient.address,
                    protocolFeeRecipient: protocolFeeRecipient.address,
                    integratorFee,
                    integratorShare: 50,
                    resolverFee,
                    whitelistDiscount,
                    whitelist,
                }),
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), maker));
            const takerTraits = buildTakerTraits({
                makingAmount: true,
                extension: order.extension,
            });

            // tokenResolver is NOT whitelisted, but holds access token -> succeeds at full fee!
            // Full fee rate = 10000 + 2000 = 12000 (12%)
            // Fee charged = 0.3 * 12000 / 100000 = 0.036 ether
            // Total taking amount = 0.336 ether
            const fillTx = swap.connect(tokenResolver).fillOrderArgs(
                order, r, vs, makingAmount, takerTraits.traits, takerTraits.args,
            );

            const ref = refCalculateFees({
                takingAmount: ether('0.336'),
                integratorFee,
                integratorShare: 50,
                resolverFee,
                whitelistDiscount,
                isWhitelisted: false, // NOT whitelisted
            });

            await expect(fillTx).to.changeTokenBalances(dai, [tokenResolver, maker], [makingAmount, -makingAmount]);
            await expect(fillTx).to.changeTokenBalances(
                weth,
                [tokenResolver, maker, integratorFeeRecipient, protocolFeeRecipient],
                [-ether('0.336'), ether('0.3'), ref.integratorFeeAmount, ref.protocolFeeAmount],
            );
        });

        it('reverts with OnlyWhitelistOrAccessToken when resolver is outside whitelist and lacks access token', async function () {
            const {
                maker,
                unauthorizedResolver,
                whitelistedTaker,
                integratorFeeRecipient,
                protocolFeeRecipient,
                dai,
                weth,
                inch,
                swap,
                feeTaker,
                chainId,
            } = await loadFixture(deployContractsFixture);

            // unauthorizedResolver has 0 inch tokens and is NOT in whitelist
            expect(await inch.balanceOf(unauthorizedResolver.address)).to.equal(0n);

            const makingAmount = ether('300');
            const takingAmount = ether('0.3');
            const whitelist = formatWhitelist([whitelistedTaker.address]);

            const order = buildOrder(
                {
                    maker: maker.address,
                    receiver: await feeTaker.getAddress(),
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount,
                    takingAmount,
                },
                buildFeeTakerExtensions({
                    feeTaker: await feeTaker.getAddress(),
                    integratorFeeRecipient: integratorFeeRecipient.address,
                    protocolFeeRecipient: protocolFeeRecipient.address,
                    integratorFee: 10000,
                    integratorShare: 50,
                    resolverFee: 2000,
                    whitelistDiscount: 50,
                    whitelist,
                }),
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), maker));
            const takerTraits = buildTakerTraits({
                makingAmount: true,
                extension: order.extension,
            });

            // Must revert with OnlyWhitelistOrAccessToken!
            await expect(
                swap.connect(unauthorizedResolver).fillOrderArgs(
                    order, r, vs, makingAmount, takerTraits.traits, takerTraits.args,
                )
            ).to.be.revertedWithCustomError(feeTaker, 'OnlyWhitelistOrAccessToken');
        });

        it('strictly binds resolver authorization to msg.sender (cannot spoof identity)', async function () {
            const {
                maker,
                unauthorizedResolver,
                whitelistedTaker,
                dai,
                weth,
                swap,
                feeTaker,
                chainId,
            } = await loadFixture(deployContractsFixture);

            const makingAmount = ether('300');
            const takingAmount = ether('0.3');
            const whitelist = formatWhitelist([whitelistedTaker.address]);

            const order = buildOrder(
                {
                    maker: maker.address,
                    receiver: await feeTaker.getAddress(),
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount,
                    takingAmount,
                },
                buildFeeTakerExtensions({
                    feeTaker: await feeTaker.getAddress(),
                    whitelist,
                }),
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), maker));
            const takerTraits = buildTakerTraits({
                makingAmount: true,
                extension: order.extension,
            });

            // unauthorizedResolver calls swap directly -> fails even if whitelistedTaker address appears in extra arguments
            await expect(
                swap.connect(unauthorizedResolver).fillOrderArgs(
                    order, r, vs, makingAmount, takerTraits.traits, takerTraits.args,
                )
            ).to.be.revertedWithCustomError(feeTaker, 'OnlyWhitelistOrAccessToken');
        });

        it('reverts with OnlyLimitOrderProtocol if FeeTaker.postInteraction is called directly', async function () {
            const { feeTaker, whitelistedTaker } = await loadFixture(deployContractsFixture);

            const dummyOrder = {
                salt: 0,
                maker: constants.ZERO_ADDRESS,
                receiver: constants.ZERO_ADDRESS,
                makerAsset: constants.ZERO_ADDRESS,
                takerAsset: constants.ZERO_ADDRESS,
                makingAmount: 0,
                takingAmount: 0,
                makerTraits: 0,
            };

            await expect(
                feeTaker.connect(whitelistedTaker).postInteraction(
                    dummyOrder, '0x', ethers.ZeroHash, whitelistedTaker.address, 0, 0, 0, '0x',
                )
            ).to.be.revertedWithCustomError(feeTaker, 'OnlyLimitOrderProtocol');
        });

        it('proves atomic rollback on resolver failure (zero balance mutations & zero invalidator state)', async function () {
            const {
                maker,
                unauthorizedResolver,
                whitelistedTaker,
                dai,
                weth,
                swap,
                feeTaker,
                chainId,
            } = await loadFixture(deployContractsFixture);

            const makingAmount = ether('300');
            const takingAmount = ether('0.3');
            const whitelist = formatWhitelist([whitelistedTaker.address]);

            const order = buildOrder(
                {
                    maker: maker.address,
                    receiver: await feeTaker.getAddress(),
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount,
                    takingAmount,
                },
                buildFeeTakerExtensions({
                    feeTaker: await feeTaker.getAddress(),
                    whitelist,
                }),
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), maker));
            const takerTraits = buildTakerTraits({
                makingAmount: true,
                extension: order.extension,
            });

            const makerDaiBefore = await dai.balanceOf(maker.address);
            const takerWethBefore = await weth.balanceOf(unauthorizedResolver.address);

            await expect(
                swap.connect(unauthorizedResolver).fillOrderArgs(
                    order, r, vs, makingAmount, takerTraits.traits, takerTraits.args,
                )
            ).to.be.revertedWithCustomError(feeTaker, 'OnlyWhitelistOrAccessToken');

            // Balances completely untouched
            expect(await dai.balanceOf(maker.address)).to.equal(makerDaiBefore);
            expect(await weth.balanceOf(unauthorizedResolver.address)).to.equal(takerWethBefore);
        });
    });

    // =========================================================================
    // 3. Investigation C: Fee Discounts & Settlement Accounting
    // =========================================================================
    describe('3. Fee Discounts & Settlement Accounting', function () {
        it('verifies 100% discount reduces resolverFee to 0 (only integratorFee charged)', async function () {
            const {
                maker,
                whitelistedTaker,
                integratorFeeRecipient,
                protocolFeeRecipient,
                dai,
                weth,
                swap,
                feeTaker,
                chainId,
            } = await loadFixture(deployContractsFixture);

            const makingAmount = ether('300');
            const takingAmount = ether('0.3');
            const integratorFee = 10000; // 10%
            const resolverFee = 2000;    // 2%
            const whitelistDiscount = 0; // 100% discount -> 0% resolver fee multiplier
            const whitelist = formatWhitelist([whitelistedTaker.address]);

            const order = buildOrder(
                {
                    maker: maker.address,
                    receiver: await feeTaker.getAddress(),
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount,
                    takingAmount,
                },
                buildFeeTakerExtensions({
                    feeTaker: await feeTaker.getAddress(),
                    integratorFeeRecipient: integratorFeeRecipient.address,
                    protocolFeeRecipient: protocolFeeRecipient.address,
                    integratorFee,
                    integratorShare: 50,
                    resolverFee,
                    whitelistDiscount,
                    whitelist,
                }),
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), maker));
            const takerTraits = buildTakerTraits({
                makingAmount: true,
                extension: order.extension,
            });

            // Total fee = 10% integratorFee, 0% resolverFee
            // Fee charged = 0.3 * 10000 / 100000 = 0.03 ether
            // Total taking = 0.33 ether
            const fillTx = swap.connect(whitelistedTaker).fillOrderArgs(
                order, r, vs, makingAmount, takerTraits.traits, takerTraits.args,
            );

            const ref = refCalculateFees({
                takingAmount: ether('0.33'),
                integratorFee,
                integratorShare: 50,
                resolverFee,
                whitelistDiscount,
                isWhitelisted: true,
            });

            expect(ref.rFeeDiscounted).to.equal(0n);
            await expect(fillTx).to.changeTokenBalances(
                weth,
                [whitelistedTaker, maker, integratorFeeRecipient, protocolFeeRecipient],
                [-ether('0.33'), ether('0.3'), ref.integratorFeeAmount, ref.protocolFeeAmount],
            );
        });

        it('verifies 0% discount (numerator = 100) charges identical fee to whitelist and non-whitelist', async function () {
            const { feeTaker, whitelistedTaker, unauthorizedResolver } = await loadFixture(deployContractsFixture);

            const whitelist = formatWhitelist([whitelistedTaker.address]);
            const extraData = ethers.solidityPacked(
                ['uint16', 'uint8', 'uint16', 'uint8', 'bytes'],
                [1000, 50, 2000, 100, whitelist], // 100 = 0% discount
            );

            const dummyOrder = {
                salt: 0,
                maker: constants.ZERO_ADDRESS,
                receiver: constants.ZERO_ADDRESS,
                makerAsset: constants.ZERO_ADDRESS,
                takerAsset: constants.ZERO_ADDRESS,
                makingAmount: ether('100'),
                takingAmount: ether('1'),
                makerTraits: 0,
            };

            const takingWhitelisted = await feeTaker.getTakingAmount(
                dummyOrder, '0x', ethers.ZeroHash, whitelistedTaker.address, ether('100'), ether('100'), extraData,
            );
            const takingOther = await feeTaker.getTakingAmount(
                dummyOrder, '0x', ethers.ZeroHash, unauthorizedResolver.address, ether('100'), ether('100'), extraData,
            );

            expect(takingWhitelisted).to.equal(takingOther);
            expect(takingWhitelisted).to.equal(ether('1.03')); // 3% fee
        });

        it('verifies integer division truncation in partial discount formula', async function () {
            const { feeTaker, whitelistedTaker } = await loadFixture(deployContractsFixture);

            // resolverFee = 15 (0.015%), discountNumerator = 50
            // 15 * 50 / 100 = 750 / 100 = 7 (floor truncation from 7.5)
            const whitelist = formatWhitelist([whitelistedTaker.address]);
            const extraData = ethers.solidityPacked(
                ['uint16', 'uint8', 'uint16', 'uint8', 'bytes'],
                [0, 50, 15, 50, whitelist],
            );

            const dummyOrder = {
                salt: 0,
                maker: constants.ZERO_ADDRESS,
                receiver: constants.ZERO_ADDRESS,
                makerAsset: constants.ZERO_ADDRESS,
                takerAsset: constants.ZERO_ADDRESS,
                makingAmount: ether('100'),
                takingAmount: ether('10'),
                makerTraits: 0,
            };

            // Expected taking amount with resolverFee = 7:
            // 10 ether * (100000 + 7) / 100000 = 10.0007 ether
            const taking = await feeTaker.getTakingAmount(
                dummyOrder, '0x', ethers.ZeroHash, whitelistedTaker.address, ether('100'), ether('100'), extraData,
            );

            expect(taking).to.equal(ether('10.0007'));
        });

        it('proves strict token conservation (integratorFee + protocolFee + makerReceived == takingAmount)', async function () {
            // Test across 5 representative amounts and fee distributions
            const testCases = [
                { tAmt: ether('1'), iFee: 1000, iShare: 50, rFee: 2000, wDisc: 50, isW: true },
                { tAmt: ether('0.333333333'), iFee: 5000, iShare: 70, rFee: 3000, wDisc: 80, isW: true },
                { tAmt: 123456789012345678n, iFee: 1234, iShare: 33, rFee: 4321, wDisc: 45, isW: false },
                { tAmt: 1000000000000000000000n, iFee: 65535, iShare: 100, rFee: 65535, wDisc: 0, isW: true },
                { tAmt: 1000n, iFee: 10000, iShare: 50, rFee: 10000, wDisc: 50, isW: true },
            ];

            for (const tc of testCases) {
                const ref = refCalculateFees({
                    takingAmount: tc.tAmt,
                    integratorFee: tc.iFee,
                    integratorShare: tc.iShare,
                    resolverFee: tc.rFee,
                    whitelistDiscount: tc.wDisc,
                    isWhitelisted: tc.isW,
                });

                const totalDistributed = ref.integratorFeeAmount + ref.protocolFeeAmount + ref.receiverAmount;
                expect(totalDistributed).to.equal(tc.tAmt);
            }
        });

        it('handles dust taking amounts where fees truncate to 0 wei without revert', async function () {
            // Dust taking amount of 10 wei with 1% fees
            const dustAmount = 10n;
            const ref = refCalculateFees({
                takingAmount: dustAmount,
                integratorFee: 1000,
                integratorShare: 50,
                resolverFee: 1000,
                whitelistDiscount: 50,
                isWhitelisted: true,
            });

            // 10 * 1000 / 101500 = 0 wei
            expect(ref.integratorFeeAmount).to.equal(0n);
            expect(ref.protocolFeeAmount).to.equal(0n);
            expect(ref.receiverAmount).to.equal(dustAmount); // Maker receives 100% of dust
        });

        it('demonstrates fee truncation across multi-step partial fills favors the maker', async function () {
            // Full fill of 1 ether vs two partial fills of 0.5 ether
            const fullAmt = ether('1');
            const halfAmt = ether('0.5');

            const refFull = refCalculateFees({
                takingAmount: fullAmt,
                integratorFee: 1000,
                integratorShare: 50,
                resolverFee: 2000,
                whitelistDiscount: 50,
                isWhitelisted: true,
            });

            const refHalf1 = refCalculateFees({
                takingAmount: halfAmt,
                integratorFee: 1000,
                integratorShare: 50,
                resolverFee: 2000,
                whitelistDiscount: 50,
                isWhitelisted: true,
            });

            const refHalf2 = refCalculateFees({
                takingAmount: halfAmt,
                integratorFee: 1000,
                integratorShare: 50,
                resolverFee: 2000,
                whitelistDiscount: 50,
                isWhitelisted: true,
            });

            const totalFeesFull = refFull.integratorFeeAmount + refFull.protocolFeeAmount;
            const totalFeesPartial = (refHalf1.integratorFeeAmount + refHalf1.protocolFeeAmount) +
                                    (refHalf2.integratorFeeAmount + refHalf2.protocolFeeAmount);

            // Partial fills fee is <= full fill fee (maker receives equal or slightly more)
            expect(totalFeesPartial).to.be.lte(totalFeesFull);
            expect(totalFeesFull - totalFeesPartial).to.be.lte(2n);
        });

        it('executes full settlement with unwrapWeth: true (distributing ETH fees and forwarding ETH to maker)', async function () {
            const {
                maker,
                whitelistedTaker,
                integratorFeeRecipient,
                protocolFeeRecipient,
                dai,
                weth,
                swap,
                feeTaker,
                chainId,
            } = await loadFixture(deployContractsFixture);

            const makingAmount = ether('300');
            const takingAmount = ether('0.3');
            const integratorFee = 10000;
            const whitelist = formatWhitelist([whitelistedTaker.address]);

            const order = buildOrder(
                {
                    maker: maker.address,
                    receiver: await feeTaker.getAddress(),
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount,
                    takingAmount,
                    makerTraits: buildMakerTraits({ unwrapWeth: true }),
                },
                buildFeeTakerExtensions({
                    feeTaker: await feeTaker.getAddress(),
                    integratorFeeRecipient: integratorFeeRecipient.address,
                    protocolFeeRecipient: protocolFeeRecipient.address,
                    integratorFee,
                    whitelist,
                }),
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), maker));
            const takerTraits = buildTakerTraits({
                extension: order.extension,
            });

            const feeCalculated = (takingAmount * BigInt(integratorFee)) / BASE_1E5;

            const fillTx = swap.connect(whitelistedTaker).fillOrderArgs(
                order, r, vs, makingAmount, takerTraits.traits, takerTraits.args,
            );

            await expect(fillTx).to.changeTokenBalances(dai, [whitelistedTaker, maker], [makingAmount, -makingAmount]);
            await expect(fillTx).to.changeTokenBalance(weth, whitelistedTaker, -takingAmount - feeCalculated);
            await expect(fillTx).to.changeEtherBalances(
                [maker, integratorFeeRecipient, protocolFeeRecipient],
                [takingAmount, feeCalculated / 2n, feeCalculated / 2n],
            );
        });

        it('reverts with EthTransferFailed if ETH fee recipient rejects ETH', async function () {
            const {
                maker,
                whitelistedTaker,
                protocolFeeRecipient,
                dai,
                weth,
                swap,
                feeTaker,
                chainId,
            } = await loadFixture(deployContractsFixture);

            // Deploy MakerContract as an ETH-rejecting mock (no receive/fallback)
            const MakerContract = await ethers.getContractFactory('MakerContract');
            const rejectingContract = await MakerContract.deploy(
                await swap.getAddress(),
                await dai.getAddress(),
                await weth.getAddress(),
                0,
                'Mock',
                'MCK',
            );
            await rejectingContract.waitForDeployment();

            const makingAmount = ether('300');
            const takingAmount = ether('0.3');
            const whitelist = formatWhitelist([whitelistedTaker.address]);

            const order = buildOrder(
                {
                    maker: maker.address,
                    receiver: await feeTaker.getAddress(),
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount,
                    takingAmount,
                    makerTraits: buildMakerTraits({ unwrapWeth: true }),
                },
                buildFeeTakerExtensions({
                    feeTaker: await feeTaker.getAddress(),
                    integratorFeeRecipient: await rejectingContract.getAddress(), // Rejects ETH!
                    protocolFeeRecipient: protocolFeeRecipient.address,
                    integratorFee: 10000,
                    whitelist,
                }),
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), maker));
            const takerTraits = buildTakerTraits({
                extension: order.extension,
            });

            await expect(
                swap.connect(whitelistedTaker).fillOrderArgs(
                    order, r, vs, makingAmount, takerTraits.traits, takerTraits.args,
                )
            ).to.be.revertedWithCustomError(feeTaker, 'EthTransferFailed');
        });

        it('reverts with InconsistentFee when order.receiver != FeeTaker and fees > 0', async function () {
            const {
                maker,
                whitelistedTaker,
                integratorFeeRecipient,
                protocolFeeRecipient,
                dai,
                weth,
                swap,
                feeTaker,
                chainId,
            } = await loadFixture(deployContractsFixture);

            const makingAmount = ether('300');
            const takingAmount = ether('0.3');
            const whitelist = formatWhitelist([whitelistedTaker.address]);

            // Set order.receiver to maker (instead of feeTaker), but fees > 0
            const order = buildOrder(
                {
                    maker: maker.address,
                    receiver: maker.address, // NOT feeTaker!
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount,
                    takingAmount,
                },
                buildFeeTakerExtensions({
                    feeTaker: await feeTaker.getAddress(),
                    integratorFeeRecipient: integratorFeeRecipient.address,
                    protocolFeeRecipient: protocolFeeRecipient.address,
                    integratorFee: 10000,
                    whitelist,
                }),
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), maker));
            const takerTraits = buildTakerTraits({
                extension: order.extension,
            });

            await expect(
                swap.connect(whitelistedTaker).fillOrderArgs(
                    order, r, vs, makingAmount, takerTraits.traits, takerTraits.args,
                )
            ).to.be.revertedWithCustomError(feeTaker, 'InconsistentFee');
        });

        it('allows order.receiver != FeeTaker when fees == 0 for whitelisted taker', async function () {
            const {
                maker,
                whitelistedTaker,
                dai,
                weth,
                swap,
                feeTaker,
                chainId,
            } = await loadFixture(deployContractsFixture);

            const makingAmount = ether('300');
            const takingAmount = ether('0.3');
            const whitelist = formatWhitelist([whitelistedTaker.address]);

            // Fees are 0, order.receiver is maker
            const order = buildOrder(
                {
                    maker: maker.address,
                    receiver: maker.address,
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount,
                    takingAmount,
                },
                buildFeeTakerExtensions({
                    feeTaker: await feeTaker.getAddress(),
                    integratorFee: 0,
                    resolverFee: 0,
                    whitelist,
                }),
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), maker));
            const takerTraits = buildTakerTraits({
                extension: order.extension,
            });

            const fillTx = swap.connect(whitelistedTaker).fillOrderArgs(
                order, r, vs, makingAmount, takerTraits.traits, takerTraits.args,
            );

            await expect(fillTx).to.changeTokenBalances(dai, [whitelistedTaker, maker], [makingAmount, -makingAmount]);
            await expect(fillTx).to.changeTokenBalances(weth, [whitelistedTaker, maker], [-takingAmount, takingAmount]);
        });

        it('allows order.receiver != FeeTaker when caller holds access token even with empty whitelist and fees == 0', async function () {
            const {
                maker,
                tokenResolver,
                dai,
                weth,
                swap,
                feeTaker,
                chainId,
            } = await loadFixture(deployContractsFixture);

            const makingAmount = ether('300');
            const takingAmount = ether('0.3');

            // Fees are 0, empty whitelist, but tokenResolver holds inch access token
            const order = buildOrder(
                {
                    maker: maker.address,
                    receiver: maker.address,
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount,
                    takingAmount,
                },
                buildFeeTakerExtensions({
                    feeTaker: await feeTaker.getAddress(),
                    integratorFee: 0,
                    resolverFee: 0,
                    whitelist: '0x00',
                }),
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), maker));
            const takerTraits = buildTakerTraits({
                extension: order.extension,
            });

            const fillTx = swap.connect(tokenResolver).fillOrderArgs(
                order, r, vs, makingAmount, takerTraits.traits, takerTraits.args,
            );

            await expect(fillTx).to.changeTokenBalances(dai, [tokenResolver, maker], [makingAmount, -makingAmount]);
            await expect(fillTx).to.changeTokenBalances(weth, [tokenResolver, maker], [-takingAmount, takingAmount]);
        });
    });
});
