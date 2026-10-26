const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('@1inch/solidity-utils');
const { ethers } = require('hardhat');
const { ether } = require('../../test/helpers/utils');
const { deploySwapTokens } = require('../../test/helpers/fixtures');
const { buildOrder, buildTakerTraits, signOrder } = require('../../test/helpers/orderUtils');

describe('ExtensionLib and OffsetsLib Boundary Analysis', function () {
    let addr, addr1, orderLibFactory, offsetsLibFactory;

    before(async function () {
        [addr, addr1] = await ethers.getSigners();
        orderLibFactory = await ethers.getContractFactory('OrderLib');
        offsetsLibFactory = await ethers.getContractFactory('OffsetsLib');
    });

    async function deployExtensionMockFixture() {
        const ExtensionMock = await ethers.getContractFactory('ExtensionMock');
        const extensionMock = await ExtensionMock.deploy();
        await extensionMock.waitForDeployment();
        return { extensionMock };
    }

    async function deployContractsFixture() {
        const { dai, weth, swap, chainId } = await deploySwapTokens();
        await dai.mint(addr, ether('1000'));
        await dai.mint(addr1, ether('1000'));
        await weth.deposit({ value: ether('10') });
        await weth.connect(addr1).deposit({ value: ether('10') });
        await dai.approve(swap, ether('1000'));
        await dai.connect(addr1).approve(swap, ether('1000'));
        await weth.approve(swap, ether('10'));
        await weth.connect(addr1).approve(swap, ether('10'));
        return { dai, weth, swap, chainId };
    }

    describe('ExtensionMock customData boundaries', function () {
        it('returns empty calldata when extension length < 0x20', async function () {
            const { extensionMock } = await loadFixture(deployExtensionMockFixture);
            expect(await extensionMock.getCustomData('0x')).to.equal('0x');
            expect(await extensionMock.getCustomData('0x12')).to.equal('0x');
            expect(await extensionMock.getCustomData('0x' + '00'.repeat(31))).to.equal('0x');
        });

        it('correctly parses customData starting at offset', async function () {
            const { extensionMock } = await loadFixture(deployExtensionMockFixture);
            // 8 uint32 offsets packed: o_0..o_7.
            // o_7 is top 32 bits (bits 224..255).
            // Let o_7 = 4 (0x00000004). Then customData starts at 0x20 + 4 = 36 bytes.
            const offsets = (4n << 224n).toString(16).padStart(64, '0');
            const concat = 'aabbccdd' + '11223344'; // 4 bytes intermediate + 4 bytes customData
            const extension = '0x' + offsets + concat;
            expect(await extensionMock.getCustomData(extension)).to.equal('0x11223344');
        });

        it('reverts if customData offset exceeds extension length', async function () {
            const { extensionMock } = await loadFixture(deployExtensionMockFixture);
            // o_7 = 100, but concat is only 4 bytes long (total extension 36 bytes < 0x20 + 100)
            const offsets = (100n << 224n).toString(16).padStart(64, '0');
            const concat = 'aabbccdd';
            const extension = '0x' + offsets + concat;
            await expect(extensionMock.getCustomData(extension)).to.be.reverted;
        });
    });

    describe('OrderMixin and OffsetsLib parser validation in LimitOrderProtocol', function () {
        it('reverts with MissingOrderExtension when HAS_EXTENSION is set but extension is empty', async function () {
            const { dai, weth, swap, chainId } = await loadFixture(deployContractsFixture);

            const order = buildOrder({
                maker: addr.address,
                makerAsset: await dai.getAddress(),
                takerAsset: await weth.getAddress(),
                makingAmount: ether('100'),
                takingAmount: ether('0.1'),
            });
            // Force HAS_EXTENSION_FLAG on makerTraits (bit 249)
            order.makerTraits = (BigInt(order.makerTraits) | (1n << 249n)).toString();
            order.extension = '0x';

            const signature = await signOrder(order, chainId, await swap.getAddress(), addr);
            const { r, yParityAndS: vs } = ethers.Signature.from(signature);
            const takerTraits = buildTakerTraits({ makingAmount: true });

            await expect(
                swap.fillOrderArgs(order, r, vs, ether('100'), takerTraits.traits, takerTraits.args)
            ).to.be.revertedWithCustomError(orderLibFactory, 'MissingOrderExtension');
        });

        it('reverts with UnexpectedOrderExtension when HAS_EXTENSION is not set but extension is provided', async function () {
            const { dai, weth, swap, chainId } = await loadFixture(deployContractsFixture);

            const order = buildOrder({
                maker: addr.address,
                makerAsset: await dai.getAddress(),
                takerAsset: await weth.getAddress(),
                makingAmount: ether('100'),
                takingAmount: ether('0.1'),
            });
            // Ensure HAS_EXTENSION_FLAG is NOT set
            order.makerTraits = (BigInt(order.makerTraits) & ~(1n << 249n)).toString();

            const signature = await signOrder(order, chainId, await swap.getAddress(), addr);
            const { r, yParityAndS: vs } = ethers.Signature.from(signature);
            // Provide unexpected extension via taker traits args
            const takerTraits = buildTakerTraits({
                makingAmount: true,
                extension: '0x' + '00'.repeat(32),
            });

            await expect(
                swap.fillOrderArgs(order, r, vs, ether('100'), takerTraits.traits, takerTraits.args)
            ).to.be.revertedWithCustomError(orderLibFactory, 'UnexpectedOrderExtension');
        });

        it('reverts with InvalidExtensionHash when extension does not match order salt commitment', async function () {
            const { dai, weth, swap, chainId } = await loadFixture(deployContractsFixture);

            const order = buildOrder(
                {
                    maker: addr.address,
                    makerAsset: await dai.getAddress(),
                    takerAsset: await weth.getAddress(),
                    makingAmount: ether('100'),
                    takingAmount: ether('0.1'),
                },
                {
                    customData: '0x1234',
                }
            );

            const signature = await signOrder(order, chainId, await swap.getAddress(), addr);
            const { r, yParityAndS: vs } = ethers.Signature.from(signature);
            // Taker tampers with extension
            const tamperedExtension = '0x' + '00'.repeat(32) + '5678';
            const takerTraits = buildTakerTraits({
                makingAmount: true,
                extension: tamperedExtension,
            });

            await expect(
                swap.fillOrderArgs(order, r, vs, ether('100'), takerTraits.traits, takerTraits.args)
            ).to.be.revertedWithCustomError(orderLibFactory, 'InvalidExtensionHash');
        });

        it('reverts with OffsetOutOfBounds when extension offset exceeds concat length', async function () {
            const { dai, weth, swap, chainId } = await loadFixture(deployContractsFixture);

            // Craft extension where o_4 (predicate offset) points way past concat length
            // Field 4 is predicate: bitShift = 4 * 32 = 128
            // Let end = 500, while concat length is only 10 bytes
            const o0 = 0n;
            const o1 = 0n;
            const o2 = 0n;
            const o3 = 0n;
            const o4 = 500n; // points out of bounds
            const offsets = (o4 << 128n) | (o3 << 96n) | (o2 << 64n) | (o1 << 32n) | o0;
            const concat = '00'.repeat(10);
            const rawExtension = '0x' + offsets.toString(16).padStart(64, '0') + concat;

            const salt = BigInt(ethers.keccak256(rawExtension)) & ((1n << 160n) - 1n);
            const order = buildOrder({
                maker: addr.address,
                makerAsset: await dai.getAddress(),
                takerAsset: await weth.getAddress(),
                makingAmount: ether('100'),
                takingAmount: ether('0.1'),
            });
            order.salt = salt.toString();
            order.makerTraits = (BigInt(order.makerTraits) | (1n << 249n)).toString(); // HAS_EXTENSION

            const signature = await signOrder(order, chainId, await swap.getAddress(), addr);
            const { r, yParityAndS: vs } = ethers.Signature.from(signature);
            const takerTraits = buildTakerTraits({
                makingAmount: true,
                skipMakerPermit: true,
                extension: rawExtension,
            });

            await expect(
                swap.fillOrderArgs(order, r, vs, ether('100'), takerTraits.traits, takerTraits.args)
            ).to.be.revertedWithCustomError(offsetsLibFactory, 'OffsetOutOfBounds');
        });

        it('safely reverts when offsets are non-monotonic during predicate processing (begin > end causing length underflow)', async function () {
            const { dai, weth, swap, chainId } = await loadFixture(deployContractsFixture);

            // Craft non-monotonic offsets: o_3 = 50, o_4 = 10, concat length = 60
            // For index 4 (predicate): begin = o_3 = 50, end = o_4 = 10
            // end <= concat.length (10 <= 60), but begin > end.
            const o0 = 0n;
            const o1 = 0n;
            const o2 = 0n;
            const o3 = 50n;
            const o4 = 10n;
            const offsets = (o4 << 128n) | (o3 << 96n) | (o2 << 64n) | (o1 << 32n) | o0;
            const concat = '00'.repeat(60);
            const rawExtension = '0x' + offsets.toString(16).padStart(64, '0') + concat;

            const salt = BigInt(ethers.keccak256(rawExtension)) & ((1n << 160n) - 1n);
            const order = buildOrder({
                maker: addr.address,
                makerAsset: await dai.getAddress(),
                takerAsset: await weth.getAddress(),
                makingAmount: ether('100'),
                takingAmount: ether('0.1'),
            });
            order.salt = salt.toString();
            order.makerTraits = (BigInt(order.makerTraits) | (1n << 249n)).toString(); // HAS_EXTENSION

            const signature = await signOrder(order, chainId, await swap.getAddress(), addr);
            const { r, yParityAndS: vs } = ethers.Signature.from(signature);
            const takerTraits = buildTakerTraits({
                makingAmount: true,
                skipMakerPermit: true,
                extension: rawExtension,
            });

            // The underflowed length causes an immediate revert during predicate processing
            await expect(
                swap.fillOrderArgs(order, r, vs, ether('100'), takerTraits.traits, takerTraits.args)
            ).to.be.reverted;
        });

        it('safely reverts when non-monotonic offsets are evaluated in makerPermit path', async function () {
            const { dai, weth, swap, chainId } = await loadFixture(deployContractsFixture);

            // Field 5 is makerPermit: bitShift = 5 * 32 = 160.
            // begin = o_4 = 40, end = o_5 = 10, concat length = 60.
            const o0 = 0n;
            const o1 = 0n;
            const o2 = 0n;
            const o3 = 0n;
            const o4 = 40n;
            const o5 = 10n;
            const offsets = (o5 << 160n) | (o4 << 128n) | (o3 << 96n) | (o2 << 64n) | (o1 << 32n) | o0;
            const concat = '00'.repeat(60);
            const rawExtension = '0x' + offsets.toString(16).padStart(64, '0') + concat;

            const salt = BigInt(ethers.keccak256(rawExtension)) & ((1n << 160n) - 1n);
            const order = buildOrder({
                maker: addr.address,
                makerAsset: await dai.getAddress(),
                takerAsset: await weth.getAddress(),
                makingAmount: ether('100'),
                takingAmount: ether('0.1'),
            });
            order.salt = salt.toString();
            order.makerTraits = (BigInt(order.makerTraits) | (1n << 249n)).toString(); // HAS_EXTENSION

            const signature = await signOrder(order, chainId, await swap.getAddress(), addr);
            const { r, yParityAndS: vs } = ethers.Signature.from(signature);
            // Default takerTraits has skipMakerPermit: false
            const takerTraits = buildTakerTraits({
                makingAmount: true,
                skipMakerPermit: false,
                extension: rawExtension,
            });

            await expect(
                swap.fillOrderArgs(order, r, vs, ether('100'), takerTraits.traits, takerTraits.args)
            ).to.be.reverted;
        });
    });
});
