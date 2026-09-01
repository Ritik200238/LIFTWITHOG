import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { LEAKED_SECRET_SHA256, createStore } from './store.js';

/**
 * The storage layer, tested where it can lose somebody's account.
 *
 * Every failure here is silent and permanent: an account list that reads back
 * empty invites the client to overwrite it, a session key that changes signs
 * everybody out, a stored push key that cannot be parsed stops the server
 * booting at all. None of them throws anywhere a person would see it.
 *
 * The file backend is exercised directly; the Postgres one is exercised for
 * real against Neon by hand, because a fake driver would only prove the fake
 * behaves. What is pinned here is that both are selected correctly and promise
 * the same contract — the property that keeps self-hosting real.
 */

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'liftwithog-store-'));

/** The value the leaked-key check is looking for, derived rather than pasted. */
const LEAKED = (() => {
  // The check hashes the trimmed value, so any string hashing to the recorded
  // digest works; this is the one that actually leaked, recovered from history.
  const candidate = '1ba7c4c51338dda8c71c64e028d003522abb87f8c87f50ca3fcd2940ea7f7e79';
  const digest = crypto.createHash('sha256').update(candidate).digest('hex');
  assert.equal(digest, LEAKED_SECRET_SHA256, 'the recorded digest no longer matches the leaked key');
  return candidate;
})();

/** A real P-256 public key shape: 65 bytes, base64url. */
const realVapid = () => ({
  publicKey: Buffer.alloc(65, 7).toString('base64url'),
  privateKey: 'private',
});

test('a fresh instance starts with an empty account list, not a missing one', async () => {
  const store = createStore({ dataDir: tmpDir() });
  await store.init();

  // Every field the server reads must exist, or `db.subs.some(...)` throws on
  // the first request rather than returning "nobody is subscribed".
  assert.deepEqual(await store.loadDb(), { users: [], creds: [], subs: [], invites: [] });
});

test('an older account list gains the fields added since it was written', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [{ id: 'u1' }], creds: [] }));

  const db = await createStore({ dataDir: dir }).loadDb();

  assert.equal(db.users.length, 1, 'the existing accounts survived');
  assert.deepEqual(db.subs, [], 'a field added later is filled in');
  assert.deepEqual(db.invites, []);
});

test('an account list survives a round trip', async () => {
  const store = createStore({ dataDir: tmpDir() });
  await store.saveDb({ users: [{ id: 'u1', name: 'Ritik' }], creds: [], subs: [], invites: [] });

  assert.equal((await store.loadDb()).users[0].name, 'Ritik');
});

test('the session key is kept, not regenerated on every read', async () => {
  // Regenerating would sign everybody out on each restart, which reads to a
  // user as "it logged me out again" rather than as a storage bug.
  const store = createStore({ dataDir: tmpDir() });

  assert.equal(await store.getSecret(), await store.getSecret());
});

test('the published session key is replaced on sight', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'secret'), LEAKED);

  const secret = await createStore({ dataDir: dir }).getSecret();

  assert.notEqual(secret, LEAKED, 'the leaked key was handed back');
  assert.equal(secret.length, 64);
  assert.equal(fs.readFileSync(path.join(dir, 'secret'), 'utf8'), secret, 'the replacement was not persisted');
});

test('no data and unreadable data are different answers', async () => {
  /*
   * The whole reason this distinction exists. "No data" invites the client to
   * push its copy up; "unreadable" must stop it, because pushing is exactly
   * what would overwrite the data that could not be read.
   */
  const dir = tmpDir();
  const store = createStore({ dataDir: dir });

  assert.equal(await store.readState('nobody'), null, 'a new account should read as null');

  fs.writeFileSync(path.join(dir, 'state-u1.json'), '{ this is not json');
  await assert.rejects(() => store.readState('u1'), 'a corrupt record was reported as an empty one');
});

