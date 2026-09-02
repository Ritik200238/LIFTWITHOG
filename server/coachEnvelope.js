/**
 * How a coach's brain is sealed, and why there is exactly one copy of this code.
 *
 * The device holds the training history and has no funds; the server pays to
 * store it and must be able to read it back, because the inference that answers
 * a question runs server-side inside a TEE. Those two facts decide the whole
 * design: the blob has to be unreadable to the storage network and to anybody
 * who fetches it by root hash, and readable to exactly one key — this service.
 *
 * The first attempt at that had the device encrypt under its own wallet-derived
 * key while the server decrypted under a key derived from COACH_SERVICE_KEY.
 * Different keys, and — separately — different byte layouts, because WebCrypto
 * appends the GCM tag to the ciphertext and node's crypto hands it back through
 * `getAuthTag()`. Every coach a real person created answered
 * "This coach cannot be opened by this server." The tests passed the whole time,
 * because each side was tested against its own encrypt.
 *
 * So: one file, imported by both halves, running the same bytes through the
 * same steps. It uses `ethers` and WebCrypto and nothing else — both of which
 * exist in a browser and in Node 18+ — precisely so that no second
 * implementation can exist to drift from this one. `coachEnvelope.test.js`
 * seals with the browser path and opens with the server path in one test.
 *
 * ## The shape
 *
 * Envelope encryption, rather than encrypting straight to the service key:
 *
 *   - the device invents a fresh content key for this coach and encrypts the
 *     profile under it;
 *   - it then wraps that content key for the service's public key.
 *
 * The difference matters. Encrypting directly to the service key would mean the
 * device never holds a key at all — it would just be handing plaintext to a
 * shape the server chose. Here the device generates the content key, and
 * wrapping it for the service is a decision the device makes per coach. The
 * same sealed blob can later be re-wrapped for a renter, or for a TEE's own
 * key, without re-encrypting the profile or changing what the chain hashed.
 *
 * ## The bytes
 *
 *   offset  size  field
 *        0     5  magic       ASCII "LWOG1"
 *        5     1  version     0x01
 *        6    33  ephPub      compressed secp256k1 point, the sender's one-shot key
 *       39    12  wrapIv      AES-GCM nonce for the key wrap
 *       51    48  wrapped     AES-GCM(kek, cek) — 32 bytes of key, 16 of tag
 *       99    12  dataIv      AES-GCM nonce for the payload
 *      111     …  data        AES-GCM(cek, utf8(json)) — ciphertext then tag
 *
 *   kek = SHA-256( ECDH(ephPriv, servicePub) )
 *
 * The ephemeral key is generated per seal and thrown away, so the same profile
 * sealed twice shares no bytes and the wrap cannot be replayed onto another
 * blob. The magic prefix is what lets `looksSealed` tell this format from the
 * coaches seeded before it existed, which are still on chain and still open.
 */

import { ethers } from 'ethers';

/** ASCII "LWOG1" — the first five bytes of every envelope this module writes. */
const MAGIC = Uint8Array.from([0x4c, 0x57, 0x4f, 0x47, 0x31]);

const VERSION = 0x01;

/*
 * Fixed field widths, named once. Read as offsets in the table above.
 * A wrapped 32-byte key is 48 bytes because GCM appends a 16-byte tag.
 */
const EPH_PUB_LEN = 33;
const IV_LEN = 12;
const WRAPPED_LEN = 48;
const HEADER_LEN = MAGIC.length + 1 + EPH_PUB_LEN + IV_LEN + WRAPPED_LEN + IV_LEN; // 111

/**
 * WebCrypto, from wherever this is running.
 *
 * Fetched through a function rather than destructured at import time: in some
 * bundler configurations `globalThis.crypto` is installed by a polyfill that
 * runs after module evaluation, and capturing it early captures `undefined`.
 */
function subtle() {
  const webcrypto = globalThis.crypto;
  if (!webcrypto?.subtle) {
    throw new Error('WebCrypto is not available here, so a coach cannot be sealed or opened.');
  }
  return webcrypto.subtle;
}

