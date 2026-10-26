const { expect } = require('@1inch/solidity-utils');
const { constants, permit2Contract } = require('@1inch/solidity-utils');
const { SignatureTransfer, PERMIT2_ADDRESS, permit2Address } = require('@uniswap/permit2-sdk');
const { ether } = require('../../test/helpers/utils');
const { signOrder, buildOrder, buildTakerTraits, buildMakerTraits, buildMakerTraitsRFQ } = require('../../test/helpers/orderUtils');
const { deploySwapTokens } = require('../../test/helpers/fixtures');
const { nextPermit2Nonce } = require('../../test/helpers/nonce');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const hre = require('hardhat');
const { ethers } = hre;

describe('H-07 Permit2 and Permit2WitnessProxy Signature and Nonce Security', function () {
    let addr, taker, attacker;
    let dai, weth, swap, chainId;
    let permit2Addr, permit2;
    let Permit2ProxyFactory, Permit2WitnessProxyFactory;
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const WITNESS_TYPEHASH = '0x098c829387d2da3edcf4fde88d652acd561e4ef68a7d2c7d5ff4d3aad8c92615';

    // Helper to query Permit2 nonceBitmap(address, uint256 wordPos)
    async function getPermit2NonceBit(owner, nonce) {
        const wordPos = BigInt(nonce) >> 8n;
        const bitPos = BigInt(nonce) & 0xffn;
        const bitmap = await permit2.nonceBitmap(owner, wordPos);
        return (bitmap & (1n << bitPos)) !== 0n;
    }

    before(async function () {
        [addr, taker, attacker] = await ethers.getSigners();
        chainId = (await ethers.provider.getNetwork()).chainId;
        permit2Addr = permit2Address(chainId);

        // Deploy canonical Permit2 code at permit2Addr
        await permit2Contract(chainId);
        permit2 = new ethers.Contract(
            permit2Addr,
            [
                'function nonceBitmap(address,uint256) view returns (uint256)',
                'error InvalidNonce()',
                'error InvalidSigner()',
                'error InvalidAmount(uint256 maxAmount)',
                'error SignatureExpired(uint256 deadline)',
            ],
            ethers.provider
        );

        Perm2ProxyFactory = await ethers.getContractFactory('Permit2Proxy');
        Permit2WitnessProxyFactory = await ethers.getContractFactory('Permit2WitnessProxy');
    });

    beforeEach(async function () {
        ({ dai, weth, swap } = await deploySwapTokens());

        // Fund accounts
        await dai.mint(taker, ether('10000'));
        await weth.connect(addr).deposit({ value: ether('10') });

        // Standard approvals: taker approves swap for DAI, maker approves Permit2 for WETH
        await dai.connect(taker).approve(swap, ether('10000'));
        await weth.connect(addr).approve(permit2Addr, ether('10'));
    });

    describe('1. Signature Construction, Witness Hashing & Settlement Lifecycle', function () {
        it('settles order through Permit2Proxy and marks nonce consumed in Permit2', async function () {
            const proxy = await Perm2ProxyFactory.deploy(await swap.getAddress(), permit2Addr);
            await proxy.waitForDeployment();

            const nonce = nextPermit2Nonce();
            expect(await getPermit2NonceBit(addr.address, nonce)).to.be.false;

            const permit = {
                permitted: { token: await weth.getAddress(), amount: ether('1') },
                spender: await proxy.getAddress(),
                nonce,
                deadline: 0xffffffff,
            };

            const data = SignatureTransfer.getPermitData(permit, permit2Addr, chainId);
            const sig = ethers.Signature.from(await addr.signTypedData(data.domain, data.types, data.values));

            const makerAssetSuffix = '0x' + proxy.interface.encodeFunctionData('func_nZHTch', [
                constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, 0,
                { permitted: permit.permitted, nonce: permit.nonce, deadline: permit.deadline },
                sig.compactSerialized,
            ]).substring(202);

            const order = buildOrder(
                {
                    maker: addr.address,
                    makerAsset: await proxy.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: ether('1'),
                    takingAmount: ether('2000'),
                    makerTraits: buildMakerTraitsRFQ(),
                },
                { makerAssetSuffix }
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));
            const takerTraits = buildTakerTraits({ makingAmount: true, extension: order.extension, threshold: order.takingAmount });

            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args)
            ).to.changeTokenBalances(weth, [addr, taker], [ether('-1'), ether('1')]);

            // Nonce is now burned in Permit2 storage
            expect(await getPermit2NonceBit(addr.address, nonce)).to.be.true;
        });

        it('settles order through Permit2WitnessProxy with EIP-712 witness binding', async function () {
            const witnessProxy = await Permit2WitnessProxyFactory.deploy(await swap.getAddress());
            await witnessProxy.waitForDeployment();

            const nonce = nextPermit2Nonce();
            const witness = {
                witness: { salt: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' },
                witnessTypeName: 'Witness',
                witnessType: { Witness: [{ name: 'salt', type: 'bytes32' }] },
            };

            const permit = {
                permitted: { token: await weth.getAddress(), amount: ether('1') },
                spender: await witnessProxy.getAddress(),
                nonce,
                deadline: 0xffffffff,
            };

            const data = SignatureTransfer.getPermitData(permit, permit2Addr, chainId, witness);
            const sig = ethers.Signature.from(await addr.signTypedData(data.domain, data.types, data.values));

            const witnessHash = ethers.keccak256(abiCoder.encode(['bytes32', 'bytes32'], [WITNESS_TYPEHASH, witness.witness.salt]));
            const makerAssetSuffix = '0x' + witnessProxy.interface.encodeFunctionData('func_801zDya', [
                constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, 0,
                { permitted: permit.permitted, nonce: permit.nonce, deadline: permit.deadline },
                witnessHash,
                sig.compactSerialized,
            ]).substring(202);

            const order = buildOrder(
                {
                    maker: addr.address,
                    makerAsset: await witnessProxy.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: ether('1'),
                    takingAmount: ether('2000'),
                    makerTraits: buildMakerTraitsRFQ(),
                },
                { makerAssetSuffix }
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));
            const takerTraits = buildTakerTraits({ makingAmount: true, extension: order.extension, threshold: order.takingAmount });

            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args)
            ).to.changeTokenBalances(weth, [addr, taker], [ether('-1'), ether('1')]);

            expect(await getPermit2NonceBit(addr.address, nonce)).to.be.true;
        });
    });

    describe('2. Cryptographic Domain Separation & Parameter Binding', function () {
        it('reverts when Permit2 signature is signed with mismatched chainId (cross-chain replay protection)', async function () {
            const proxy = await Perm2ProxyFactory.deploy(await swap.getAddress(), permit2Addr);
            await proxy.waitForDeployment();

            const nonce = nextPermit2Nonce();
            const permit = {
                permitted: { token: await weth.getAddress(), amount: ether('1') },
                spender: await proxy.getAddress(),
                nonce,
                deadline: 0xffffffff,
            };

            // Sign with chainId = 1 (mainnet) while local chain is 31337
            const data = SignatureTransfer.getPermitData(permit, permit2Addr, 1);
            const sig = ethers.Signature.from(await addr.signTypedData(data.domain, data.types, data.values));

            const makerAssetSuffix = '0x' + proxy.interface.encodeFunctionData('func_nZHTch', [
                constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, 0,
                { permitted: permit.permitted, nonce: permit.nonce, deadline: permit.deadline },
                sig.compactSerialized,
            ]).substring(202);

            const order = buildOrder(
                {
                    maker: addr.address,
                    makerAsset: await proxy.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: ether('1'),
                    takingAmount: ether('2000'),
                    makerTraits: buildMakerTraitsRFQ(),
                },
                { makerAssetSuffix }
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));
            const takerTraits = buildTakerTraits({ makingAmount: true, extension: order.extension, threshold: order.takingAmount });

            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args)
            ).to.be.revertedWithCustomError(swap, 'TransferFromMakerToTakerFailed');
        });

        it('reverts when Permit2 signature is signed for a different verifying contract address', async function () {
            const proxy = await Perm2ProxyFactory.deploy(await swap.getAddress(), permit2Addr);
            await proxy.waitForDeployment();

            const nonce = nextPermit2Nonce();
            const dummyPermit2 = '0x0000000000225e31D15943971F47aD3022F714Fa'; // zkSync Permit2 address
            const permit = {
                permitted: { token: await weth.getAddress(), amount: ether('1') },
                spender: await proxy.getAddress(),
                nonce,
                deadline: 0xffffffff,
            };

            // Sign for zkSync Permit2 address instead of canonical permit2Addr
            const data = SignatureTransfer.getPermitData(permit, dummyPermit2, chainId);
            const sig = ethers.Signature.from(await addr.signTypedData(data.domain, data.types, data.values));

            const makerAssetSuffix = '0x' + proxy.interface.encodeFunctionData('func_nZHTch', [
                constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, 0,
                { permitted: permit.permitted, nonce: permit.nonce, deadline: permit.deadline },
                sig.compactSerialized,
            ]).substring(202);

            const order = buildOrder(
                {
                    maker: addr.address,
                    makerAsset: await proxy.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: ether('1'),
                    takingAmount: ether('2000'),
                    makerTraits: buildMakerTraitsRFQ(),
                },
                { makerAssetSuffix }
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));
            const takerTraits = buildTakerTraits({ makingAmount: true, extension: order.extension, threshold: order.takingAmount });

            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args)
            ).to.be.revertedWithCustomError(swap, 'TransferFromMakerToTakerFailed');
        });

        it('reverts when Permit2 permit specifies a spender other than the proxy (spender binding)', async function () {
            const proxy = await Perm2ProxyFactory.deploy(await swap.getAddress(), permit2Addr);
            await proxy.waitForDeployment();

            const nonce = nextPermit2Nonce();
            const permit = {
                permitted: { token: await weth.getAddress(), amount: ether('1') },
                spender: attacker.address, // Signed for attacker, but proxy executes as msg.sender
                nonce,
                deadline: 0xffffffff,
            };

            const data = SignatureTransfer.getPermitData(permit, permit2Addr, chainId);
            const sig = ethers.Signature.from(await addr.signTypedData(data.domain, data.types, data.values));

            const makerAssetSuffix = '0x' + proxy.interface.encodeFunctionData('func_nZHTch', [
                constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, 0,
                { permitted: permit.permitted, nonce: permit.nonce, deadline: permit.deadline },
                sig.compactSerialized,
            ]).substring(202);

            const order = buildOrder(
                {
                    maker: addr.address,
                    makerAsset: await proxy.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: ether('1'),
                    takingAmount: ether('2000'),
                    makerTraits: buildMakerTraitsRFQ(),
                },
                { makerAssetSuffix }
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));
            const takerTraits = buildTakerTraits({ makingAmount: true, extension: order.extension, threshold: order.takingAmount });

            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args)
            ).to.be.revertedWithCustomError(swap, 'TransferFromMakerToTakerFailed');
        });

        it('reverts when Permit2 deadline has expired', async function () {
            const proxy = await Perm2ProxyFactory.deploy(await swap.getAddress(), permit2Addr);
            await proxy.waitForDeployment();

            const now = await time.latest();
            const nonce = nextPermit2Nonce();
            const permit = {
                permitted: { token: await weth.getAddress(), amount: ether('1') },
                spender: await proxy.getAddress(),
                nonce,
                deadline: now - 10, // Expired deadline
            };

            const data = SignatureTransfer.getPermitData(permit, permit2Addr, chainId);
            const sig = ethers.Signature.from(await addr.signTypedData(data.domain, data.types, data.values));

            const makerAssetSuffix = '0x' + proxy.interface.encodeFunctionData('func_nZHTch', [
                constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, 0,
                { permitted: permit.permitted, nonce: permit.nonce, deadline: permit.deadline },
                sig.compactSerialized,
            ]).substring(202);

            const order = buildOrder(
                {
                    maker: addr.address,
                    makerAsset: await proxy.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: ether('1'),
                    takingAmount: ether('2000'),
                    makerTraits: buildMakerTraitsRFQ(),
                },
                { makerAssetSuffix }
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));
            const takerTraits = buildTakerTraits({ makingAmount: true, extension: order.extension, threshold: order.takingAmount });

            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args)
            ).to.be.revertedWithCustomError(swap, 'TransferFromMakerToTakerFailed');
        });

        it('reverts when witness hash in Permit2WitnessProxy does not match signed witness', async function () {
            const witnessProxy = await Permit2WitnessProxyFactory.deploy(await swap.getAddress());
            await witnessProxy.waitForDeployment();

            const nonce = nextPermit2Nonce();
            const signedWitness = {
                witness: { salt: '0x1111111111111111111111111111111111111111111111111111111111111111' },
                witnessTypeName: 'Witness',
                witnessType: { Witness: [{ name: 'salt', type: 'bytes32' }] },
            };

            const permit = {
                permitted: { token: await weth.getAddress(), amount: ether('1') },
                spender: await witnessProxy.getAddress(),
                nonce,
                deadline: 0xffffffff,
            };

            const data = SignatureTransfer.getPermitData(permit, permit2Addr, chainId, signedWitness);
            const sig = ethers.Signature.from(await addr.signTypedData(data.domain, data.types, data.values));

            // Tamper with witness: pass a different salt into calldata
            const tamperedWitnessHash = ethers.keccak256(
                abiCoder.encode(['bytes32', 'bytes32'], [WITNESS_TYPEHASH, '0x2222222222222222222222222222222222222222222222222222222222222222'])
            );

            const makerAssetSuffix = '0x' + witnessProxy.interface.encodeFunctionData('func_801zDya', [
                constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, 0,
                { permitted: permit.permitted, nonce: permit.nonce, deadline: permit.deadline },
                tamperedWitnessHash,
                sig.compactSerialized,
            ]).substring(202);

            const order = buildOrder(
                {
                    maker: addr.address,
                    makerAsset: await witnessProxy.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: ether('1'),
                    takingAmount: ether('2000'),
                    makerTraits: buildMakerTraitsRFQ(),
                },
                { makerAssetSuffix }
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));
            const takerTraits = buildTakerTraits({ makingAmount: true, extension: order.extension, threshold: order.takingAmount });

            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args)
            ).to.be.revertedWithCustomError(swap, 'TransferFromMakerToTakerFailed');
        });
    });

    describe('3. Replay Protection & Cross-Order Permit Isolation', function () {
        it('reverts when attempting to replay an already executed order (bit invalidator)', async function () {
            const proxy = await Perm2ProxyFactory.deploy(await swap.getAddress(), permit2Addr);
            await proxy.waitForDeployment();

            const nonce = nextPermit2Nonce();
            const permit = {
                permitted: { token: await weth.getAddress(), amount: ether('1') },
                spender: await proxy.getAddress(),
                nonce,
                deadline: 0xffffffff,
            };

            const data = SignatureTransfer.getPermitData(permit, permit2Addr, chainId);
            const sig = ethers.Signature.from(await addr.signTypedData(data.domain, data.types, data.values));

            const makerAssetSuffix = '0x' + proxy.interface.encodeFunctionData('func_nZHTch', [
                constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, 0,
                { permitted: permit.permitted, nonce: permit.nonce, deadline: permit.deadline },
                sig.compactSerialized,
            ]).substring(202);

            const order = buildOrder(
                {
                    maker: addr.address,
                    makerAsset: await proxy.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: ether('1'),
                    takingAmount: ether('2000'),
                    makerTraits: buildMakerTraitsRFQ(),
                },
                { makerAssetSuffix }
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));
            const takerTraits = buildTakerTraits({ makingAmount: true, extension: order.extension, threshold: order.takingAmount });

            // First fill succeeds
            await swap.connect(taker).fillOrderArgs(order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args);

            // Second fill reverts in LOP bit invalidator
            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args)
            ).to.be.revertedWithCustomError(swap, 'BitInvalidatedOrder');
        });

        it('reverts when an attacker attempts to inject a victim Permit2 signature into an unauthorized order', async function () {
            const proxy = await Perm2ProxyFactory.deploy(await swap.getAddress(), permit2Addr);
            await proxy.waitForDeployment();

            const nonce = nextPermit2Nonce();
            const permit = {
                permitted: { token: await weth.getAddress(), amount: ether('1') },
                spender: await proxy.getAddress(),
                nonce,
                deadline: 0xffffffff,
            };

            const data = SignatureTransfer.getPermitData(permit, permit2Addr, chainId);
            const sig = ethers.Signature.from(await addr.signTypedData(data.domain, data.types, data.values));

            const makerAssetSuffix = '0x' + proxy.interface.encodeFunctionData('func_nZHTch', [
                constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, 0,
                { permitted: permit.permitted, nonce: permit.nonce, deadline: permit.deadline },
                sig.compactSerialized,
            ]).substring(202);

            // Attacker creates a malicious order: takerAsset = trash, takingAmount = 0
            const maliciousOrder = buildOrder(
                {
                    maker: addr.address,
                    makerAsset: await proxy.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: ether('1'),
                    takingAmount: 0n,
                    makerTraits: buildMakerTraitsRFQ(),
                },
                { makerAssetSuffix }
            );

            // Attacker cannot forge victim's signature on the malicious order
            const attackerSig = ethers.Signature.from(await attacker.signMessage('fake'));
            const takerTraits = buildTakerTraits({ makingAmount: true, extension: maliciousOrder.extension, threshold: 0n });

            await expect(
                swap.connect(attacker).fillOrderArgs(
                    maliciousOrder,
                    attackerSig.r,
                    attackerSig.yParityAndS,
                    maliciousOrder.makingAmount,
                    takerTraits.traits,
                    takerTraits.args
                )
            ).to.be.revertedWithCustomError(swap, 'BadSignature');
        });
    });

    describe('4. Single-Use Nonce & Multi-Transaction Partial Fills (OpenZeppelin L-02)', function () {
        it('demonstrates that multi-transaction partial fills revert on subsequent fills due to Permit2 single-use nonces', async function () {
            const proxy = await Perm2ProxyFactory.deploy(await swap.getAddress(), permit2Addr);
            await proxy.waitForDeployment();

            const nonce = nextPermit2Nonce();
            const permit = {
                permitted: { token: await weth.getAddress(), amount: ether('2') },
                spender: await proxy.getAddress(),
                nonce,
                deadline: 0xffffffff,
            };

            const data = SignatureTransfer.getPermitData(permit, permit2Addr, chainId);
            const sig = ethers.Signature.from(await addr.signTypedData(data.domain, data.types, data.values));

            const makerAssetSuffix = '0x' + proxy.interface.encodeFunctionData('func_nZHTch', [
                constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, 0,
                { permitted: permit.permitted, nonce: permit.nonce, deadline: permit.deadline },
                sig.compactSerialized,
            ]).substring(202);

            // Standard order with allowPartialFills = true (remaining invalidator)
            const order = buildOrder(
                {
                    maker: addr.address,
                    makerAsset: await proxy.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: ether('2'),
                    takingAmount: ether('4000'),
                    makerTraits: buildMakerTraits({ allowPartialFills: true, allowMultipleFills: true }),
                },
                { makerAssetSuffix }
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));

            // Fill 1: 50% partial fill (1 ETH)
            const takerTraits1 = buildTakerTraits({ makingAmount: true, extension: order.extension, threshold: ether('2000') });
            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, ether('1'), takerTraits1.traits, takerTraits1.args)
            ).to.changeTokenBalances(weth, [addr, taker], [ether('-1'), ether('1')]);

            // Nonce is now burned in Permit2!
            expect(await getPermit2NonceBit(addr.address, nonce)).to.be.true;

            // Fill 2: Attempting to fill the remaining 1 ETH in a subsequent transaction
            // Reverts because Permit2 rejects already-spent nonce with InvalidNonce()
            const takerTraits2 = buildTakerTraits({ makingAmount: true, extension: order.extension, threshold: ether('2000') });
            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, ether('1'), takerTraits2.traits, takerTraits2.args)
            ).to.be.revertedWithCustomError(swap, 'TransferFromMakerToTakerFailed');
        });
    });

    describe('5. Settlement Default & Transaction Atomicity (Rollback Invariant)', function () {
        it('rolls back Permit2 nonce consumption when taker payment defaults in Step 9', async function () {
            const proxy = await Perm2ProxyFactory.deploy(await swap.getAddress(), permit2Addr);
            await proxy.waitForDeployment();

            const nonce = nextPermit2Nonce();
            const permit = {
                permitted: { token: await weth.getAddress(), amount: ether('1') },
                spender: await proxy.getAddress(),
                nonce,
                deadline: 0xffffffff,
            };

            const data = SignatureTransfer.getPermitData(permit, permit2Addr, chainId);
            const sig = ethers.Signature.from(await addr.signTypedData(data.domain, data.types, data.values));

            const makerAssetSuffix = '0x' + proxy.interface.encodeFunctionData('func_nZHTch', [
                constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, 0,
                { permitted: permit.permitted, nonce: permit.nonce, deadline: permit.deadline },
                sig.compactSerialized,
            ]).substring(202);

            const order = buildOrder(
                {
                    maker: addr.address,
                    makerAsset: await proxy.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: ether('1'),
                    takingAmount: ether('2000'),
                    makerTraits: buildMakerTraitsRFQ(),
                },
                { makerAssetSuffix }
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));
            const takerTraits = buildTakerTraits({ makingAmount: true, extension: order.extension, threshold: order.takingAmount });

            // Reduce taker's DAI allowance so Step 9 (Taker => Maker) fails after Step 7 (Permit2 transfer)
            await dai.connect(taker).approve(swap, 0);

            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args)
            ).to.be.revertedWithCustomError(swap, 'TransferFromTakerToMakerFailed');

            // CRITICAL INVARIANT: Transaction rollback restored Permit2 storage!
            // Nonce was NOT burned!
            expect(await getPermit2NonceBit(addr.address, nonce)).to.be.false;

            // Restoring taker allowance allows the EXACT same order and Permit2 signature to settle successfully
            await dai.connect(taker).approve(swap, ether('10000'));
            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args)
            ).to.changeTokenBalances(weth, [addr, taker], [ether('-1'), ether('1')]);

            // Now nonce is consumed
            expect(await getPermit2NonceBit(addr.address, nonce)).to.be.true;
        });
    });

    describe('6. Authorization Bounds & Direct Proxy Access Control', function () {
        it('reverts when attempting to fill more making amount than authorized in Permit2 permit', async function () {
            const proxy = await Perm2ProxyFactory.deploy(await swap.getAddress(), permit2Addr);
            await proxy.waitForDeployment();

            const nonce = nextPermit2Nonce();
            // Permit authorizes ONLY 1 ETH
            const permit = {
                permitted: { token: await weth.getAddress(), amount: ether('1') },
                spender: await proxy.getAddress(),
                nonce,
                deadline: 0xffffffff,
            };

            const data = SignatureTransfer.getPermitData(permit, permit2Addr, chainId);
            const sig = ethers.Signature.from(await addr.signTypedData(data.domain, data.types, data.values));

            const makerAssetSuffix = '0x' + proxy.interface.encodeFunctionData('func_nZHTch', [
                constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, 0,
                { permitted: permit.permitted, nonce: permit.nonce, deadline: permit.deadline },
                sig.compactSerialized,
            ]).substring(202);

            // Order attempts to claim 2 ETH makingAmount
            const order = buildOrder(
                {
                    maker: addr.address,
                    makerAsset: await proxy.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: ether('2'),
                    takingAmount: ether('4000'),
                    makerTraits: buildMakerTraitsRFQ(),
                },
                { makerAssetSuffix }
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));
            const takerTraits = buildTakerTraits({ makingAmount: true, extension: order.extension, threshold: order.takingAmount });

            // Permit2 rejects requestedAmount (2 ETH) > permitted.amount (1 ETH) with InvalidAmount
            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args)
            ).to.be.revertedWithCustomError(swap, 'TransferFromMakerToTakerFailed');
        });

        it('reverts when unauthorized caller calls Permit2Proxy directly (onlyImmutableOwner)', async function () {
            const proxy = await Perm2ProxyFactory.deploy(await swap.getAddress(), permit2Addr);
            await proxy.waitForDeployment();

            const dummyPermit = {
                permitted: { token: await weth.getAddress(), amount: ether('1') },
                nonce: 0,
                deadline: 0xffffffff,
            };

            await expect(
                proxy.connect(attacker).func_nZHTch(addr.address, attacker.address, ether('1'), dummyPermit, '0x')
            ).to.be.revertedWithCustomError(proxy, 'IOAccessDenied');
        });

        it('reverts when unauthorized caller calls Permit2WitnessProxy directly (onlyImmutableOwner)', async function () {
            const witnessProxy = await Permit2WitnessProxyFactory.deploy(await swap.getAddress());
            await witnessProxy.waitForDeployment();

            const dummyPermit = {
                permitted: { token: await weth.getAddress(), amount: ether('1') },
                nonce: 0,
                deadline: 0xffffffff,
            };

            await expect(
                witnessProxy.connect(attacker).func_801zDya(addr.address, attacker.address, ether('1'), dummyPermit, ethers.ZeroHash, '0x')
            ).to.be.revertedWithCustomError(witnessProxy, 'IOAccessDenied');
        });

        it('reverts with InvalidPermit2Transfer when native usePermit2 trait has non-empty makerAssetSuffix', async function () {
            // Test OrderMixin.sol:362: if (order.makerTraits.usePermit2()) { if (extension.makerAssetSuffix().length > 0) revert InvalidPermit2Transfer(); }
            const order = buildOrder(
                {
                    maker: addr.address,
                    makerAsset: await weth.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: ether('1'),
                    takingAmount: ether('2000'),
                    makerTraits: buildMakerTraits({ usePermit2: true }),
                },
                {
                    makerAssetSuffix: '0x1234', // Non-empty suffix with usePermit2 is invalid
                }
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(await signOrder(order, chainId, await swap.getAddress(), addr));
            const takerTraits = buildTakerTraits({ makingAmount: true, extension: order.extension, threshold: order.takingAmount });

            await expect(
                swap.connect(taker).fillOrderArgs(order, r, vs, order.makingAmount, takerTraits.traits, takerTraits.args)
            ).to.be.revertedWithCustomError(swap, 'InvalidPermit2Transfer');
        });
    });
});