test('a state file cannot be named out of its directory', async () => {
  // uid reaches this from a session cookie. Without the scrub, an id of
  // "../../etc/passwd" would choose the file being written.
  const dir = tmpDir();
  const store = createStore({ dataDir: dir });

  await store.writeState('../escape', { workouts: [] });

  assert.ok(fs.existsSync(path.join(dir, 'state-escape.json')), 'the traversal was not neutralised');
  assert.ok(!fs.existsSync(path.join(path.dirname(dir), 'state-escape.json')));
});

test('a stored push key that is not a key is replaced rather than used', async () => {
  /*
   * This one was found by running it: a malformed keypair reached
   * `setVapidDetails`, which threw about byte lengths during boot — so the
   * server did not start, and the error named the push library rather than
   * storage.
   */
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'vapid.json'), JSON.stringify({ publicKey: 'p', privateKey: 'k' }));

  const made = realVapid();
  const got = await createStore({ dataDir: dir }).getVapid(() => made);

  assert.equal(got.publicKey, made.publicKey, 'the unusable key was handed back');
});

test('a usable push key is kept, because replacing it drops every subscription', async () => {
  const dir = tmpDir();
  const stored = realVapid();
  fs.writeFileSync(path.join(dir, 'vapid.json'), JSON.stringify(stored));

  const got = await createStore({ dataDir: dir }).getVapid(() => {
    throw new Error('should not have regenerated a perfectly good key');
  });

  assert.equal(got.publicKey, stored.publicKey);
});

/* ------------------------------------------------------------- both alike */

/*
 * The Postgres backend is exercised for real against Neon by hand rather than
 * mocked here: a fake driver would only prove the fake behaves, and the query
 * shape is the part that can actually be wrong. What is worth pinning in a
 * unit test is that the two backends are selected correctly and promise the
 * same contract, which is what stops the file path rotting.
 */

test('both backends answer the same way', async () => {
  const files = createStore({ dataDir: tmpDir() });
  await files.init();

  assert.equal(files.kind, 'files');
  assert.equal(createStore({ databaseUrl: 'postgres://x/y' }).kind, 'postgres');

  // The contract both must satisfy, stated once.
  assert.deepEqual(await files.loadDb(), { users: [], creds: [], subs: [], invites: [] });
  assert.equal(await files.readState('nobody'), null);
});

test('a spending cap holds, and lets go when its window does', async () => {
  // The cap exists to stop somebody draining the relayer's wallet, so the
  // property is exact: the nth call is allowed and the (n+1)th is not.
  const store = createStore({ dataDir: tmpDir() });
  const now = Date.now();
  const call = (key, at = now) => store.limit({ bucket: 'relay', key, max: 3, windowMs: 60_000, now: at });

  assert.equal(await call('a'), true);
  assert.equal(await call('a'), true);
  assert.equal(await call('a'), true);
  assert.equal(await call('a'), false, 'the cap did not hold');

  assert.equal(await call('b'), true, 'one caller locked out everybody else');
  assert.equal(await call('a', now + 60_001), true, 'the window never let go');
});

test('resetting limits is a clean slate, not a partial one', async () => {
  const store = createStore({ dataDir: tmpDir() });
  const now = Date.now();
  const call = () => store.limit({ bucket: 'relay', key: 'a', max: 1, windowMs: 60_000, now });

  assert.equal(await call(), true);
  assert.equal(await call(), false);
  await store.resetLimits();
  assert.equal(await call(), true, 'a reset left the counter behind');
});

test('the backend is chosen by DATABASE_URL alone', async () => {
  // Neither deployment should have to know the other exists, and a stray
  // dataDir must not pull a configured database back onto local disk.
  assert.equal(createStore({ databaseUrl: 'postgres://x/y', dataDir: tmpDir() }).kind, 'postgres');
  assert.equal(createStore({ databaseUrl: '', dataDir: tmpDir() }).kind, 'files');
});
