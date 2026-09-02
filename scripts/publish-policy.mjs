#!/usr/bin/env node
/**
 * Publish the rules this coach follows, so they can be argued with.
 *
 *   node --env-file=server/.env scripts/publish-policy.mjs           # dry run
 *   node --env-file=server/.env scripts/publish-policy.mjs --publish # for real
 *
 * The claim "the coach gives safe advice" is not checkable, and every product in
 * this space makes it. What *is* checkable is the rules it is bound by — the
 * instruction it is given, the calorie floors it may not go under, the deficit
 * and rate-of-loss caps, the refusals. So those are published: a public,
 * unencrypted blob on 0G Storage, its SHA-256 printed, and a commitment binding
 * the two anchored on 0G Chain.
 *
 * For a health product that is a stronger thing to be able to show than a model
 * nobody can inspect. It says: here are the bounds, here is the hash, here is
 * the transaction that fixes them to a moment. If the coach ever tells somebody
 * to eat 700 calories a day, the document saying it must not is public and
 * timestamped, and the gap is ours to answer for.
 *
 * Nothing here is a secret. There is no user data in it, no trainer's method,
 * nothing encrypted — which is exactly why it can be published in full.
 */

import crypto from 'node:crypto';
import { ethers } from 'ethers';
import { systemPrompt } from '../server/coach-runtime.js';

const RPC = process.env.OG_RPC_URL || 'https://evmrpc-testnet.0g.ai';
const CHAIN_ID = +(process.env.OG_CHAIN_ID || (RPC === 'https://evmrpc.0g.ai' ? 16661 : 16602));
const EXPLORER = CHAIN_ID === 16661 ? 'https://chainscan.0g.ai' : 'https://chainscan-galileo.0g.ai';
const INDEXER = process.env.OG_INDEXER_URL || 'https://indexer-storage-testnet-turbo.0g.ai';
const KEY = process.env.RELAYER_PRIVATE_KEY || process.env.COACH_SERVICE_KEY;
const PUBLISH = process.argv.includes('--publish');

/**
 * The nutrition bounds, read out of the module that enforces them.
 *
 * Imported rather than retyped, for the same reason the test counts are
 * computed rather than written: a published safety policy that has drifted from
 * the code enforcing it is worse than none, because it is a specific promise
 * that is specifically false.
 */
async function nutritionBounds() {
  const source = await import('node:fs').then((fs) =>
    fs.promises.readFile(new URL('../frontend/src/lib/nutrition.js', import.meta.url), 'utf8'),
  );

  const read = (name, pattern) => {
    const match = source.match(pattern);
    if (!match) throw new Error(`could not read ${name} out of nutrition.js — the policy would be a guess`);
    return match[1];
  };

  return {
    calorieFloorFemale: Number(read('female floor', /female:\s*(\d+)/)),
    // `male` and not `male`: "female" ends in "male", so the loose pattern
    // matched the female floor and would have published 1200 as the male one.
    // A safety document with a wrong number in it is worse than no document.
    calorieFloorMale: Number(read('male floor', /[^e]male:\s*(\d+)/)),
    maxDeficitFraction: Number(read('max deficit', /MAX_DEFICIT_FRACTION\s*=\s*([\d.]+)/)),
    maxSurplusFraction: Number(read('max surplus', /MAX_SURPLUS_FRACTION\s*=\s*([\d.]+)/)),
    maxLossKgPerWeek: Number(read('max loss', /MAX_LOSS_KG_PER_WEEK\s*=\s*([\d.]+)/)),
    maxGainKgPerWeek: Number(read('max gain', /MAX_GAIN_KG_PER_WEEK\s*=\s*([\d.]+)/)),
    minCarbG: Number(read('min carbohydrate', /MIN_CARB_G\s*=\s*(\d+)/)),
    fatFloorGPerKg: Number(read('fat floor', /FAT_G_PER_KG_FLOOR\s*=\s*([\d.]+)/)),
  };
}

const policy = {
  schemaVersion: 1,
  product: 'LIFTWITHOG',
  what: 'The rules the coach is bound by. Published so they can be checked and argued with.',

  /*
   * The literal instruction, with the config placeholder left empty. This is
   * what the model is told before it sees anybody's question — including the
   * refusals, which are the part that matters for a health product.
   */
  systemPrompt: systemPrompt(''),

  nutrition: await nutritionBounds(),

  refusals: [
    'The coach is given nutrition targets as fixed numbers and instructed never to invent, revise or extend them.',
    'It is instructed to give no medical or dietary advice beyond what those numbers already state.',
    'An answer that repeats the coach configuration verbatim is refused by the server, not by the model — see leaksConfig.',
    'Inference runs only on a TEE-attested provider; with none vouching for a response the request fails rather than falling back.',
  ],

  notClaimed: [
    'That the advice is good. Attestation proves where a model ran, not that it was right.',
    'That these bounds are medical advice. They are the limits the software will not exceed.',
  ],
};

const bytes = new TextEncoder().encode(JSON.stringify(policy, null, 2));
const sha256 = '0x' + crypto.createHash('sha256').update(bytes).digest('hex');

console.log(`bytes     ${bytes.length}`);
console.log(`sha256    ${sha256}`);
console.log(`prompt    ${policy.systemPrompt.length} characters`);
console.log(`bounds    ${JSON.stringify(policy.nutrition)}`);

if (!PUBLISH) {
  console.log('\nDry run. Pass --publish to upload and anchor it.');
  process.exit(0);
}

if (!KEY) {
  console.error('Set RELAYER_PRIVATE_KEY (try --env-file=server/.env).');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
const wallet = new ethers.Wallet(KEY, provider);

const { Indexer, MemData } = await import('@0gfoundation/0g-storage-ts-sdk');

process.stdout.write('\nuploading to 0G Storage… ');
const [uploaded, err] = await new Indexer(INDEXER).upload(new MemData(bytes), RPC, wallet, {
  taskSize: 10,
  expectedReplica: 1,
  finalityRequired: true,
  tags: '0x',
  skipTx: false,
  fee: 0n,
});

if (err || !uploaded?.rootHash) {
  console.error(`failed: ${err?.message || 'no root hash'}`);
  process.exit(1);
}
console.log(uploaded.rootHash);

/*
 * The commitment binds the storage root to the hash of the bytes and to the
 * moment. Anchored as a self-transfer carrying the commitment as calldata —
 * there is no registry contract for this, and inventing one would be a contract
 * with no other purpose. The transaction is the timestamp.
 */
const commitment = ethers.keccak256(
  ethers.toUtf8Bytes(JSON.stringify({ storageRoot: uploaded.rootHash, sha256, schemaVersion: policy.schemaVersion })),
);

process.stdout.write('anchoring the commitment… ');
const tx = await wallet.sendTransaction({
  to: wallet.address,
  value: 0n,
  data: commitment,
  gasPrice: 3_000_000_000n,
});
const receipt = await tx.wait();
console.log('done');

console.log('\nPROVENANCE');
console.log(`  storageRoot  ${uploaded.rootHash}`);
console.log(`  sha256       ${sha256}`);
console.log(`  commitment   ${commitment}`);
console.log(`  anchorTx     ${EXPLORER}/tx/${receipt.hash}`);
console.log('\nAnybody can download the blob by its root hash, sha256 it, recompute the');
console.log('commitment, and find it in that transaction. No part of this needs us.');
