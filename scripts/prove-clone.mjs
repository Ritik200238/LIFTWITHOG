#!/usr/bin/env node
/**
 * Clone a coach, twice down, and read the lineage back off the chain.
 *
 *   node --env-file=server/.env scripts/prove-clone.mjs
 *
 * Renting borrows a trainer's method for a while. Cloning takes a copy that
 * then trains on somebody else's data and diverges — which is what actually
 * happens when a person buys a programme. What no fitness product has ever had
 * is the *credit*: a trainer whose method spreads through three generations of
 * copies has no way to prove it. Here the descent is on chain and nothing can
 * edit it, including whoever holds the third-generation copy.
 *
 * Every address below is generated on the spot and holds nothing — the trainer
 * included. The trainer mints through the relayer, lists through the relayer,
 * and is paid directly by every clone. Three owners deep, not one of them has
 * ever held a coin, and the contract's balance is asserted to be zero at the end.
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
  'function setClonePriceFor(address owner,uint256 tokenId,uint256 price,uint256 deadline,bytes signature)',
  'function cloneFor(address owner,uint256 parentId,bytes32 configHash,string configURI,uint256 deadline,bytes signature) payable returns (uint256)',
  'function clonePrice(uint256) view returns (uint256)',
  'function parentOf(uint256) view returns (uint256)',
  'function generationOf(uint256 tokenId,uint256 maxDepth) view returns (uint256 generation,bool complete)',
  'function ownerOf(uint256) view returns (address)',
  'function nonceOf(address) view returns (uint256)',
  'event CoachMinted(uint256 indexed tokenId,address indexed owner,bytes32 configHash)',
  'event CoachCloned(uint256 indexed parentId,uint256 indexed childId,address indexed owner,uint256 paid)',
];

const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
const relayer = new ethers.Wallet(RELAYER, provider);
const coach = new ethers.Contract(COACH, ABI, relayer);

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
const CLONE_TYPES = {
  CloneCoach: [
    { name: 'owner', type: 'address' },
    { name: 'parentId', type: 'uint256' },
    { name: 'configHash', type: 'bytes32' },
    { name: 'configURIHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};
const PRICE_TYPES = {
  SetClonePrice: [
    { name: 'owner', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'price', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

const PRICE = ethers.parseEther('0.001');
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
const balance = async (address) => provider.getBalance(address);

const idFrom = (receipt, name, field) => {
  for (const log of receipt.logs) {
    try {
      const parsed = coach.interface.parseLog(log);
      if (parsed?.name === name) return parsed.args[field];
    } catch { /* another contract's log */ }
  }
  return null;
};

/** Offer a coach for cloning, signed by its owner, submitted and paid for by the relayer. */
async function list(owner, tokenId) {
  const signature = await owner.signTypedData(domain, PRICE_TYPES, {
    owner: owner.address,
    tokenId,
    price: PRICE,
    nonce: await coach.nonceOf(owner.address),
    deadline,
  });
  await (await coach.setClonePriceFor(owner.address, tokenId, PRICE, deadline, signature, GAS)).wait();
}

/**
 * Buy a clone of `parent` for a key generated on the spot and holding nothing.
 *
 * The relayer pays the price and the fee, and cannot take the clone: the owner
 * is a field inside the signed message. The parent's owner holds nothing and
 * pays for nothing, so the whole movement on its balance is the payout.
 */
async function buyClone(parent, label) {
  const device = ethers.Wallet.createRandom();
  const resealed = await sealForService(profile, servicePublicKeyFrom(SERVICE));
  const configHash = ethers.keccak256(resealed);
  const configURI = `og://storage/${label}`;

  const signature = await device.signTypedData(domain, CLONE_TYPES, {
    owner: device.address,
    parentId: parent,
    configHash,
    configURIHash: ethers.keccak256(ethers.toUtf8Bytes(configURI)),
    nonce: await coach.nonceOf(device.address),
    deadline,
  });

  const parentOwner = await coach.ownerOf(parent);
  const before = await balance(parentOwner);

  const receipt = await (
    await coach.cloneFor(device.address, parent, configHash, configURI, deadline, signature, { ...GAS, value: PRICE })
  ).wait();

  return {
    child: idFrom(receipt, 'CoachCloned', 'childId'),
    device,
    receipt,
    paid: (await balance(parentOwner)) - before,
  };
}

