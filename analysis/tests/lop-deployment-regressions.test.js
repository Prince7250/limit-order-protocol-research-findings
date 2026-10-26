'use strict';

// Dependency-free reproducer for the two deployment findings.  It deliberately
// models only the expressions and address choice under review; it does not load
// Hardhat or modify a deployment.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

function currentPermit2ProxyGuard(networkName, config, rpcChainId) {
    return networkName in config.networks[networkName]
        && rpcChainId !== config.networks[networkName].chainId.toString();
}

function correctedGuard(networkName, config, rpcChainId) {
    return networkName in config.networks
        && rpcChainId !== config.networks[networkName].chainId?.toString();
}

// Mocked Hardhat configuration: the named network expects mainnet (1), but its
// RPC endpoint reports 31337.  The current expression should reject it, but it
// does not because it looks for "mainnet" inside the mainnet config object.
const mockedHreConfig = {
    networks: {
        mainnet: { chainId: 1, url: 'http://mock-rpc' },
    },
};
assert.equal(currentPermit2ProxyGuard('mainnet', mockedHreConfig, '31337'), false);
assert.equal(correctedGuard('mainnet', mockedHreConfig, '31337'), true);

// This mirrors the address switch in the repository's pinned
// @uniswap/permit2-sdk 1.3.0 package.  It demonstrates the deployment-address
// mismatch only; it is not a claim that the hard-coded contract is malicious.
const canonicalPermit2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const zkSyncPermit2 = '0x0000000000225e31D15943971F47aD3022F714Fa';
const permit2Address = (chainId) => chainId === 324 ? zkSyncPermit2 : canonicalPermit2;
const witnessSource = fs.readFileSync(
    path.join(root, 'contracts', 'extensions', 'Permit2WitnessProxy.sol'),
    'utf8',
);

assert.match(witnessSource, /IPermit2WitnessTransferFrom\(0x000000000022D473030F116dDEE9F6B43aC78BA3\)/);
assert.equal(permit2Address(324), zkSyncPermit2);
assert.notEqual(canonicalPermit2.toLowerCase(), permit2Address(324).toLowerCase());

console.log('LOP-02 reproduced: current guard=false, corrected guard=true for a mismatched mocked RPC.');
console.log('LOP-01 reproduced: witness proxy target differs from the SDK-selected zkSync address.');
