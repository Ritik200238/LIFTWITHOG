import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';

import { cardMessage, publish, verify } from './progressCard.js';

/**
 * A claim a stranger can check, and the exact edge of what it checks.
 *
 * The value of this is not that it proves somebody lifted a weight — nothing
 * can, and the verifier says so in its own output. It is that the three things
 * a fitness screenshot can never establish are on chain and unfakeable: how long
 * the coach has existed, how much learning it has recorded, and who owns it.
 *
 * So these tests are mostly about the ways a card can be a lie, and each one
 * being caught by re-deriving rather than by reading the card's own claims.
 */

const OWNER = ethers.Wallet.createRandom();
const STRANGER = ethers.Wallet.createRandom();
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

const contractStub = (over = {}) => ({
  target: '0x' + 'c0'.repeat(20),
  ownerOf: async () => OWNER.address,
  coachOf: async () => [ethers.ZeroHash, 'og://root', 6n, 0n],
  ...over,
});

const sign = (wallet, tokenId, issuedAt) =>
  wallet.signMessage(
    ['LIFTWITHOG coach request', `coach: ${tokenId}`, `issued: ${issuedAt}`].join('\n'),
  );

/** Storage, as a map. The bytes matter; where they live does not. */
const memory = new Map();
const store = async (bytes) => {
  const root = ethers.keccak256(bytes);
  memory.set(root, bytes);
  return root;
};
const fetchRoot = async (root) => memory.get(root) ?? null;

const deps = (over = {}) => ({
  now: NOW,
  contract: contractStub(over.contract),
  createdAt: async () => NOW - 84 * DAY,
  store,
  fetch: fetchRoot,
  ...over,
  contract: contractStub(over.contract),
});

/** Publish a card as the owner, and sign the card itself. */
async function published(claim = 'Bench press: 40 kg → 60 kg.', wallet = OWNER, over = {}) {
  const issuedAt = NOW;
  const d = deps(over);

  // Two signatures, deliberately: one authorises the request, one is the card.
  const request = await sign(wallet, 5, issuedAt);

  const draft = {
    cardVersion: 1,
    tokenId: '5',
    coachVersion: 6,
    claim,
    periodDays: 84,
    issuedAt,
  };
  const cardSignature = await wallet.signMessage(cardMessage(draft));

  const { root, card } = await publish(
    { tokenId: 5, claim, issuedAt, signature: request },
    { ...d, signature: cardSignature },
  );

  // The publisher stores the request signature; the card's own signature is what
  // a reader checks, so it is written in here the way the app writes it.
  const stored = { ...card, signature: cardSignature };
  const storedRoot = await store(new TextEncoder().encode(JSON.stringify(stored, null, 2)));

  return { root: storedRoot, card: stored, unusedRoot: root };
}

test('a card published by the owner checks out', async () => {
  const { root } = await published();
  const result = await verify(root, deps());

  assert.equal(result.valid, true);
  assert.equal(result.checks.signedByTheAddressItNames, true);
  assert.equal(result.checks.signerStillOwnsTheCoach, true);
  assert.equal(result.checks.versionExistsOnChain, true);
});

test('the verifier says what it does not prove, in its own output', async () => {
  /*
   * A verifier answering `valid: true` and saying nothing else invites exactly
   * the reading it cannot support. This is the honest half, and it ships with
   * the answer rather than living in a document somebody may not read.
   */
  const { root } = await published();
  const result = await verify(root, deps());

  assert.ok(result.doesNotProve.some((line) => /lifted the weight/i.test(line)));
  assert.ok(result.proves.some((line) => /owns the coach/i.test(line)));
});

test('editing the claim after signing breaks the card', async () => {
  /*
   * The whole point of rebuilding the message from the card's own fields: a
   * claim swapped after signing recovers to a different address, and the card
   * names the original one.
   */
  const { root, card } = await published();
  const tampered = { ...card, claim: 'Bench press: 40 kg → 200 kg.' };
  const tamperedRoot = await store(new TextEncoder().encode(JSON.stringify(tampered, null, 2)));

  const result = await verify(tamperedRoot, deps());

  assert.equal(result.checks.signedByTheAddressItNames, false);
  assert.equal(result.valid, false);
  assert.notEqual(root, tamperedRoot);
});

