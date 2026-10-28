const { expect, constants } = require('@1inch/solidity-utils');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { deploySwapTokens } = require('../../test/helpers/fixtures');
const { ethers } = require('hardhat');
const { signOrder, buildOrder, buildMakerTraits, buildTakerTraits } = require('../../test/helpers/orderUtils');
const solc = require('solc');

describe('H-09 Asset-Proxy Callbacks, Reentrancy & Settlement Boundaries', function () {
    let addr, addr1, attackerSigner;
    let MockERC1155Factory;
    let MockERC721Factory;
    let MaliciousTakerReceiverFactory;

    before(async function () {
        [addr, addr1, attackerSigner] = await ethers.getSigners();

        const tokenSource = `
        // SPDX-License-Identifier: MIT
        pragma solidity 0.8.30;

        interface IERC1155Receiver {
            function onERC1155Received(address operator, address from, uint256 id, uint256 value, bytes calldata data) external returns (bytes4);
        }

        interface IERC721Receiver {
            function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4);
        }

        interface IERC20 {
            function approve(address spender, uint256 amount) external returns (bool);
            function transfer(address to, uint256 amount) external returns (bool);
            function transferFrom(address from, address to, uint256 amount) external returns (bool);
            function balanceOf(address account) external view returns (uint256);
        }

        contract MockERC1155 {
            mapping(uint256 => mapping(address => uint256)) public balanceOf;
            mapping(address => mapping(address => bool)) public isApprovedForAll;

            event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);
            event ApprovalForAll(address indexed account, address indexed operator, bool approved);

            function setApprovalForAll(address operator, bool approved) external {
                isApprovedForAll[msg.sender][operator] = approved;
                emit ApprovalForAll(msg.sender, operator, approved);
            }

            function mint(address to, uint256 id, uint256 amount) external {
                balanceOf[id][to] += amount;
                emit TransferSingle(msg.sender, address(0), to, id, amount);
            }

            function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external {
                require(msg.sender == from || isApprovedForAll[from][msg.sender], "ERC1155: caller is not token owner or approved");
                require(balanceOf[id][from] >= amount, "ERC1155: insufficient balance");

                balanceOf[id][from] -= amount;
                balanceOf[id][to] += amount;

                emit TransferSingle(msg.sender, from, to, id, amount);

                if (to.code.length > 0) {
                    bytes4 retval = IERC1155Receiver(to).onERC1155Received(msg.sender, from, id, amount, data);
                    require(retval == 0xf23a6e61, "ERC1155: transfer rejected");
                }
            }
        }

        contract MockERC721 {
            mapping(uint256 => address) public ownerOf;
            mapping(address => mapping(address => bool)) public isApprovedForAll;
            mapping(uint256 => address) public getApproved;

            event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
            event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

            function setApprovalForAll(address operator, bool approved) external {
                isApprovedForAll[msg.sender][operator] = approved;
                emit ApprovalForAll(msg.sender, operator, approved);
            }

            function mint(address to, uint256 tokenId) external {
                require(ownerOf[tokenId] == address(0), "ERC721: token already minted");
                ownerOf[tokenId] = to;
                emit Transfer(address(0), to, tokenId);
            }

            function transferFrom(address from, address to, uint256 tokenId) public {
                require(ownerOf[tokenId] == from, "ERC721: incorrect owner");
                require(msg.sender == from || isApprovedForAll[from][msg.sender] || getApproved[tokenId] == msg.sender, "ERC721: not approved");
                ownerOf[tokenId] = to;
                emit Transfer(from, to, tokenId);
            }

            function safeTransferFrom(address from, address to, uint256 tokenId) external {
                transferFrom(from, to, tokenId);
                if (to.code.length > 0) {
                    bytes4 retval = IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, "");
                    require(retval == 0x150b7a02, "ERC721: transfer rejected");
                }
            }
        }

        contract MaliciousTakerReceiver {
            uint8 public constant MODE_NORMAL = 0;
            uint8 public constant MODE_REVERT = 1;
            uint8 public constant MODE_BAD_SELECTOR = 2;
            uint8 public constant MODE_REENTER = 3;

            uint8 public mode;
            address public swap;
            bytes public reentrantCalldata;
            bool public reentrancyAttempted;
            bool public reentrancySucceeded;
            bytes public reentrancyReturnData;
            uint256 public callbackCount;

            error CallbackRevertError();

            constructor(address _swap) {
                swap = _swap;
            }

            function setMode(uint8 _mode) external {
                mode = _mode;
            }

            function setReentrantCalldata(bytes calldata _data) external {
                reentrantCalldata = _data;
            }

            function approveToken(address token, address spender, uint256 amount) external {
                IERC20(token).approve(spender, amount);
            }

            function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
                callbackCount++;
                if (mode == MODE_REVERT) {
                    revert CallbackRevertError();
                }
                if (mode == MODE_BAD_SELECTOR) {
                    return 0x12345678;
                }
                if (mode == MODE_REENTER) {
                    mode = MODE_NORMAL; // prevent nested reentrancy
                    reentrancyAttempted = true;
                    (bool success, bytes memory ret) = swap.call(reentrantCalldata);
                    reentrancySucceeded = success;
                    reentrancyReturnData = ret;
                }
                return 0xf23a6e61;
            }

            function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
                callbackCount++;
                if (mode == MODE_REVERT) {
                    revert CallbackRevertError();
                }
                if (mode == MODE_BAD_SELECTOR) {
                    return 0x12345678;
                }
                if (mode == MODE_REENTER) {
                    mode = MODE_NORMAL; // prevent nested reentrancy
                    reentrancyAttempted = true;
                    (bool success, bytes memory ret) = swap.call(reentrantCalldata);
                    reentrancySucceeded = success;
                    reentrancyReturnData = ret;
                }
                return 0x150b7a02;
            }
        }
        `;

        const solcInput = {
            language: 'Solidity',
            sources: { 'Tokens.sol': { content: tokenSource } },
            settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } } },
        };

        const compiled = JSON.parse(solc.compile(JSON.stringify(solcInput)));
        if (compiled.errors && compiled.errors.some(e => e.severity === 'error')) {
            throw new Error(JSON.stringify(compiled.errors));
        }

        const tokensArtifact = compiled.contracts['Tokens.sol'];
        MockERC1155Factory = new ethers.ContractFactory(
            tokensArtifact.MockERC1155.abi,
            tokensArtifact.MockERC1155.evm.bytecode.object,
            addr,
        );
        MockERC721Factory = new ethers.ContractFactory(
            tokensArtifact.MockERC721.abi,
            tokensArtifact.MockERC721.evm.bytecode.object,
            addr,
        );
        MaliciousTakerReceiverFactory = new ethers.ContractFactory(
            tokensArtifact.MaliciousTakerReceiver.abi,
            tokensArtifact.MaliciousTakerReceiver.evm.bytecode.object,
            addr,
        );
    });

    async function deployEnvironment() {
        const { dai, weth, swap, chainId } = await loadFixture(deploySwapTokens);

        const ERC1155Proxy = await ethers.getContractFactory('ERC1155Proxy');
        const erc1155Proxy = await ERC1155Proxy.deploy(await swap.getAddress());
        await erc1155Proxy.waitForDeployment();

        const ERC721Proxy = await ethers.getContractFactory('ERC721Proxy');
        const erc721Proxy = await ERC721Proxy.deploy(await swap.getAddress());
        await erc721Proxy.waitForDeployment();

        const ERC721ProxySafe = await ethers.getContractFactory('ERC721ProxySafe');
        const erc721ProxySafe = await ERC721ProxySafe.deploy(await swap.getAddress());
        await erc721ProxySafe.waitForDeployment();

        const mock1155 = await MockERC1155Factory.deploy();
        await mock1155.waitForDeployment();

        const mock721 = await MockERC721Factory.deploy();
        await mock721.waitForDeployment();

        const maliciousReceiver = await MaliciousTakerReceiverFactory.deploy(await swap.getAddress());
        await maliciousReceiver.waitForDeployment();

        // Mint DAI to taker
        await dai.mint(addr.address, 10000n);
        await dai.approve(await swap.getAddress(), 10000n);

        // Mint DAI to maliciousReceiver and approve swap
        await dai.mint(await maliciousReceiver.getAddress(), 10000n);
        await maliciousReceiver.approveToken(await dai.getAddress(), await swap.getAddress(), 10000n);

        return {
            dai,
            weth,
            swap,
            chainId,
            erc1155Proxy,
            erc721Proxy,
            erc721ProxySafe,
            mock1155,
            mock721,
            maliciousReceiver,
        };
    }

    describe('1. ERC1155Proxy Normal Lifecycle & Settlement', function () {
        it('successfully executes a full fill of an ERC1155 token order', async function () {
            const { dai, swap, chainId, erc1155Proxy, mock1155 } = await loadFixture(deployEnvironment);

            const tokenId = 42n;
            const tokenAmount = 20n;
            const priceDai = 100n;

            // Mint ERC1155 to maker (addr1) and approve proxy
            await mock1155.mint(addr1.address, tokenId, tokenAmount);
            await mock1155.connect(addr1).setApprovalForAll(await erc1155Proxy.getAddress(), true);

            const encodedCall = erc1155Proxy.interface.encodeFunctionData('func_301JL5R', [
                addr1.address,
                constants.ZERO_ADDRESS,
                0,
                await mock1155.getAddress(),
                tokenId,
                '0x',
            ]);
            const suffix = '0x' + encodedCall.substring(202);

            const order = buildOrder(
                {
                    makerAsset: await erc1155Proxy.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: tokenAmount,
                    takingAmount: priceDai,
                    maker: addr1.address,
                },
                {
                    makerAssetSuffix: suffix,
                },
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(
                await signOrder(order, chainId, await swap.getAddress(), addr1),
            );

            const takerTraits = buildTakerTraits({
                threshold: priceDai,
                makingAmount: true,
                extension: order.extension,
            });

            const fillTx = swap.fillOrderArgs(order, r, vs, tokenAmount, takerTraits.traits, takerTraits.args);

            await expect(fillTx).to.changeTokenBalances(dai, [addr, addr1], [-priceDai, priceDai]);
            expect(await mock1155.balanceOf(tokenId, addr.address)).to.equal(tokenAmount);
            expect(await mock1155.balanceOf(tokenId, addr1.address)).to.equal(0n);
        });
    });

    describe('2. Reentrancy Protection via onERC1155Received Hook', function () {
        it('reverts reentrant fill attempt with BitInvalidatedOrder on single-fill orders', async function () {
            const { dai, swap, chainId, erc1155Proxy, mock1155, maliciousReceiver } = await loadFixture(deployEnvironment);

            const tokenId = 101n;
            const tokenAmount = 10n;
            const priceDai = 50n;

            await mock1155.mint(addr1.address, tokenId, tokenAmount);
            await mock1155.connect(addr1).setApprovalForAll(await erc1155Proxy.getAddress(), true);

            const encodedCall = erc1155Proxy.interface.encodeFunctionData('func_301JL5R', [
                addr1.address,
                constants.ZERO_ADDRESS,
                0,
                await mock1155.getAddress(),
                tokenId,
                '0x',
            ]);
            const suffix = '0x' + encodedCall.substring(202);

            // Single fill order (allowMultipleFills: false)
            const order = buildOrder(
                {
                    makerAsset: await erc1155Proxy.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: tokenAmount,
                    takingAmount: priceDai,
                    maker: addr1.address,
                    makerTraits: buildMakerTraits({ allowMultipleFills: false }),
                },
                {
                    makerAssetSuffix: suffix,
                },
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(
                await signOrder(order, chainId, await swap.getAddress(), addr1),
            );

            const takerTraits = buildTakerTraits({
                threshold: priceDai,
                makingAmount: true,
                extension: order.extension,
                target: await maliciousReceiver.getAddress(),
            });

            // Prepare reentrant calldata for maliciousReceiver to attempt another fill of the exact same order
            const reentrantFillCalldata = swap.interface.encodeFunctionData('fillOrderArgs', [
                order,
                r,
                vs,
                tokenAmount,
                takerTraits.traits,
                takerTraits.args,
            ]);

            await maliciousReceiver.setReentrantCalldata(reentrantFillCalldata);
            await maliciousReceiver.setMode(3); // MODE_REENTER

            // Execute outer fill
            await swap.fillOrderArgs(order, r, vs, tokenAmount, takerTraits.traits, takerTraits.args);

            // Verify receiver was called and reentrancy was attempted
            expect(await maliciousReceiver.callbackCount()).to.equal(1n);
            expect(await maliciousReceiver.reentrancyAttempted()).to.equal(true);
            // Invalidator updated prior to token transfer => reentrant fill was blocked
            expect(await maliciousReceiver.reentrancySucceeded()).to.equal(false);

            // Check that reentrancy error selector corresponds to BitInvalidatedOrder() (0xa4f62a96)
            const errorData = await maliciousReceiver.reentrancyReturnData();
            expect(errorData.substring(0, 10)).to.equal('0xa4f62a96');

            // Tokens settled properly for outer fill
            expect(await mock1155.balanceOf(tokenId, await maliciousReceiver.getAddress())).to.equal(tokenAmount);
        });

        it('strictly caps reentrant fill to remainingMakingAmount on partial-fill orders', async function () {
            const { dai, swap, chainId, erc1155Proxy, mock1155, maliciousReceiver } = await loadFixture(deployEnvironment);

            const tokenId = 202n;
            const totalMaking = 100n;
            const totalTaking = 200n;

            await mock1155.mint(addr1.address, tokenId, totalMaking);
            await mock1155.connect(addr1).setApprovalForAll(await erc1155Proxy.getAddress(), true);

            const encodedCall = erc1155Proxy.interface.encodeFunctionData('func_301JL5R', [
                addr1.address,
                constants.ZERO_ADDRESS,
                0,
                await mock1155.getAddress(),
                tokenId,
                '0x',
            ]);
            const suffix = '0x' + encodedCall.substring(202);

            // Partial fill order (allowMultipleFills: true)
            const order = buildOrder(
                {
                    makerAsset: await erc1155Proxy.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: totalMaking,
                    takingAmount: totalTaking,
                    maker: addr1.address,
                    makerTraits: buildMakerTraits({ allowMultipleFills: true }),
                },
                {
                    makerAssetSuffix: suffix,
                },
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(
                await signOrder(order, chainId, await swap.getAddress(), addr1),
            );

            // Outer fill attempts 40 units
            const outerMaking = 40n;
            const outerTaking = 80n;
            const takerTraitsOuter = buildTakerTraits({
                threshold: outerTaking,
                makingAmount: true,
                extension: order.extension,
                target: await maliciousReceiver.getAddress(),
            });

            // Inner fill attempts 40 units
            const innerMaking = 40n;
            const innerTaking = 80n;
            const takerTraitsInner = buildTakerTraits({
                threshold: innerTaking,
                makingAmount: true,
                extension: order.extension,
                target: await maliciousReceiver.getAddress(),
            });

            const reentrantFillCalldata = swap.interface.encodeFunctionData('fillOrderArgs', [
                order,
                r,
                vs,
                innerMaking,
                takerTraitsInner.traits,
                takerTraitsInner.args,
            ]);

            await maliciousReceiver.setReentrantCalldata(reentrantFillCalldata);
            await maliciousReceiver.setMode(3); // MODE_REENTER

            // Execute outer fill
            await swap.fillOrderArgs(order, r, vs, outerMaking, takerTraitsOuter.traits, takerTraitsOuter.args);

            // Both fills executed cleanly because remaining making amount was sufficient (100 - 40 = 60 remaining)
            expect(await maliciousReceiver.callbackCount()).to.equal(2n); // 1 outer + 1 inner
            expect(await maliciousReceiver.reentrancySucceeded()).to.equal(true);

            // Receiver received exactly 80 tokens (40 from outer + 40 from inner)
            expect(await mock1155.balanceOf(tokenId, await maliciousReceiver.getAddress())).to.equal(80n);
            // Maker received 160 DAI
            expect(await dai.balanceOf(addr1.address)).to.equal(160n);

            // Check remaining invalidator for order: exactly 20 remains
            expect(await swap.remainingInvalidatorForOrder(addr1.address, await swap.hashOrder(order))).to.equal(20n);
        });
    });

    describe('3. Callback Failure & Transaction Atomicity (Rollback Invariant)', function () {
        it('rolls back completely when onERC1155Received reverts', async function () {
            const { dai, swap, chainId, erc1155Proxy, mock1155, maliciousReceiver } = await loadFixture(deployEnvironment);

            const tokenId = 303n;
            const tokenAmount = 15n;
            const priceDai = 30n;

            await mock1155.mint(addr1.address, tokenId, tokenAmount);
            await mock1155.connect(addr1).setApprovalForAll(await erc1155Proxy.getAddress(), true);

            const encodedCall = erc1155Proxy.interface.encodeFunctionData('func_301JL5R', [
                addr1.address,
                constants.ZERO_ADDRESS,
                0,
                await mock1155.getAddress(),
                tokenId,
                '0x',
            ]);
            const suffix = '0x' + encodedCall.substring(202);

            const order = buildOrder(
                {
                    makerAsset: await erc1155Proxy.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: tokenAmount,
                    takingAmount: priceDai,
                    maker: addr1.address,
                },
                {
                    makerAssetSuffix: suffix,
                },
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(
                await signOrder(order, chainId, await swap.getAddress(), addr1),
            );

            const takerTraits = buildTakerTraits({
                threshold: priceDai,
                makingAmount: true,
                extension: order.extension,
                target: await maliciousReceiver.getAddress(),
            });

            // Set receiver to revert
            await maliciousReceiver.setMode(1); // MODE_REVERT

            await expect(
                swap.fillOrderArgs(order, r, vs, tokenAmount, takerTraits.traits, takerTraits.args),
            ).to.be.revertedWithCustomError(swap, 'TransferFromMakerToTakerFailed');

            // Assert complete state rollback: Maker retains tokens, DAI untouched, order remaining untouched
            expect(await mock1155.balanceOf(tokenId, addr1.address)).to.equal(tokenAmount);
            expect(await mock1155.balanceOf(tokenId, await maliciousReceiver.getAddress())).to.equal(0n);
            expect(await dai.balanceOf(addr1.address)).to.equal(0n);
            expect(await swap.rawRemainingInvalidatorForOrder(addr1.address, await swap.hashOrder(order))).to.equal(0n);
        });

        it('rolls back when onERC1155Received returns an invalid selector', async function () {
            const { dai, swap, chainId, erc1155Proxy, mock1155, maliciousReceiver } = await loadFixture(deployEnvironment);

            const tokenId = 404n;
            const tokenAmount = 10n;
            const priceDai = 20n;

            await mock1155.mint(addr1.address, tokenId, tokenAmount);
            await mock1155.connect(addr1).setApprovalForAll(await erc1155Proxy.getAddress(), true);

            const encodedCall = erc1155Proxy.interface.encodeFunctionData('func_301JL5R', [
                addr1.address,
                constants.ZERO_ADDRESS,
                0,
                await mock1155.getAddress(),
                tokenId,
                '0x',
            ]);
            const suffix = '0x' + encodedCall.substring(202);

            const order = buildOrder(
                {
                    makerAsset: await erc1155Proxy.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: tokenAmount,
                    takingAmount: priceDai,
                    maker: addr1.address,
                },
                {
                    makerAssetSuffix: suffix,
                },
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(
                await signOrder(order, chainId, await swap.getAddress(), addr1),
            );

            const takerTraits = buildTakerTraits({
                threshold: priceDai,
                makingAmount: true,
                extension: order.extension,
                target: await maliciousReceiver.getAddress(),
            });

            // Set receiver to return invalid selector
            await maliciousReceiver.setMode(2); // MODE_BAD_SELECTOR

            await expect(
                swap.fillOrderArgs(order, r, vs, tokenAmount, takerTraits.traits, takerTraits.args),
            ).to.be.revertedWithCustomError(swap, 'TransferFromMakerToTakerFailed');

            expect(await mock1155.balanceOf(tokenId, addr1.address)).to.equal(tokenAmount);
        });
    });

    describe('4. ERC721ProxySafe vs ERC721Proxy Callback & Reentrancy', function () {
        it('ERC721ProxySafe triggers onERC721Received and blocks single-fill reentrancy', async function () {
            const { dai, swap, chainId, erc721ProxySafe, mock721, maliciousReceiver } = await loadFixture(deployEnvironment);

            const tokenId = 777n;
            const priceDai = 250n;

            await mock721.mint(addr1.address, tokenId);
            await mock721.connect(addr1).setApprovalForAll(await erc721ProxySafe.getAddress(), true);

            const encodedCall = erc721ProxySafe.interface.encodeFunctionData('func_60iHVgK', [
                addr1.address,
                constants.ZERO_ADDRESS,
                0,
                tokenId,
                await mock721.getAddress(),
            ]);
            const suffix = '0x' + encodedCall.substring(202);

            const order = buildOrder(
                {
                    makerAsset: await erc721ProxySafe.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: 1n,
                    takingAmount: priceDai,
                    maker: addr1.address,
                    makerTraits: buildMakerTraits({ allowMultipleFills: false }),
                },
                {
                    makerAssetSuffix: suffix,
                },
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(
                await signOrder(order, chainId, await swap.getAddress(), addr1),
            );

            const takerTraits = buildTakerTraits({
                threshold: priceDai,
                makingAmount: true,
                extension: order.extension,
                target: await maliciousReceiver.getAddress(),
            });

            const reentrantFillCalldata = swap.interface.encodeFunctionData('fillOrderArgs', [
                order,
                r,
                vs,
                1n,
                takerTraits.traits,
                takerTraits.args,
            ]);

            await maliciousReceiver.setReentrantCalldata(reentrantFillCalldata);
            await maliciousReceiver.setMode(3); // MODE_REENTER

            await swap.fillOrderArgs(order, r, vs, 1n, takerTraits.traits, takerTraits.args);

            expect(await maliciousReceiver.callbackCount()).to.equal(1n);
            expect(await maliciousReceiver.reentrancyAttempted()).to.equal(true);
            expect(await maliciousReceiver.reentrancySucceeded()).to.equal(false);
            expect(await mock721.ownerOf(tokenId)).to.equal(await maliciousReceiver.getAddress());
        });

        it('ERC721Proxy (non-safe) executes transferFrom without triggering onERC721Received', async function () {
            const { dai, swap, chainId, erc721Proxy, mock721, maliciousReceiver } = await loadFixture(deployEnvironment);

            const tokenId = 888n;
            const priceDai = 200n;

            await mock721.mint(addr1.address, tokenId);
            await mock721.connect(addr1).setApprovalForAll(await erc721Proxy.getAddress(), true);

            const encodedCall = erc721Proxy.interface.encodeFunctionData('func_60iHVgK', [
                addr1.address,
                constants.ZERO_ADDRESS,
                0,
                tokenId,
                await mock721.getAddress(),
            ]);
            const suffix = '0x' + encodedCall.substring(202);

            const order = buildOrder(
                {
                    makerAsset: await erc721Proxy.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: 1n,
                    takingAmount: priceDai,
                    maker: addr1.address,
                },
                {
                    makerAssetSuffix: suffix,
                },
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(
                await signOrder(order, chainId, await swap.getAddress(), addr1),
            );

            const takerTraits = buildTakerTraits({
                threshold: priceDai,
                makingAmount: true,
                extension: order.extension,
                target: await maliciousReceiver.getAddress(),
            });

            // Set receiver to revert if called
            await maliciousReceiver.setMode(1);

            // Fill succeeds because ERC721Proxy calls non-safe transferFrom (no onERC721Received callback)
            await swap.fillOrderArgs(order, r, vs, 1n, takerTraits.traits, takerTraits.args);

            expect(await maliciousReceiver.callbackCount()).to.equal(0n);
            expect(await mock721.ownerOf(tokenId)).to.equal(await maliciousReceiver.getAddress());
        });
    });

    describe('5. Access Control & Direct Call Bounds', function () {
        it('reverts when calling ERC1155Proxy directly from an unauthorized caller', async function () {
            const { erc1155Proxy, mock1155 } = await loadFixture(deployEnvironment);

            await expect(
                erc1155Proxy.func_301JL5R(
                    addr1.address,
                    addr.address,
                    10n,
                    await mock1155.getAddress(),
                    1n,
                    '0x',
                ),
            ).to.be.revertedWithCustomError(erc1155Proxy, 'IOAccessDenied');
        });

        it('reverts when calling ERC721Proxy directly from an unauthorized caller', async function () {
            const { erc721Proxy, mock721 } = await loadFixture(deployEnvironment);

            await expect(
                erc721Proxy.func_60iHVgK(
                    addr1.address,
                    addr.address,
                    1n,
                    1n,
                    await mock721.getAddress(),
                ),
            ).to.be.revertedWithCustomError(erc721Proxy, 'IOAccessDenied');
        });
    });

    describe('6. ERC721 Proxy Amount Invariant & Partial Fill Protection', function () {
        it('proves ERC721Proxy ignores amount parameter and prevents second fill of already transferred NFT', async function () {
            const { dai, swap, chainId, erc721Proxy, mock721 } = await loadFixture(deployEnvironment);

            const tokenId = 999n;
            const priceDai = 300n;

            await mock721.mint(addr1.address, tokenId);
            await mock721.connect(addr1).setApprovalForAll(await erc721Proxy.getAddress(), true);

            const encodedCall = erc721Proxy.interface.encodeFunctionData('func_60iHVgK', [
                addr1.address,
                constants.ZERO_ADDRESS,
                0,
                tokenId,
                await mock721.getAddress(),
            ]);
            const suffix = '0x' + encodedCall.substring(202);

            // An order mistakenly configured with allowMultipleFills: true and makingAmount = 2
            const order = buildOrder(
                {
                    makerAsset: await erc721Proxy.getAddress(),
                    takerAsset: await dai.getAddress(),
                    makingAmount: 2n,
                    takingAmount: priceDai,
                    maker: addr1.address,
                    makerTraits: buildMakerTraits({ allowMultipleFills: true }),
                },
                {
                    makerAssetSuffix: suffix,
                },
            );

            const { r, yParityAndS: vs } = ethers.Signature.from(
                await signOrder(order, chainId, await swap.getAddress(), addr1),
            );

            // First fill takes 1 unit of makingAmount (transfers the whole NFT)
            const takerTraits1 = buildTakerTraits({
                threshold: priceDai / 2n,
                makingAmount: true,
                extension: order.extension,
            });

            await swap.fillOrderArgs(order, r, vs, 1n, takerTraits1.traits, takerTraits1.args);
            expect(await mock721.ownerOf(tokenId)).to.equal(addr.address);

            // Second fill attempts to take remaining 1 unit of makingAmount
            // Fails because maker no longer owns the NFT
            const takerTraits2 = buildTakerTraits({
                threshold: priceDai / 2n,
                makingAmount: true,
                extension: order.extension,
            });

            await expect(
                swap.fillOrderArgs(order, r, vs, 1n, takerTraits2.traits, takerTraits2.args),
            ).to.be.revertedWithCustomError(swap, 'TransferFromMakerToTakerFailed');
        });
    });
});
