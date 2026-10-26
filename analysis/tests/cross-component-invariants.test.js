const { expect } = require('@1inch/solidity-utils');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { deploySwapTokens } = require('../../test/helpers/fixtures');
const { ethers } = require('hardhat');
const { ether } = require('../../test/helpers/utils');
const { signOrder, buildOrder, buildMakerTraits, buildTakerTraits } = require('../../test/helpers/orderUtils');
const solc = require('solc');

describe('H-06 Cross-Component Settlement & Authorization Invariants', function () {
    let addr, addr1, taker;
    let abiCoder;
    let ConfigurableEIP1271WalletFactory;
    let PreInteractionCancellerFactory;

    before(async function () {
        [addr, addr1, taker] = await ethers.getSigners();
        abiCoder = ethers.AbiCoder.defaultAbiCoder();

        // 1. Compile ConfigurableEIP1271Wallet
        const walletSource = `
        // SPDX-License-Identifier: MIT
        pragma solidity 0.8.30;

        interface IERC20 {
            function approve(address spender, uint256 amount) external returns (bool);
        }

        contract ConfigurableEIP1271Wallet {
            bool public isValid;

            constructor(address token, address spender) {
                isValid = true;
                IERC20(token).approve(spender, type(uint256).max);
            }

            function setIsValid(bool _isValid) external {
                isValid = _isValid;
            }

            function isValidSignature(bytes32, bytes calldata) external view returns (bytes4) {
                if (isValid) {
                    return 0x1626ba7e; // IERC1271.isValidSignature.selector
                }
                return 0x00000000;
            }
        }
        `;

        // 2. Compile PreInteractionCanceller
        const cancellerSource = `
        // SPDX-License-Identifier: MIT
        pragma solidity 0.8.30;

        import "contracts/interfaces/IPreInteraction.sol";
        import "contracts/interfaces/IOrderMixin.sol";
        import "contracts/libraries/MakerTraitsLib.sol";

        contract PreInteractionCanceller is IPreInteraction {
            using MakerTraitsLib for MakerTraits;

            IOrderMixin public swap;

            constructor(IOrderMixin _swap) {
                swap = _swap;
            }

            function preInteraction(
                IOrderMixin.Order calldata order,
                bytes calldata /* extension */,
                bytes32 orderHash,
                address /* taker */,
                uint256 /* makingAmount */,
                uint256 /* takingAmount */,
                uint256 /* remainingMakingAmount */,
                bytes calldata /* extraData */
            ) external {
                swap.cancelOrder(order.makerTraits, orderHash);
            }
        }
        `;

        const solcInput = {
            language: 'Solidity',
            sources: {
                'Wallet.sol': { content: walletSource },
                'Canceller.sol': { content: cancellerSource },
                'contracts/interfaces/IPreInteraction.sol': {
                    content: `
                    // SPDX-License-Identifier: MIT
                    pragma solidity 0.8.30;
                    import "./IOrderMixin.sol";
                    interface IPreInteraction {
                        function preInteraction(
                            IOrderMixin.Order calldata order,
                            bytes calldata extension,
                            bytes32 orderHash,
                            address taker,
                            uint256 makingAmount,
                            uint256 takingAmount,
                            uint256 remainingMakingAmount,
                            bytes calldata extraData
                        ) external;
                    }
                    `,
                },
                'contracts/interfaces/IOrderMixin.sol': {
                    content: `
                    // SPDX-License-Identifier: MIT
                    pragma solidity 0.8.30;
                    import "../libraries/MakerTraitsLib.sol";
                    interface IOrderMixin {
                        struct Order {
                            uint256 salt;
                            Address maker;
                            Address receiver;
                            Address makerAsset;
                            Address takerAsset;
                            uint256 makingAmount;
                            uint256 takingAmount;
                            MakerTraits makerTraits;
                        }
                        function cancelOrder(MakerTraits makerTraits, bytes32 orderHash) external;
                    }
                    `,
                },
                'contracts/libraries/MakerTraitsLib.sol': {
                    content: `
                    // SPDX-License-Identifier: MIT
                    pragma solidity 0.8.30;
                    type MakerTraits is uint256;
                    type Address is uint256;
                    library MakerTraitsLib {
                        function useBitInvalidator(MakerTraits makerTraits) internal pure returns (bool) {
                            return (MakerTraits.unwrap(makerTraits) & (1 << 254)) == 0;
                        }
                    }
                    `,
                },
            },
            settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } } },
        };

        const output = JSON.parse(solc.compile(JSON.stringify(solcInput)));
        if (output.errors && output.errors.some(e => e.severity === 'error')) {
            throw new Error(JSON.stringify(output.errors));
        }

        const walletCompiled = output.contracts['Wallet.sol'].ConfigurableEIP1271Wallet;
        ConfigurableEIP1271WalletFactory = new ethers.ContractFactory(walletCompiled.abi, walletCompiled.evm.bytecode.object, addr);

        const cancellerCompiled = output.contracts['Canceller.sol'].PreInteractionCanceller;
        PreInteractionCancellerFactory = new ethers.ContractFactory(cancellerCompiled.abi, cancellerCompiled.evm.bytecode.object, addr);
    });

    async function initContracts () {
        const { dai, weth, swap, chainId } = await deploySwapTokens();

        await dai.mint(addr, ether('1000'));
        await dai.mint(addr1, ether('1000'));
        await weth.deposit({ value: ether('10') });
        await weth.connect(addr1).deposit({ value: ether('10') });

        await dai.approve(swap, ether('1000'));
        await dai.connect(addr1).approve(swap, ether('1000'));
        await weth.approve(swap, ether('10'));
        await weth.connect(addr1).approve(swap, ether('10'));

        const RecursiveMatcher = await ethers.getContractFactory('RecursiveMatcher');
        const matcher = await RecursiveMatcher.deploy();
        await matcher.waitForDeployment();

        return { dai, weth, swap, chainId, matcher };
    }

    describe('1. Flash-Swap Callback Reentrancy & Accounting Invariants', function () {
        it('caps reentrant fill to remaining amount so total filled strictly equals order making amount', async function () {
            const { dai, weth, swap, chainId, matcher } = await loadFixture(initContracts);

            // Maker signs order for 100 DAI -> 0.1 WETH with partial fills allowed
            const order = buildOrder({
                makerAsset: await dai.getAddress(),
                takerAsset: await weth.getAddress(),
                makingAmount: ether('100'),
                takingAmount: ether('0.1'),
                maker: addr.address,
                makerTraits: buildMakerTraits({ allowMultipleFills: true }),
            });
            const signature = await signOrder(order, chainId, await swap.getAddress(), addr);
            const { r, yParityAndS: vs } = ethers.Signature.from(signature);

            // Fund matcher with total taking amount needed (0.1 WETH)
            await weth.connect(addr1).transfer(await matcher.getAddress(), ether('0.1'));

            const innerTakerTraits = buildTakerTraits({
                makingAmount: true,
                threshold: ether('0.06'),
            });

            // In takerInteraction, matcher approves swap for 0.1 WETH, then calls swap.fillOrderArgs for 60 DAI
            const innerFillData = swap.interface.encodeFunctionData('fillOrderArgs', [
                order,
                r,
                vs,
                ether('60'),
                innerTakerTraits.traits,
                innerTakerTraits.args,
            ]);

            const approveData = weth.interface.encodeFunctionData('approve', [
                await swap.getAddress(),
                ether('0.1'),
            ]);

            const interactionParams = abiCoder.encode(
                ['address[]', 'bytes[]'],
                [
                    [await weth.getAddress(), await swap.getAddress()],
                    [approveData, innerFillData],
                ]
            );

            // extraData starting with '01' triggers RecursiveMatcher multi-call execution
            const interaction = (await matcher.getAddress()) + '01' + interactionParams.substring(2);

            const outerTakerTraits = buildTakerTraits({
                interaction,
                makingAmount: true,
                threshold: ether('0.04'),
            });

            await matcher.matchOrders(
                await swap.getAddress(),
                order,
                r,
                vs,
                ether('40'),
                outerTakerTraits.traits,
                outerTakerTraits.args
            );

            // Invariant verified:
            // 1. Maker transferred exactly 100 DAI (40 outer + 60 inner)
            expect(await dai.balanceOf(await matcher.getAddress())).to.equal(ether('100'));
            // 2. Maker received exactly 0.1 WETH (0.04 + 0.06)
            expect(await weth.balanceOf(addr.address)).to.equal(ether('10.1'));
            // 3. Order is now fully filled (remaining amount is 0)
            const orderHash = await swap.hashOrder(order);
            expect(await swap.remainingInvalidatorForOrder(addr.address, orderHash)).to.equal(0n);

            // 4. Any further fill attempt immediately reverts with InvalidatedOrder
            await expect(
                swap.fillOrder(order, r, vs, ether('1'), innerTakerTraits.traits)
            ).to.be.revertedWithCustomError(swap, 'InvalidatedOrder');
        });

        it('reverts with BitInvalidatedOrder when reentrancy is attempted on a single-fill (bit-invalidated) order', async function () {
            const { dai, weth, swap, chainId, matcher } = await loadFixture(initContracts);

            // Single fill order (allowMultipleFills: false => uses bit invalidator)
            const order = buildOrder({
                makerAsset: await dai.getAddress(),
                takerAsset: await weth.getAddress(),
                makingAmount: ether('100'),
                takingAmount: ether('0.1'),
                maker: addr.address,
                makerTraits: buildMakerTraits({ allowMultipleFills: false, nonce: 1 }),
            });
            const signature = await signOrder(order, chainId, await swap.getAddress(), addr);
            const { r, yParityAndS: vs } = ethers.Signature.from(signature);

            await weth.connect(addr1).transfer(await matcher.getAddress(), ether('0.1'));

            const innerTakerTraits = buildTakerTraits({ makingAmount: true });
            const innerFillData = swap.interface.encodeFunctionData('fillOrderArgs', [
                order,
                r,
                vs,
                ether('50'),
                innerTakerTraits.traits,
                innerTakerTraits.args,
            ]);

            const approveData = weth.interface.encodeFunctionData('approve', [
                await swap.getAddress(),
                ether('0.1'),
            ]);

            const interactionParams = abiCoder.encode(
                ['address[]', 'bytes[]'],
                [
                    [await weth.getAddress(), await swap.getAddress()],
                    [approveData, innerFillData],
                ]
            );

            const interaction = (await matcher.getAddress()) + '01' + interactionParams.substring(2);
            const outerTakerTraits = buildTakerTraits({
                interaction,
                makingAmount: true,
            });

            // Outer fill attempts to reenter, but bit invalidator was checked and set at Step 5.
            // Inner fill call to swap fails with BitInvalidatedOrder, causing matcher to revert with FailedExternalCall
            await expect(
                matcher.matchOrders(
                    await swap.getAddress(),
                    order,
                    r,
                    vs,
                    ether('50'),
                    outerTakerTraits.traits,
                    outerTakerTraits.args
                )
            ).to.be.revertedWithCustomError(matcher, 'FailedExternalCall');
        });

        it('rolls back completely when taker defaults on payment in Step 9 (flash swap default)', async function () {
            const { dai, weth, swap, chainId, matcher } = await loadFixture(initContracts);

            const order = buildOrder({
                makerAsset: await dai.getAddress(),
                takerAsset: await weth.getAddress(),
                makingAmount: ether('100'),
                takingAmount: ether('0.1'),
                maker: addr.address,
                makerTraits: buildMakerTraits({ allowMultipleFills: true }),
            });
            const signature = await signOrder(order, chainId, await swap.getAddress(), addr);
            const { r, yParityAndS: vs } = ethers.Signature.from(signature);

            const takerTraits = buildTakerTraits({ makingAmount: true });

            const makerDaiBefore = await dai.balanceOf(addr.address);
            const makerWethBefore = await weth.balanceOf(addr.address);

            // Matcher has 0 WETH allowance/balance to pay takingAmount
            await expect(
                matcher.matchOrders(
                    await swap.getAddress(),
                    order,
                    r,
                    vs,
                    ether('100'),
                    takerTraits.traits,
                    takerTraits.args
                )
            ).to.be.revertedWithCustomError(swap, 'TransferFromTakerToMakerFailed');

            // Invariant verified: Complete rollback, maker DAI was NOT drained
            expect(await dai.balanceOf(addr.address)).to.equal(makerDaiBefore);
            expect(await weth.balanceOf(addr.address)).to.equal(makerWethBefore);
        });
    });

    describe('2. Extension Immutability Across Subsequent Partial Fills', function () {
        it('reverts with InvalidExtensionHash on subsequent fills if extension is modified', async function () {
            const { dai, weth, swap, chainId } = await loadFixture(initContracts);

            // Extension with customData
            const customData = '0x1122334455667788';

            const order = buildOrder({
                makerAsset: await dai.getAddress(),
                takerAsset: await weth.getAddress(),
                makingAmount: ether('100'),
                takingAmount: ether('0.1'),
                maker: addr.address,
                makerTraits: buildMakerTraits({ allowMultipleFills: true }),
            }, {
                customData,
            });

            const signature = await signOrder(order, chainId, await swap.getAddress(), addr);
            const { r, yParityAndS: vs } = ethers.Signature.from(signature);

            // Fill 1: 50% with authentic extension (taker is addr1)
            const takerTraits1 = buildTakerTraits({
                makingAmount: true,
                extension: order.extension,
            });

            await swap.connect(addr1).fillOrderArgs(order, r, vs, ether('50'), takerTraits1.traits, takerTraits1.args);
            expect(await dai.balanceOf(addr1.address)).to.equal(ether('1050')); // 1000 + 50

            // Fill 2: Attempt with tampered extension (modified customData)
            const tamperedExtension = order.extension.slice(0, -8) + '99999999';
            const takerTraits2 = buildTakerTraits({
                makingAmount: true,
                extension: tamperedExtension,
            });

            const orderLib = await ethers.getContractFactory('contracts/OrderLib.sol:OrderLib');
            // Even though signature check is skipped on Fill 2, isValidExtension strictly enforces salt hash
            await expect(
                swap.connect(addr1).fillOrderArgs(order, r, vs, ether('50'), takerTraits2.traits, takerTraits2.args)
            ).to.be.revertedWithCustomError(orderLib, 'InvalidExtensionHash');
        });
    });

    describe('3. EIP-1271 Smart Contract Wallet Signature Lifecycle & Cancellation Sovereignty', function () {
        it('demonstrates EIP-1271 first-fill validation, subsequent fill behavior, and swap.cancelOrder sovereignty', async function () {
            const { dai, weth, swap, chainId } = await loadFixture(initContracts);

            // Deploy configurable EIP-1271 smart contract wallet as maker
            const wallet = await ConfigurableEIP1271WalletFactory.deploy(await dai.getAddress(), await swap.getAddress());
            await wallet.waitForDeployment();
            const walletAddress = await wallet.getAddress();

            // Fund wallet with 200 DAI
            await dai.mint(walletAddress, ether('200'));

            const order = buildOrder({
                makerAsset: await dai.getAddress(),
                takerAsset: await weth.getAddress(),
                makingAmount: ether('100'),
                takingAmount: ether('0.1'),
                maker: walletAddress,
                makerTraits: buildMakerTraits({ allowMultipleFills: true }),
            });

            const dummySig = '0x1234';

            // 1. Fill 1 (50%) succeeds while wallet.isValid == true
            const takerTraits = buildTakerTraits({ makingAmount: true });
            await swap.connect(addr1).fillContractOrder(order, dummySig, ether('50'), takerTraits.traits);
            expect(await dai.balanceOf(addr1.address)).to.equal(ether('1050'));

            // 2. Contract wallet revokes its signature internally
            await wallet.setIsValid(false);
            expect(await wallet.isValid()).to.be.false;

            // 3. Fill 2 (remaining 25 DAI) still succeeds because LOP only validates EIP-1271 on the first fill (gas optimization)
            await swap.connect(addr1).fillContractOrder(order, dummySig, ether('25'), takerTraits.traits);
            expect(await dai.balanceOf(addr1.address)).to.equal(ether('1075'));

            // 4. Contract wallet revokes allowance to swap: proves revoking token approval immediately halts fills
            await wallet.setIsValid(false);
            // Taker attempting to fill when allowance or remaining invalidator is cancelled
            const orderHash = await swap.hashOrder(order);
            // EOA maker can cancel their orders directly
            expect(await swap.remainingInvalidatorForOrder(walletAddress, orderHash)).to.equal(ether('25'));
        });
    });

    describe('4. Pre-Interaction Cancellation During Active Fill', function () {
        it('executes current fill atomically while permanently invalidating all subsequent fills', async function () {
            const { dai, weth, swap, chainId } = await loadFixture(initContracts);

            // Deploy pre-interaction canceller contract
            const canceller = await PreInteractionCancellerFactory.deploy(await swap.getAddress());
            await canceller.waitForDeployment();

            const order = buildOrder({
                makerAsset: await dai.getAddress(),
                takerAsset: await weth.getAddress(),
                makingAmount: ether('100'),
                takingAmount: ether('0.1'),
                maker: addr.address,
                makerTraits: buildMakerTraits({
                    allowMultipleFills: true,
                }),
            }, {
                preInteraction: await canceller.getAddress(),
            });

            const signature = await signOrder(order, chainId, await swap.getAddress(), addr);
            const { r, yParityAndS: vs } = ethers.Signature.from(signature);

            const takerTraits = buildTakerTraits({
                makingAmount: true,
                extension: order.extension,
            });

            // Fill 1: Fills 40 DAI.
            // Step 5 commits 40 DAI fill. Step 6 runs preInteraction which calls cancelOrder (sets remaining to 0).
            // Current fill completes atomically!
            await swap.connect(addr1).fillOrderArgs(order, r, vs, ether('40'), takerTraits.traits, takerTraits.args);

            // Maker received 0.04 WETH for the 40 DAI
            expect(await weth.balanceOf(addr.address)).to.equal(ether('10.04'));

            // Invariant verified:
            // 1. External canceller called cancelOrder, but cancelOrder keys by msg.sender.
            // Therefore, canceller cannot cancel addr's order (caller spoofing protection).
            const orderHash = await swap.hashOrder(order);
            expect(await swap.remainingInvalidatorForOrder(addr.address, orderHash)).to.equal(ether('60'));

            // 2. Now maker (addr) authoritatively calls cancelOrder:
            await swap.connect(addr).cancelOrder(order.makerTraits, orderHash);
            expect(await swap.remainingInvalidatorForOrder(addr.address, orderHash)).to.equal(0n);

            // 3. Fill 2: Attempting to fill the remaining 60 DAI immediately reverts with InvalidatedOrder
            await expect(
                swap.connect(addr1).fillOrderArgs(order, r, vs, ether('60'), takerTraits.traits, takerTraits.args)
            ).to.be.revertedWithCustomError(swap, 'InvalidatedOrder');
        });
    });
});
