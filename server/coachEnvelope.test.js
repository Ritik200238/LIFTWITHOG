import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ethers } from 'ethers';

import { looksSealed, openAsService, sealForService, servicePublicKeyFrom } from './coachEnvelope.js';

/**
 * The test that was missing.
 *
 * Every coach a real person created answered "This coach cannot be opened by
 * this server", and the suite was green throughout — because the device's
 * encrypt was tested against the device's decrypt, and the server's against the
 * server's. Neither side ever met the other, so the two halves of one round trip
 * were free to disagree about both the key and the byte layout, and they did.
 *
 * So the rule these tests exist to enforce is not "encryption works". It is:
 * the bytes a device produces are opened by the code the server actually runs.
 * Anything less has already been proven to pass while the product is broken.
 */

const SERVICE = ethers.Wallet.createRandom().privateKey;
const SERVICE_PUB = servicePublicKeyFrom(SERVICE);

const PROFILE = {
  unit: 'kg',
  sessions: 42,
  bodyweight: 78.5,
  lifts: [{ id: 'bench', bestWeight: 70, bestReps: 5, sessions: 12 }],
  memoryDigest: 'v3:\n  - Bench press: 60 kg → 70 kg.',
};

test('a coach sealed on a device opens on the server, with every field intact', async () => {
  const sealed = await sealForService(PROFILE, SERVICE_PUB);
  assert.deepEqual(await openAsService(sealed, SERVICE), PROFILE);
});

test('the seeded coaches are plain text, and survive the same round trip', async () => {
  // A house coach carries a method description rather than a profile object.
  const method = 'You coach a six-day Push/Pull/Legs split.\nCompounds first.';
  const sealed = await sealForService(method, SERVICE_PUB);
  assert.equal(await openAsService(sealed, SERVICE), method);
});

test('nobody else can open it, which is the entire point', async () => {
  const sealed = await sealForService(PROFILE, SERVICE_PUB);
  const somebodyElse = ethers.Wallet.createRandom().privateKey;

  await assert.rejects(() => openAsService(sealed, somebodyElse));
});

test('the plaintext is nowhere in the bytes that leave the device', async () => {
  /*
   * The blob goes to a public network and is fetchable by root hash by anybody.
   * A profile that could be read out of it with `strings` would make the whole
   * arrangement decorative.
   */
  const sealed = await sealForService(PROFILE, SERVICE_PUB);
  const asText = new TextDecoder('utf8', { fatal: false }).decode(sealed);

  assert.ok(!asText.includes('bench'), 'an exercise id survived into the ciphertext');
  assert.ok(!asText.includes('78.5'), 'a bodyweight survived into the ciphertext');
  assert.ok(!asText.includes('memoryDigest'), 'a field name survived into the ciphertext');
});

test('altering a single byte anywhere is refused, not silently accepted', async () => {
  /*
   * AES-GCM authenticates, and this asserts we actually rely on that. It is the
   * property the on-chain hash depends on: a coach whose blob can be edited
   * without detection is a coach whose anchored hash proves nothing.
   *
   * Every region is poisoned in turn — the ephemeral key, the wrap, the nonces,
   * the payload — because a check that only covers the body would miss an
   * attacker swapping the wrapped key.
   */
  const sealed = await sealForService(PROFILE, SERVICE_PUB);

  for (const at of [6, 40, 55, 100, sealed.length - 1]) {
    const tampered = Uint8Array.from(sealed);
    tampered[at] ^= 0xff;
    await assert.rejects(
      () => openAsService(tampered, SERVICE),
      `a flipped byte at ${at} was accepted`,
    );
  }
});

test('sealing the same profile twice shares no ciphertext', async () => {
  /*
   * The sender key is one-shot. Without that, two versions of the same coach
   * would be visibly the same blob to anybody watching storage, and the wrap
   * from one could be replayed onto the other.
   */
  const a = await sealForService(PROFILE, SERVICE_PUB);
  const b = await sealForService(PROFILE, SERVICE_PUB);

  assert.equal(a.length, b.length);
  assert.notDeepEqual(Array.from(a), Array.from(b));
});