test('claiming more versions than the coach has is caught', async () => {
  /*
   * The version count is what makes "twelve weeks of training" mean anything.
   * A card asserting version 40 against a coach on version 6 is the fitness
   * equivalent of a photoshopped screenshot, and the chain settles it.
   */
  const issuedAt = NOW;
  const draft = { cardVersion: 1, tokenId: '5', coachVersion: 40, claim: 'x', periodDays: 84, issuedAt };
  const stored = {
    ...draft,
    owner: OWNER.address,
    signature: await OWNER.signMessage(cardMessage(draft)),
  };
  const root = await store(new TextEncoder().encode(JSON.stringify(stored, null, 2)));

  const result = await verify(root, deps());

  assert.equal(result.checks.signedByTheAddressItNames, true, 'the signature is genuine');
  assert.equal(result.checks.versionExistsOnChain, false, 'but the chain disagrees about the history');
  assert.equal(result.valid, false);
});

test('claiming a longer history than the coach has is caught', async () => {
  const issuedAt = NOW;
  const draft = { cardVersion: 1, tokenId: '5', coachVersion: 6, claim: 'x', periodDays: 900, issuedAt };
  const stored = {
    ...draft,
    owner: OWNER.address,
    signature: await OWNER.signMessage(cardMessage(draft)),
  };
  const root = await store(new TextEncoder().encode(JSON.stringify(stored, null, 2)));

  const result = await verify(root, deps({ createdAt: async () => NOW - 84 * DAY }));

  assert.equal(result.checks.ageMatchesTheChain, false);
  assert.equal(result.valid, false);
});

test('a card signed by somebody who does not own the coach is caught', async () => {
  /*
   * Built by hand rather than through `publish`, which refuses at the source —
   * this is the case where somebody writes the JSON themselves and puts it on
   * storage, which nothing stops them doing. The verifier is the check.
   */
  const issuedAt = NOW;
  const draft = { cardVersion: 1, tokenId: '5', coachVersion: 6, claim: 'Squat: 100 kg → 140 kg.', periodDays: 84, issuedAt };
  const stored = {
    ...draft,
    owner: STRANGER.address,
    signature: await STRANGER.signMessage(cardMessage(draft)),
  };
  const root = await store(new TextEncoder().encode(JSON.stringify(stored, null, 2)));

  const result = await verify(root, deps());

  // The signature is real — it is simply not the owner's.
  assert.equal(result.checks.signedByTheAddressItNames, true);
  assert.equal(result.checks.signerStillOwnsTheCoach, false);
  assert.equal(result.valid, false);
});

test('a card survives its author selling the coach — as invalid, not as an error', async () => {
  /*
   * Cards are shared and outlive the moment. Somebody who sells a coach has not
   * committed fraud, but their old card is no longer a claim about something
   * they own, and the verifier has to say that rather than throw.
   */
  const { root } = await published();

  const result = await verify(root, deps({ contract: { ownerOf: async () => STRANGER.address } }));

  assert.equal(result.checks.signerStillOwnsTheCoach, false);
  assert.equal(result.valid, false);
});

test('publishing about a coach you do not own is refused at the source', async () => {
  const issuedAt = NOW;
  const signature = await sign(STRANGER, 5, issuedAt);

  await assert.rejects(
    () => publish({ tokenId: 5, claim: 'not mine', issuedAt, signature }, deps()),
    (e) => e.code === 'not_owner' && e.status === 403,
  );
});

test('an empty claim is not a card', async () => {
  const issuedAt = NOW;
  const signature = await sign(OWNER, 5, issuedAt);

  await assert.rejects(
    () => publish({ tokenId: 5, claim: '   ', issuedAt, signature }, deps()),
    (e) => e.code === 'bad_request',
  );
});

test('a root nobody published is not found', async () => {
  await assert.rejects(
    () => verify('0x' + 'ff'.repeat(32), deps()),
    (e) => e.code === 'no_such_card' && e.status === 404,
  );
});

test('rubbish at a storage root is refused rather than parsed', async () => {
  const root = await store(new TextEncoder().encode('not a card at all'));

  await assert.rejects(() => verify(root, deps()), (e) => e.code === 'bad_card');
});
