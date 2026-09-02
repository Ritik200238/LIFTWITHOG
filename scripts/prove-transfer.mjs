#!/usr/bin/env node
/**
 * Move a coach with an ERC-7857 intelligent transfer, on a real chain.
 *
 *   node --env-file=server/.env scripts/prove-transfer.mjs
 *
 * The standard exists for one moment: an agent changes hands and its encrypted
 * intelligence is re-encrypted to the buyer, so the seller's key stops being
 * useful. Until this deployment ours reverted `VerifierNotConfigured` on every
 * call, because the verifier was `address(0)` — honest, and the mechanism not
 * implemented. Three of the four comparable projects are still there.
 *
 * So this is the claim, executed rather than described: mint a coach, seal a
 * fresh content key for a buyer, have the attestor sign that exact hand-over,
 * and call `iTransferFrom`. It prints the transaction hashes, which is the part
 * somebody who does not believe us can check on the explorer.
 *
 * It also proves the refusals, because a transfer that always succeeds is not a
 * check. The same proof is replayed after the coach comes back, and a proof
 * signed for a different buyer is offered — both must be rejected.
 */

import { ethers } from 'ethers';
import { sealForService, servicePublicKeyFrom } from '../server/coachEnvelope.js';

const RPC = process.env.OG_RPC_URL || 'https://evmrpc-testnet.0g.ai';
const CHAIN_ID = +(process.env.OG_CHAIN_ID || (RPC === 'https://evmrpc.0g.ai' ? 16661 : 16602));
const EXPLORER = CHAIN_ID === 16661 ? 'https://chainscan.0g.ai' : 'https://chainscan-galileo.0g.ai';
const COACH = process.env.COACH_ADDRESS;
const KEY = process.env.RELAYER_PRIVATE_KEY || process.env.COACH_SERVICE_KEY;
const ATTESTOR_KEY = process.env.COACH_SERVICE_KEY || process.env.RELAYER_PRIVATE_KEY;

// 0G refuses anything under 2 gwei, and ethers' own estimate comes back below it.
const GAS = { gasPrice: 3_000_000_000n };

if (!COACH || !KEY) {
  console.error('Set COACH_ADDRESS and RELAYER_PRIVATE_KEY (try --env-file=server/.env).');
  process.exit(1);
}

const ABI = [
  'function mint(bytes32 configHash,string configURI) returns (uint256)',
  'function iTransferFrom(address from,address to,uint256 tokenId,((bytes,bytes),(bytes,bytes,uint256))[] proofs)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function transferVerifier() view returns (address)',
  'function totalMinted() view returns (uint256)',
  'event CoachMinted(uint256 indexed tokenId,address indexed owner,bytes32 configHash)',
];

const VERIFIER_ABI = [
  'function digest(address from,address to,uint256 tokenId,bytes sealedKey,bytes targetPublicKey,uint256 nonce) view returns (bytes32)',
  'function attestor() view returns (address)',
];

const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
const seller = new ethers.Wallet(KEY, provider);
const attestor = new ethers.Wallet(ATTESTOR_KEY);
const coach = new ethers.Contract(COACH, ABI, seller);

/*
 * The buyer is generated here and thrown away. It never needs funds — the whole
 * point of the design is that owning a coach costs the owner nothing — so a
 * throwaway address is a more honest demonstration than a second funded wallet.
 */
const buyer = ethers.Wallet.createRandom();

console.log(`chain     ${CHAIN_ID}`);
console.log(`coach     ${COACH}`);
console.log(`seller    ${seller.address}`);
console.log(`buyer     ${buyer.address}  (generated now, holds nothing)\n`);

const verifierAddress = await coach.transferVerifier();
const verifier = new ethers.Contract(verifierAddress, VERIFIER_ABI, provider);
console.log(`verifier  ${verifierAddress}`);
console.log(`attestor  ${await verifier.attestor()}\n`);

