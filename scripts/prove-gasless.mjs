#!/usr/bin/env node
/**
 * Own a coach, and list it for rent, holding nothing.
 *
 *   node --env-file=server/.env scripts/prove-gasless.mjs
 *
 * The product's central claim is that a person who has never heard of a wallet
 * can own an agent on a blockchain and earn from it. That is easy to write and
 * easy to fake — a screenshot of an address proves nothing about who paid.
 *
 * So this generates a key on the spot, the way a browser does, funds it with
 * nothing, and drives the two actions that matter through the relayer:
 *
 *   mint            the coach belongs to the new address
 *   setRentalPrice  its owner lists it and can be paid
 *
 * Then it reads back the owner and that owner's balance. A balance of exactly
 * zero beside ownership of a token is the whole argument, and it is a number
 * anybody can check on the explorer afterwards.
 *
 * Nothing here trusts the relayer: `owner` is a field inside every message the
 * device signs, so a relayer that wanted the coach for itself would be
 * submitting a signature that does not say so, and the contract would refuse.
 */

import { ethers } from 'ethers';
import { sealForService, servicePublicKeyFrom } from '../server/coachEnvelope.js';

const RPC = process.env.OG_RPC_URL || 'https://evmrpc-testnet.0g.ai';
const CHAIN_ID = +(process.env.OG_CHAIN_ID || (RPC === 'https://evmrpc.0g.ai' ? 16661 : 16602));
const EXPLORER = CHAIN_ID === 16661 ? 'https://chainscan.0g.ai' : 'https://chainscan-galileo.0g.ai';
const COACH = process.env.COACH_ADDRESS;
const RELAYER = process.env.RELAYER_PRIVATE_KEY;
const SERVICE = process.env.COACH_SERVICE_KEY || RELAYER;
const GAS = { gasPrice: 3_000_000_000n };

if (!COACH || !RELAYER) {
  console.error('Set COACH_ADDRESS and RELAYER_PRIVATE_KEY (try --env-file=server/.env).');
  process.exit(1);
}

const ABI = [
  'function mintFor(address owner,bytes32 configHash,string configURI,uint256 deadline,bytes signature) returns (uint256)',
  'function setRentalPriceFor(address owner,uint256 tokenId,uint256 pricePerDay,uint256 deadline,bytes signature)',
  'function nonceOf(address signer) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function rentalPrice(uint256 tokenId) view returns (uint256)',
  'event CoachMinted(uint256 indexed tokenId,address indexed owner,bytes32 configHash)',
];

const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
const relayer = new ethers.Wallet(RELAYER, provider);
const coach = new ethers.Contract(COACH, ABI, relayer);

/* A key made here and now, exactly as a browser makes one. It is never funded. */
const device = ethers.Wallet.createRandom();

const domain = { name: 'LIFTWITHOG Coach', version: '1', chainId: CHAIN_ID, verifyingContract: COACH };

const MINT_TYPES = {
  MintCoach: [
    { name: 'owner', type: 'address' },
    { name: 'configHash', type: 'bytes32' },
    { name: 'configURIHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

const PRICE_TYPES = {
  SetRentalPrice: [
    { name: 'owner', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'pricePerDay', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

console.log(`chain     ${CHAIN_ID}`);
console.log(`coach     ${COACH}`);
console.log(`device    ${device.address}  (generated just now)`);
console.log(`relayer   ${relayer.address}  (pays every fee below)\n`);

const startingBalance = await provider.getBalance(device.address);
console.log(`the device's balance before anything: ${ethers.formatEther(startingBalance)} 0G\n`);

// ------------------------------------------------------------------- mint

const profile = { sessions: 18, lifts: [{ id: 'bench', bestWeight: 60, bestReps: 5, sessions: 6 }] };
const sealed = await sealForService(profile, servicePublicKeyFrom(SERVICE));
const configHash = ethers.keccak256(sealed);
const configURI = 'og://storage/proof-of-gasless';
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

const mintSignature = await device.signTypedData(domain, MINT_TYPES, {
  owner: device.address,
  configHash,
  configURIHash: ethers.keccak256(ethers.toUtf8Bytes(configURI)),
  nonce: await coach.nonceOf(device.address),
  deadline,
});

process.stdout.write('minting for the device… ');
const mintReceipt = await (
  await coach.mintFor(device.address, configHash, configURI, deadline, mintSignature, GAS)
).wait();

let tokenId = null;
for (const log of mintReceipt.logs) {
  try {
    const parsed = coach.interface.parseLog(log);
    if (parsed?.name === 'CoachMinted') tokenId = parsed.args.tokenId;
  } catch { /* another contract's log */ }
}
console.log(`coach #${tokenId}`);
console.log(`  ${EXPLORER}/tx/${mintReceipt.hash}\n`);

// -------------------------------------------------------------- list it

const pricePerDay = ethers.parseEther('0.0003');
const priceSignature = await device.signTypedData(domain, PRICE_TYPES, {
  owner: device.address,
  tokenId,
  pricePerDay,
  nonce: await coach.nonceOf(device.address),
  deadline,
});

process.stdout.write('listing it for rent… ');
const priceReceipt = await (
  await coach.setRentalPriceFor(device.address, tokenId, pricePerDay, deadline, priceSignature, GAS)
).wait();
console.log('done');
console.log(`  ${EXPLORER}/tx/${priceReceipt.hash}\n`);

// ---------------------------------------------------------- and the point

const owner = await coach.ownerOf(tokenId);
const price = await coach.rentalPrice(tokenId);
const balance = await provider.getBalance(device.address);

console.log('read back from the chain:');
console.log(`  ownerOf(${tokenId})        ${owner}`);
console.log(`  rentalPrice(${tokenId})    ${ethers.formatEther(price)} 0G / day`);
console.log(`  that owner's balance  ${ethers.formatEther(balance)} 0G`);

const ownsIt = owner.toLowerCase() === device.address.toLowerCase();
const paidNothing = balance === 0n;
const listed = price === pricePerDay;

console.log(
  `\n${ownsIt && paidNothing && listed ? '✓' : '✗'} a coach owned and listed for rent by an ` +
    'address that has never held a coin.',
);

if (!(ownsIt && paidNothing && listed)) process.exitCode = 1;
