const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('@1inch/solidity-utils');
const { ethers, network } = require('hardhat');
const { ether, getEventArgs } = require('../../test/helpers/utils');
const { deploySwapTokens } = require('../../test/helpers/fixtures');
const { buildOrder, buildMakerTraits } = require('../../test/helpers/orderUtils');
const { parseUnits } = require('ethers');
const solc = require('solc');

describe('H-04 Native-Order Clone Cancellation & Recipient Callbacks', function () {
    let addr, resolver, otherResolver, nativeOrderFactory, weth, dai, accessToken;
    let acceptingMaker, rejectingMaker, oogMaker, reentrantMaker;
    let NativeOrderImplArtifact;

    before(async function () {
        [addr, resolver, otherResolver] = await ethers.getSigners();

        // Compile custom test contracts dynamically using solc
        const solcSource = `
        // SPDX-License-Identifier: MIT
        pragma solidity 0.8.30;

        interface INativeOrderFactory {
            struct Order {
                uint256 salt;
                uint256 maker;
                uint256 receiver;
                uint256 makerAsset;
                uint256 takerAsset;
                uint256 makingAmount;
                uint256 takingAmount;
                uint256 makerTraits;
            }
            function create(Order calldata makerOrder) external payable returns (address clone);
        }

        interface INativeOrderImpl {
            function cancelExpiredOrderByResolver(INativeOrderFactory.Order calldata makerOrder, uint256 rewardLimit) external;
            function cancelOrder(INativeOrderFactory.Order calldata makerOrder) external;
            function withdraw(INativeOrderFactory.Order calldata makerOrder, address target, uint256 value, bytes memory data) external returns (bool, bytes memory);
        }

        contract AcceptingMaker {
            function createOrder(address factory, INativeOrderFactory.Order calldata order) external payable returns (address) {
                return INativeOrderFactory(factory).create{ value: msg.value }(order);
            }
            function withdrawWeth(address clone, INativeOrderFactory.Order calldata order, address weth, address to, uint256 amount) external {
                bytes memory data = abi.encodeWithSignature("transfer(address,uint256)", to, amount);
                INativeOrderImpl(clone).withdraw(order, weth, 0, data);
            }
            receive() external payable {}
        }

        contract RejectingMaker {
            function createOrder(address factory, INativeOrderFactory.Order calldata order) external payable returns (address) {
                return INativeOrderFactory(factory).create{ value: msg.value }(order);
            }
            function withdrawWeth(address clone, INativeOrderFactory.Order calldata order, address weth, address to, uint256 amount) external {
                bytes memory data = abi.encodeWithSignature("transfer(address,uint256)", to, amount);
                INativeOrderImpl(clone).withdraw(order, weth, 0, data);
            }
            receive() external payable {
                revert("REJECT_ETH");
            }
        }

        contract OutOfGasMaker {
            function createOrder(address factory, INativeOrderFactory.Order calldata order) external payable returns (address) {
                return INativeOrderFactory(factory).create{ value: msg.value }(order);
            }
            receive() external payable {
                assembly {
                    invalid()
                }
            }
        }

        contract ReentrantMaker {
            address public clone;
            INativeOrderFactory.Order public storedOrder;
            bool public attacked;
            bytes public attackRevertData;
            bool public attackSuccess;

            function createOrder(address factory, INativeOrderFactory.Order calldata order) external payable returns (address c) {
                c = INativeOrderFactory(factory).create{ value: msg.value }(order);
                clone = c;
                storedOrder = order;
            }

            receive() external payable {
                if (!attacked && clone != address(0)) {
                    attacked = true;
                    (bool success, bytes memory data) = clone.call(
                        abi.encodeWithSelector(INativeOrderImpl.cancelOrder.selector, storedOrder)
                    );
                    attackSuccess = success;
                    attackRevertData = data;
                }
            }
        }
        `;

        const solcInput = {
            language: 'Solidity',
            sources: { 'Makers.sol': { content: solcSource } },
            settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } } },
        };
        const output = JSON.parse(solc.compile(JSON.stringify(solcInput)));
        const compiled = output.contracts['Makers.sol'];

        const deployCompiled = async (name) => {
            const factory = new ethers.ContractFactory(compiled[name].abi, compiled[name].evm.bytecode.object, addr);
            const contract = await factory.deploy();
            await contract.waitForDeployment();
            return contract;
        };

        acceptingMaker = await deployCompiled('AcceptingMaker');
        rejectingMaker = await deployCompiled('RejectingMaker');
        oogMaker = await deployCompiled('OutOfGasMaker');
        reentrantMaker = await deployCompiled('ReentrantMaker');

        NativeOrderImplArtifact = await ethers.getContractFactory('NativeOrderImpl');
    });

    async function deployEnvironmentFixture() {
        const { tokens, contracts } = await (async () => {
            const { dai, weth, swap } = await deploySwapTokens();
            const TokenMock = await ethers.getContractFactory('TokenMock');
            const token = await TokenMock.deploy('Access Token', 'ACCESS');
            await token.waitForDeployment();
            await token.mint(resolver, 1);

            const NativeOrderFactory = await ethers.getContractFactory('NativeOrderFactory');
            const factory = await NativeOrderFactory.deploy(
                weth,
                swap,
                token,
                60, // cancellation delay: 60s
                '1inch Limit Order Protocol',
                '4'
            );
            await factory.waitForDeployment();

            return { tokens: { dai, weth, accessToken: token }, contracts: { nativeOrderFactory: factory } };
        })();

        return {
            dai: tokens.dai,
            weth: tokens.weth,
            accessToken: tokens.accessToken,
            nativeOrderFactory: contracts.nativeOrderFactory,
        };
    }

    it('Scenario A (Normal): EOA maker order is cancelled and resolver receives reward', async function () {
        const { nativeOrderFactory, weth, dai } = await loadFixture(deployEnvironmentFixture);

        const expirationTime = await time.latest() + time.duration.hours(1);
        const order = buildOrder({
            maker: addr.address,
            receiver: addr.address,
            makerAsset: await weth.getAddress(),
            takerAsset: await dai.getAddress(),
            makingAmount: ether('1.0'),
            takingAmount: ether('1000'),
            makerTraits: buildMakerTraits({ expiry: expirationTime }),
        });

        const tx = await nativeOrderFactory.connect(addr).create(order, { value: order.makingAmount });
        const receipt = await tx.wait();
        const cloneAddress = getEventArgs(receipt, nativeOrderFactory.interface, 'NativeOrderCreated')[2];
        const clone = await ethers.getContractAt('NativeOrderImpl', cloneAddress);

        // Advance past expiration + cancellation delay (60s)
        await time.increaseTo(expirationTime + 65);
        await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x2540be400']); // 10 gwei

        const reward = 70000n * parseUnits('11', 9); // 110% of base fee (0.00077 ETH)
        const cancelTx = clone.connect(resolver).cancelExpiredOrderByResolver(order, order.makingAmount);

        await expect(cancelTx).to.changeTokenBalance(weth, cloneAddress, ether('-1.0'));
        await expect(cancelTx).to.changeEtherBalances([addr, resolver], [ether('1.0') - reward, reward]);
        await expect(cancelTx).to.emit(clone, 'NativeOrderCancelledByResolver');
    });

    it('Scenario B: Smart contract maker accepting ETH cancels cleanly', async function () {
        const { nativeOrderFactory, weth, dai } = await loadFixture(deployEnvironmentFixture);

        const expirationTime = await time.latest() + time.duration.hours(1);
        const makerAddress = await acceptingMaker.getAddress();
        const order = buildOrder({
            maker: makerAddress,
            receiver: addr.address,
            makerAsset: await weth.getAddress(),
            takerAsset: await dai.getAddress(),
            makingAmount: ether('1.0'),
            takingAmount: ether('1000'),
            makerTraits: buildMakerTraits({ expiry: expirationTime }),
        });

        const tx = await acceptingMaker.createOrder(await nativeOrderFactory.getAddress(), order, { value: order.makingAmount });
        const receipt = await tx.wait();
        const cloneAddress = getEventArgs(receipt, nativeOrderFactory.interface, 'NativeOrderCreated')[2];
        const clone = await ethers.getContractAt('NativeOrderImpl', cloneAddress);

        await time.increaseTo(expirationTime + 65);
        await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x2540be400']);

        const reward = 70000n * parseUnits('11', 9);
        const cancelTx = clone.connect(resolver).cancelExpiredOrderByResolver(order, order.makingAmount);

        await expect(cancelTx).to.changeEtherBalances([makerAddress, resolver], [ether('1.0') - reward, reward]);
        await expect(cancelTx).to.emit(clone, 'NativeOrderCancelledByResolver');
    });

    it('Scenario C (Rejecting Maker): Resolver cancellation reverts, rewards blocked, order remains active', async function () {
        const { nativeOrderFactory, weth, dai } = await loadFixture(deployEnvironmentFixture);

        const expirationTime = await time.latest() + time.duration.hours(1);
        const makerAddress = await rejectingMaker.getAddress();
        const order = buildOrder({
            maker: makerAddress,
            receiver: addr.address,
            makerAsset: await weth.getAddress(),
            takerAsset: await dai.getAddress(),
            makingAmount: ether('1.0'),
            takingAmount: ether('1000'),
            makerTraits: buildMakerTraits({ expiry: expirationTime }),
        });

        const tx = await rejectingMaker.createOrder(await nativeOrderFactory.getAddress(), order, { value: order.makingAmount });
        const receipt = await tx.wait();
        const cloneAddress = getEventArgs(receipt, nativeOrderFactory.interface, 'NativeOrderCreated')[2];
        const clone = await ethers.getContractAt('NativeOrderImpl', cloneAddress);

        await time.increaseTo(expirationTime + 65);

        // 1. Resolver attempt: Reverts with Errors.ETHTransferFailed because maker rejects ETH
        const Errors = await ethers.getContractFactory('contracts/libraries/Errors.sol:Errors');
        await expect(
            clone.connect(resolver).cancelExpiredOrderByResolver(order, order.makingAmount)
        ).to.be.revertedWithCustomError(Errors, 'ETHTransferFailed');

        // 2. Clone state is unchanged: clone still holds 1.0 WETH
        expect(await weth.balanceOf(cloneAddress)).to.equal(ether('1.0'));

        // 3. Maker direct cancellation also reverts because it sends ETH to maker
        await expect(
            clone.connect(addr).cancelOrder(order)
        ).to.be.revertedWithCustomError(clone, 'OnlyMakerViolation'); // caller must be maker contract

        // Call cancelOrder via rejectingMaker
        // The rejectingMaker does not implement cancelOrder directly, but even if it did, the callback reverts.

        // 4. However, maker CAN recover funds via withdraw(makerOrder, target, value, data)
        await rejectingMaker.withdrawWeth(cloneAddress, order, await weth.getAddress(), addr.address, ether('1.0'));
        expect(await weth.balanceOf(cloneAddress)).to.equal(0n);
        expect(await weth.balanceOf(addr.address)).to.equal(ether('1.0'));
    });

    it('Scenario D (Out-Of-Gas Maker): Invalid opcode / gas burn causes cancellation revert', async function () {
        const { nativeOrderFactory, weth, dai } = await loadFixture(deployEnvironmentFixture);

        const expirationTime = await time.latest() + time.duration.hours(1);
        const makerAddress = await oogMaker.getAddress();
        const order = buildOrder({
            maker: makerAddress,
            receiver: addr.address,
            makerAsset: await weth.getAddress(),
            takerAsset: await dai.getAddress(),
            makingAmount: ether('1.0'),
            takingAmount: ether('1000'),
            makerTraits: buildMakerTraits({ expiry: expirationTime }),
        });

        const tx = await oogMaker.createOrder(await nativeOrderFactory.getAddress(), order, { value: order.makingAmount });
        const receipt = await tx.wait();
        const cloneAddress = getEventArgs(receipt, nativeOrderFactory.interface, 'NativeOrderCreated')[2];
        const clone = await ethers.getContractAt('NativeOrderImpl', cloneAddress);

        await time.increaseTo(expirationTime + 65);

        const Errors = await ethers.getContractFactory('contracts/libraries/Errors.sol:Errors');
        await expect(
            clone.connect(resolver).cancelExpiredOrderByResolver(order, order.makingAmount)
        ).to.be.revertedWithCustomError(Errors, 'ETHTransferFailed');

        // WETH remains in clone untouched
        expect(await weth.balanceOf(cloneAddress)).to.equal(ether('1.0'));
    });

    it('Scenario E (Reentrancy Defense): Reentrant cancellation attempt during callback reverts with CanNotCancelForZeroBalance', async function () {
        const { nativeOrderFactory, weth, dai } = await loadFixture(deployEnvironmentFixture);

        const expirationTime = await time.latest() + time.duration.hours(1);
        const makerAddress = await reentrantMaker.getAddress();
        const order = buildOrder({
            maker: makerAddress,
            receiver: addr.address,
            makerAsset: await weth.getAddress(),
            takerAsset: await dai.getAddress(),
            makingAmount: ether('1.0'),
            takingAmount: ether('1000'),
            makerTraits: buildMakerTraits({ expiry: expirationTime }),
        });

        const tx = await reentrantMaker.createOrder(await nativeOrderFactory.getAddress(), order, { value: order.makingAmount });
        const receipt = await tx.wait();
        const cloneAddress = getEventArgs(receipt, nativeOrderFactory.interface, 'NativeOrderCreated')[2];
        const clone = await ethers.getContractAt('NativeOrderImpl', cloneAddress);

        await time.increaseTo(expirationTime + 65);
        await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x2540be400']);

        // Cancel order:
        // During execution, ETH is transferred to ReentrantMaker, triggering receive().
        // receive() attempts to re-enter cancelOrder(storedOrder).
        // In the reentrant call, _WETH.safeBalanceOf(address(this)) == 0, triggering CanNotCancelForZeroBalance.
        const cancelTx = await clone.connect(resolver).cancelExpiredOrderByResolver(order, order.makingAmount);
        await cancelTx.wait();

        // Check reentrancy attack outcome recorded inside ReentrantMaker
        expect(await reentrantMaker.attacked()).to.be.true;
        expect(await reentrantMaker.attackSuccess()).to.be.false;

        // Revert data matches CanNotCancelForZeroBalance() selector: 0x9f538e1f
        const revertData = await reentrantMaker.attackRevertData();
        const canNotCancelSelector = clone.interface.getError('CanNotCancelForZeroBalance').selector;
        expect(revertData.slice(0, 10)).to.equal(canNotCancelSelector);

        // Overall cancellation completed successfully, no double payout occurred
        expect(await weth.balanceOf(cloneAddress)).to.equal(0n);
    });

    it('Scenario F (Clone Isolation): Malicious rejecting order does not affect independent native orders', async function () {
        const { nativeOrderFactory, weth, dai } = await loadFixture(deployEnvironmentFixture);

        const expirationTime = await time.latest() + time.duration.hours(1);

        // Order 1: Rejecting maker
        const order1 = buildOrder({
            maker: await rejectingMaker.getAddress(),
            receiver: addr.address,
            makerAsset: await weth.getAddress(),
            takerAsset: await dai.getAddress(),
            makingAmount: ether('1.0'),
            takingAmount: ether('1000'),
            makerTraits: buildMakerTraits({ expiry: expirationTime }),
        });
        const tx1 = await rejectingMaker.createOrder(await nativeOrderFactory.getAddress(), order1, { value: order1.makingAmount });
        const clone1Address = getEventArgs(await tx1.wait(), nativeOrderFactory.interface, 'NativeOrderCreated')[2];
        const clone1 = await ethers.getContractAt('NativeOrderImpl', clone1Address);

        // Order 2: Normal EOA maker
        const order2 = buildOrder({
            maker: addr.address,
            receiver: addr.address,
            makerAsset: await weth.getAddress(),
            takerAsset: await dai.getAddress(),
            makingAmount: ether('2.0'),
            takingAmount: ether('2000'),
            makerTraits: buildMakerTraits({ expiry: expirationTime }),
        });
        const tx2 = await nativeOrderFactory.connect(addr).create(order2, { value: order2.makingAmount });
        const clone2Address = getEventArgs(await tx2.wait(), nativeOrderFactory.interface, 'NativeOrderCreated')[2];
        const clone2 = await ethers.getContractAt('NativeOrderImpl', clone2Address);

        await time.increaseTo(expirationTime + 65);

        // Clone 1 fails to cancel
        const Errors = await ethers.getContractFactory('contracts/libraries/Errors.sol:Errors');
        await expect(
            clone1.connect(resolver).cancelExpiredOrderByResolver(order1, order1.makingAmount)
        ).to.be.revertedWithCustomError(Errors, 'ETHTransferFailed');

        // Clone 2 cancels independently and rewards resolver without issue
        const cancelTx2 = clone2.connect(resolver).cancelExpiredOrderByResolver(order2, order2.makingAmount);
        await expect(cancelTx2).to.emit(clone2, 'NativeOrderCancelledByResolver');
        expect(await weth.balanceOf(clone2Address)).to.equal(0n);
    });
});