function randomBytes(length) {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

const utf8 = (text) => new TextEncoder().encode(text);

/** Hex (0x-prefixed or not) to bytes, without depending on Buffer. */
function fromHex(hex) {
  const clean = String(hex).replace(/^0x/i, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const toHex = (bytes) =>
  '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The key-encrypting key both sides arrive at independently.
 *
 * `computeSharedSecret` returns the full uncompressed point (65 bytes, 0x04 and
 * then X and Y). Hashing all of it rather than X alone is a choice, not an
 * oversight: it is one call on both sides with nothing to slice wrongly, and
 * SHA-256 over the whole point is as sound an input as SHA-256 over half of it.
 * What matters is that these three lines are the only place it is derived.
 */
async function keyEncryptionKey(privateKey, otherPublicKey) {
  const shared = new ethers.SigningKey(privateKey).computeSharedSecret(otherPublicKey);
  const digest = await subtle().digest('SHA-256', fromHex(shared));
  return new Uint8Array(digest);
}

const importAesKey = (raw, usage) =>
  subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, [usage]);

/**
 * Seal a value for the service that will run the coach.
 *
 * `servicePublicKey` is the service wallet's public key, compressed or not —
 * the caller gets it from `GET /api/coach/pubkey` rather than hardcoding it, so
 * rotating the service key does not strand every device on an old one.
 *
 * Returns the bytes to store on 0G Storage. The hash anchored on chain covers
 * exactly these bytes, which is what makes "is this the blob that was written"
 * answerable years later by somebody who trusts neither us nor the network.
 */
export async function sealForService(value, servicePublicKey) {
  if (!servicePublicKey) {
    throw new Error('No service public key, so there is nothing to seal this coach for.');
  }

  // One-shot sender key. Never stored, never reused, gone when this returns.
  const ephemeral = ethers.Wallet.createRandom();
  const ephemeralSigning = new ethers.SigningKey(ephemeral.privateKey);

  const cek = randomBytes(32);
  const kek = await keyEncryptionKey(ephemeral.privateKey, servicePublicKey);

  const wrapIv = randomBytes(IV_LEN);
  const wrapped = new Uint8Array(
    await subtle().encrypt(
      { name: 'AES-GCM', iv: wrapIv },
      await importAesKey(kek, 'encrypt'),
      cek,
    ),
  );

  const dataIv = randomBytes(IV_LEN);
  const data = new Uint8Array(
    await subtle().encrypt(
      { name: 'AES-GCM', iv: dataIv },
      await importAesKey(cek, 'encrypt'),
      utf8(JSON.stringify(value)),
    ),
  );

  const ephPub = fromHex(ephemeralSigning.compressedPublicKey);

  const out = new Uint8Array(HEADER_LEN + data.length);
  let at = 0;
  const put = (bytes) => { out.set(bytes, at); at += bytes.length; };

  put(MAGIC);
  out[at] = VERSION; at += 1;
  put(ephPub);
  put(wrapIv);
  put(wrapped);
  put(dataIv);
  put(data);

  return out;
}

/**
 * Is this one of ours?
 *
 * Called before `openAsService` so that a blob written by the seeding script —
 * which predates this format and is still referenced by coaches on chain — can
 * be routed to the older reader instead of failing an authentication tag and
 * being reported as tampering.
 */
export function looksSealed(bytes) {
  const view = new Uint8Array(bytes);
  if (view.length < HEADER_LEN) return false;
  for (let i = 0; i < MAGIC.length; i += 1) {
    if (view[i] !== MAGIC[i]) return false;
  }
  return view[MAGIC.length] === VERSION;
}

/**
 * Open an envelope with the service private key.
 *
 * Throws a plain `Error` on anything malformed; the caller decides what an
 * unreadable coach means to the person waiting on it. GCM failing here is not
 * ambiguous — the bytes were altered, or they were never sealed for this key.
 */
export async function openAsService(bytes, servicePrivateKey) {
  const view = new Uint8Array(bytes);
  if (!looksSealed(view)) {
    throw new Error('These bytes are not a LWOG1 coach envelope.');
  }

  let at = MAGIC.length + 1;
  const take = (n) => { const slice = view.subarray(at, at + n); at += n; return slice; };

  const ephPub = take(EPH_PUB_LEN);
  const wrapIv = take(IV_LEN);
  const wrapped = take(WRAPPED_LEN);
  const dataIv = take(IV_LEN);
  const data = view.subarray(at);

  const kek = await keyEncryptionKey(servicePrivateKey, toHex(ephPub));

  const cek = new Uint8Array(
    await subtle().decrypt(
      { name: 'AES-GCM', iv: wrapIv },
      await importAesKey(kek, 'decrypt'),
      wrapped,
    ),
  );

  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv: dataIv },
    await importAesKey(cek, 'decrypt'),
    data,
  );

  return JSON.parse(new TextDecoder().decode(plain));
}

/** The public key a device seals to, derived from the service's private key. */
export function servicePublicKeyFrom(privateKey) {
  return new ethers.SigningKey(privateKey).compressedPublicKey;
}