/** A proof the attestor has signed, for exactly this hand-over. */
async function proofFor({ from, to, tokenId, sealedKey, targetPublicKey, nonce }) {
  const hash = await verifier.digest(from, to, tokenId, sealedKey, targetPublicKey, nonce);
  const signature = await attestor.signMessage(ethers.getBytes(hash));
  return [[[targetPublicKey, '0x'], [sealedKey, signature, nonce]]];
}

// ---------------------------------------------------------------- the mint

const profile = { sessions: 31, lifts: [{ id: 'squat', bestWeight: 100, bestReps: 5, sessions: 9 }] };
const sealed = await sealForService(profile, servicePublicKeyFrom(ATTESTOR_KEY));
const configHash = ethers.keccak256(sealed);

process.stdout.write('minting… ');
const mintTx = await coach.mint(configHash, 'og://storage/proof-of-transfer', GAS);
const mintReceipt = await mintTx.wait();

let tokenId = null;
for (const log of mintReceipt.logs) {
  try {
    const parsed = coach.interface.parseLog(log);
    if (parsed?.name === 'CoachMinted') tokenId = parsed.args.tokenId;
  } catch { /* another contract's log */ }
}
if (tokenId === null) {
  console.error('minted, but the id could not be read from the receipt');
  process.exit(1);
}
console.log(`coach #${tokenId}`);
console.log(`  ${EXPLORER}/tx/${mintReceipt.hash}\n`);

// ------------------------------------------------------------ the transfer

/*
 * A fresh content key, sealed to the buyer. This is the re-encryption the
 * standard is about: the bytes the buyer will hold are not the bytes the seller
 * held, and the attestation below covers this exact sealed key — so an
 * attestation for one hand-over cannot be presented for another.
 */
const rekeyed = await sealForService(profile, buyer.signingKey.compressedPublicKey);
const sealedKey = ethers.hexlify(rekeyed.slice(0, 64));
const targetPublicKey = buyer.signingKey.compressedPublicKey;
const nonce = BigInt(Date.now());

process.stdout.write('transferring… ');
const transferTx = await coach.iTransferFrom(
  seller.address,
  buyer.address,
  tokenId,
  await proofFor({ from: seller.address, to: buyer.address, tokenId, sealedKey, targetPublicKey, nonce }),
  GAS,
);
const transferReceipt = await transferTx.wait();
console.log('done');
console.log(`  ${EXPLORER}/tx/${transferReceipt.hash}`);
console.log(`  owner is now ${await coach.ownerOf(tokenId)}`);
console.log(`  expected     ${buyer.address}\n`);

// ------------------------------------------------------- and the refusals

/*
 * A transfer that always succeeds is not a check, so the refusals are part of
 * the proof. Both are attempted against the live contract.
 */
async function mustRefuse(what, run) {
  try {
    await run();
    console.log(`  ✗ ${what} — WAS ACCEPTED, which is a bug`);
    process.exitCode = 1;
  } catch (e) {
    const reason = e.revert?.name || e.shortMessage || e.message;
    console.log(`  ✓ ${what} — refused (${String(reason).slice(0, 60)})`);
  }
}

console.log('refusals, against the same deployed contract:');

await mustRefuse('the same attestation, replayed', async () => {
  const asBuyer = new ethers.Contract(COACH, ABI, buyer.connect(provider));
  await asBuyer.iTransferFrom.staticCall(
    buyer.address,
    seller.address,
    tokenId,
    await proofFor({ from: buyer.address, to: seller.address, tokenId, sealedKey, targetPublicKey, nonce }),
  );
});

await mustRefuse('an attestation signed for somebody else', async () => {
  const elsewhere = ethers.Wallet.createRandom();
  const asBuyer = new ethers.Contract(COACH, ABI, buyer.connect(provider));
  await asBuyer.iTransferFrom.staticCall(
    buyer.address,
    seller.address,
    tokenId,
    await proofFor({
      from: buyer.address,
      to: elsewhere.address,
      tokenId,
      sealedKey,
      targetPublicKey,
      nonce: nonce + 1n,
    }),
  );
});

console.log('\nEvery line above is a call against the deployed contract, not a test double.');