console.log(`chain     ${CHAIN_ID}`);
console.log(`coach     ${COACH}`);
console.log(`relayer   ${relayer.address}  (pays every fee and every clone price below)`);

/* ------------------------------------------------------------ the original */

const trainer = ethers.Wallet.createRandom();
console.log(`trainer   ${trainer.address}  (generated now, holds ${ethers.formatEther(await balance(trainer.address))} 0G)\n`);

const profile = { method: 'Push/Pull/Legs, six days, add 2.5 kg when every rep lands.' };
const sealed = await sealForService(profile, servicePublicKeyFrom(SERVICE));
const rootHash = ethers.keccak256(sealed);
const rootURI = 'og://storage/lineage-root';

process.stdout.write('minting the original for the trainer… ');
const mintSig = await trainer.signTypedData(domain, MINT_TYPES, {
  owner: trainer.address,
  configHash: rootHash,
  configURIHash: ethers.keccak256(ethers.toUtf8Bytes(rootURI)),
  nonce: await coach.nonceOf(trainer.address),
  deadline,
});
const original = idFrom(
  await (await coach.mintFor(trainer.address, rootHash, rootURI, deadline, mintSig, GAS)).wait(),
  'CoachMinted',
  'tokenId',
);
console.log(`coach #${original}`);

process.stdout.write('the trainer offers it for cloning… ');
await list(trainer, original);
console.log(`${ethers.formatEther(PRICE)} 0G, listed while holding nothing`);

/* ---------------------------------------------------------- generation two */

process.stdout.write(`\ncloning #${original} for a new owner… `);
const gen2 = await buyClone(original, 'lineage-gen2');
console.log(`coach #${gen2.child}`);
console.log(`  ${EXPLORER}/tx/${gen2.receipt.hash}`);
console.log(`  new owner ${gen2.device.address} holds ${ethers.formatEther(await balance(gen2.device.address))} 0G`);
console.log(`  the trainer received ${gen2.paid === PRICE ? 'the full price' : 'WRONG: ' + ethers.formatEther(gen2.paid)}`);

process.stdout.write(`#${gen2.child}'s owner offers it for cloning… `);
await list(gen2.device, gen2.child);
console.log('listed, holding nothing');

/* -------------------------------------------------------- generation three */

process.stdout.write(`\ncloning #${gen2.child} for a third owner… `);
const gen3 = await buyClone(gen2.child, 'lineage-gen3');
console.log(`coach #${gen3.child}`);
console.log(`  ${EXPLORER}/tx/${gen3.receipt.hash}`);
console.log(`  #${gen2.child}'s owner received ${gen3.paid === PRICE ? 'the full price' : 'WRONG: ' + ethers.formatEther(gen3.paid)}`);

/* ------------------------------------------------------------- the lineage */

const [generation, complete] = await coach.generationOf(gen3.child, 10);
const held = await balance(COACH);

console.log('\nread back from the chain:');
console.log(`  parentOf(${gen3.child})  → #${await coach.parentOf(gen3.child)}`);
console.log(`  parentOf(${gen2.child})  → #${await coach.parentOf(gen2.child)}`);
console.log(`  parentOf(${original})  → #${await coach.parentOf(original)}   (an original)`);
console.log(`  generationOf(${gen3.child}) → ${generation}, walk complete: ${complete}`);
console.log(`  the trainer now holds ${ethers.formatEther(await balance(trainer.address))} 0G — all of it from clones`);
console.log(`  contract balance      ${ethers.formatEther(held)} 0G`);

const ok =
  Number(await coach.parentOf(gen3.child)) === Number(gen2.child) &&
  Number(await coach.parentOf(gen2.child)) === Number(original) &&
  Number(generation) === 3 &&
  complete &&
  held === 0n &&
  gen2.paid === PRICE &&
  gen3.paid === PRICE;

console.log(`\n${ok ? '✓' : '✗'} three generations on chain, every owner walletless, every payment forwarded, the contract holding nothing.`);
if (!ok) process.exitCode = 1;
