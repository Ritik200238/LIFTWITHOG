import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

import { sealForService, openAsService, servicePublicKeyFrom } from './coachEnvelope.js';

/**
 * What is allowed to leave this machine, and by which door.
 *
 * This is a health product. What it holds is bodyweight, injuries, what somebody
 * eats and how they are actually doing — and it writes to a public network,
 * addressed by hash, where anything published is published for good. There is no
 * unsend.
 *
 * Two properties, both structural rather than careful:
 *
 *   1. Whatever goes to 0G Storage is sealed before it leaves the device, so a
 *      leak of the storage network is a leak of ciphertext.
 *   2. There is exactly one function that writes to 0G Storage on the server,
 *      so "we check before publishing" is a property of the module graph rather
 *      than of everybody remembering.
 *
 * The second is the one worth having a test for. A missed caller is not a bug
 * somebody notices; it is a quiet second door.
 */

const SERVICE = '0x' + '9a'.repeat(32);

/** Everything a coach payload could plausibly carry that must never be legible. */
const SENSITIVE = {
  bodyweightKg: 78.5,
  injuryNotes: 'left shoulder impingement, avoid overhead pressing',
  email: 'someone@example.com',
  deviceSeed: 'abandon abandon abandon abandon abandon abandon',
  privateKey: '0x' + 'ab'.repeat(32),
  sessionCookie: 'sid=deadbeefcafe',
  mealPhotoBase64: 'iVBORw0KGgoAAAANSUhEUg',
  rawPrompt: 'You are a strength coach. Answer using only the athlete profile',
};

test('nothing sensitive is legible in the bytes that go to 0G Storage', async () => {
  /*
   * The blob is fetchable by root hash by anybody, forever. If a bodyweight or
   * an injury note could be read out of it with `strings`, the whole arrangement
   * would be decorative.
   */
  const payload = { unit: 'kg', sessions: 40, ...SENSITIVE };
  const sealed = await sealForService(payload, servicePublicKeyFrom(SERVICE));
  const asText = new TextDecoder('utf8', { fatal: false }).decode(sealed);

  for (const [field, value] of Object.entries(SENSITIVE)) {
    assert.ok(!asText.includes(String(value)), `the value of ${field} survived into the blob`);
    assert.ok(!asText.includes(field), `the field name ${field} survived into the blob`);
  }

  // And it is genuinely still there for the one key that should see it — a test
  // that only proves bytes are unreadable would pass on random noise.
  assert.deepEqual(await openAsService(sealed, SERVICE), payload);
});

test('one function writes to 0G Storage, and the module graph says so', async () => {
  /*
   * `storeForDevice` is the only door. Every check that matters — that the
   * relayer is funded, that the upload is bounded, that what was written is
   * mirrored — lives inside it, so a second caller reaching the SDK directly
   * would bypass all of them at once and nothing would say so.
   *
   * Asserted over the source rather than by mocking, because the failure this
   * catches is a *new* file nobody thought to mock.
   */
  const here = new URL('./', import.meta.url);
  const files = (await readdir(here)).filter(
    (name) => name.endsWith('.js') && !name.endsWith('.test.js'),
  );

  const writers = [];

  for (const name of files) {
    const source = await readFile(new URL(name, here), 'utf8');
    // The SDK's upload call, however the indexer variable is spelled.
    if (/\b[A-Za-z_$][\w$]*\.upload\s*\(/.test(source)) writers.push(name);
  }

  assert.deepEqual(
    writers,
    ['coach-runtime.js'],
    'something other than coach-runtime.js writes to 0G Storage — every guard in storeForDevice is bypassed by it',
  );
});

test('the server never logs a coach payload, only its root hash', async () => {
  /*
   * A root hash in a log is a pointer to ciphertext and is fine. The plaintext,
   * or the sealed bytes, in a log is the same disclosure as publishing it —
   * platform logs are retained, searchable, and read by more people than the
   * database ever is.
   */
  const here = new URL('./', import.meta.url);
  const files = (await readdir(here)).filter(
    (name) => name.endsWith('.js') && !name.endsWith('.test.js'),
  );

  const offenders = [];

  for (const name of files) {
    const source = await readFile(new URL(name, here), 'utf8');
    for (const [line] of source.matchAll(/^.*console\.(log|warn|error|info)\(.*$/gm)) {
      if (/\b(ciphertext|plaintext|config\b|payload|profile|answer|prompt)\b/.test(line)) {
        offenders.push(`${name}: ${line.trim().slice(0, 90)}`);
      }
    }
  }

  assert.deepEqual(offenders, [], 'a log statement names something that may carry a coach payload');
});