test('the byte layout is pinned, so a silent format change cannot ship', async () => {
  /*
   * If the header ever moves, the server stops opening blobs that are already
   * anchored on chain and cannot be re-written. Pinning the offsets here makes
   * that a failed test rather than a coach that quietly stops answering.
   */
  const sealed = await sealForService('x', SERVICE_PUB);

  assert.deepEqual(Array.from(sealed.subarray(0, 5)), [0x4c, 0x57, 0x4f, 0x47, 0x31], 'magic');
  assert.equal(sealed[5], 0x01, 'version');

  const ephPub = sealed.subarray(6, 39);
  assert.ok(ephPub[0] === 0x02 || ephPub[0] === 0x03, 'a compressed secp256k1 point');
  // It must be a real point: ethers refuses to expand a malformed one.
  assert.doesNotThrow(() =>
    ethers.SigningKey.computePublicKey('0x' + Buffer.from(ephPub).toString('hex'), false),
  );

  // 5 magic + 1 version + 33 key + 12 iv + 48 wrapped + 12 iv = 111
  assert.equal(sealed.length - 111, new Uint8Array(await sealHeadless('x')).length, 'payload width');
});

/** The GCM ciphertext of `JSON.stringify(value)` alone, for the width check above. */
async function sealHeadless(value) {
  const key = await crypto.subtle.importKey(
    'raw',
    crypto.randomBytes(32),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  return crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: crypto.randomBytes(12) },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
}

test('looksSealed tells our envelopes from the coaches minted before it existed', async () => {
  const sealed = await sealForService(PROFILE, SERVICE_PUB);
  assert.equal(looksSealed(sealed), true);

  // The pre-envelope format: iv ‖ tag ‖ body, with no magic.
  const legacy = Buffer.concat([crypto.randomBytes(12), crypto.randomBytes(16), Buffer.from('older')]);
  assert.equal(looksSealed(legacy), false);

  assert.equal(looksSealed(new Uint8Array(0)), false);
  assert.equal(looksSealed(crypto.randomBytes(200)), false);
});

test('an envelope from a future version is refused rather than misread', () => {
  /*
   * A newer app writing a v2 envelope must not have it fed to the v1 reader,
   * which would fail an authentication tag and be reported as tampering — a
   * confusing answer to a version skew that is not an attack.
   */
  const future = new Uint8Array(200);
  future.set([0x4c, 0x57, 0x4f, 0x47, 0x31], 0);
  future[5] = 0x02;

  assert.equal(looksSealed(future), false);
});

/**
 * The blob that outlives a storage node dropping it.
 *
 * 0G Storage is the canonical home and the chain records the root, but a node
 * can drop a blob before it replicates — after which the indexer answers "file
 * not found" for a coach whose pointer is on chain forever, and the coach can
 * never answer again. These cover the second copy that makes that survivable,
 * and the thing it must never become: a way to serve bytes nobody checked.
 */

test('a coach still opens when 0G Storage has lost the blob', async () => {
  const { createStore } = await import('./store.js');
  const { loadConfigFromStorage } = await import('./coach-runtime.js');
  const { ethers } = await import('ethers');

  const service = '0x' + '5c'.repeat(32);
  process.env.COACH_SERVICE_KEY = service;

  const profile = { sessions: 12, lifts: [] };
  const sealed = await sealForService(profile, servicePublicKeyFrom(service));
  const root = ethers.keccak256(sealed);

  await createStore().writeBlob(root, sealed);

  // The indexer has lost it, which is exactly the case this exists for.
  const indexer = {
    downloadToBlob: async () => { throw new Error('File not found'); },
  };

  assert.deepEqual(JSON.parse(await loadConfigFromStorage(root, root, { indexer })), profile);
});

test('the mirror is checked against the chain like any other copy', async () => {
  /*
   * The mirror must not become a way to serve bytes nobody verified. A local
   * copy that does not hash to what the chain recorded is refused and the
   * indexer is asked instead — the anchor is the authority, not the storage.
   */
  const { createStore } = await import('./store.js');
  const { loadConfigFromStorage } = await import('./coach-runtime.js');
  const { ethers } = await import('ethers');

  const service = '0x' + '6d'.repeat(32);
  process.env.COACH_SERVICE_KEY = service;

  const real = await sealForService({ sessions: 1 }, servicePublicKeyFrom(service));
  const anchor = ethers.keccak256(real);

  // Something else entirely, filed under the real coach's root.
  await createStore().writeBlob(anchor, await sealForService({ sessions: 999 }, servicePublicKeyFrom(service)));

  let asked = false;
  const indexer = {
    downloadToBlob: async () => {
      asked = true;
      return [{ arrayBuffer: async () => real.buffer.slice(real.byteOffset, real.byteOffset + real.byteLength) }, null];
    },
  };

  const opened = await loadConfigFromStorage(anchor, anchor, { indexer });

  assert.equal(asked, true, 'a mirror that failed its hash was trusted anyway');
  assert.deepEqual(JSON.parse(opened), { sessions: 1 });
});
