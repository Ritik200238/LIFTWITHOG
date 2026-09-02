/**
 * Where the server keeps things, and why there are two answers.
 *
 * Everything durable this server owns is small and JSON-shaped: the account
 * list, one blob of training per user, the key that signs session cookies, and
 * the push keypair. That fitted a directory of files perfectly for as long as
 * the server was one long-lived process with a disk under it.
 *
 * It stops fitting the moment the server is a serverless function. There the
 * filesystem is read-only apart from a scratch directory that is thrown away,
 * so every account created would survive exactly until the next request landed
 * on a different instance. Not slowly degraded — gone.
 *
 * So the same four operations get two implementations behind one interface:
 *
 *   files     — a self-hosted instance with a disk, which is still the setup
 *               the compose file describes and the one that owns its own data.
 *   postgres  — a managed database, which is what makes the server stateless
 *               enough to run anywhere, serverless included.
 *
 * The backend is chosen by whether DATABASE_URL is set, so neither deployment
 * has to know the other exists.
 */

import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** The four things worth keeping, as keys both backends agree on. */
const DB = 'db';
const SECRET = 'secret';
const VAPID = 'vapid';
const stateKey = (uid) => `state:${uid}`;
/**
 * A coach blob we have already paid to store on 0G, kept as a second copy.
 *
 * 0G Storage is the canonical home and the chain records the root hash, so this
 * is not a source of truth — it is the answer to a storage node dropping a blob
 * before it replicates, which leaves a coach whose `configURI` points at
 * something the indexer cannot find. The chain would keep that dead pointer
 * forever, and the coach could never answer again.
 */
const blobKey = (root) => `blob:${String(root).toLowerCase()}`;

/** An account list that has every field the server reads. */
const emptyDb = () => ({ users: [], creds: [], subs: [], invites: [] });

/**
 * Is this a push keypair the push library will actually accept?
 *
 * Stored keys are read back and handed straight to `setVapidDetails`, which
 * throws on anything malformed — at boot, before the server listens. That
 * turns one bad row into a service that will not start, with a stack trace
 * about byte lengths rather than about storage.
 *
 * A public key is an uncompressed P-256 point: 65 bytes, base64url-encoded.
 * Anything else is not a key that got slightly damaged, it is not a key, and
 * the only way forward is a new pair.
 */
function usableVapid(value) {
  if (!value || typeof value.publicKey !== 'string' || typeof value.privateKey !== 'string') return false;
  try {
    return Buffer.from(value.publicKey, 'base64url').length === 65;
  } catch {
    return false;
  }
}

const freshSecret = () => crypto.randomBytes(32).toString('hex');

/**
 * The session key that was committed to this repository by mistake.
 *
 * It signs every session cookie, so anyone who read that commit could mint one
 * for any account on any instance still using it. Recorded as a hash, because
 * writing the value here to detect the value would put it back in the
 * repository it is being removed from.
 */
export const LEAKED_SECRET_SHA256 =
  '72bb661b20b167f89ff7bc4e6e5a08a27e8359dc48877a5843e9c05a64ba7534';

const sha256 = (text) => crypto.createHash('sha256').update(String(text).trim()).digest('hex');

/**
 * A session key, replacing the published one on sight.
 *
 * Replaced rather than warned about: a warning in a log is read by nobody, and
 * the failure it describes is silent account takeover. Everybody signed in is
 * signed out once, which is the cheap half of this.
 */
function usableSecret(stored, onRotate) {
  if (!stored) {
    const made = freshSecret();
    onRotate(made);
    return made;
  }

  if (sha256(stored) === LEAKED_SECRET_SHA256) {
    const made = freshSecret();
    onRotate(made);
    console.warn(
      '[security] The session key in storage is the one committed to this repository. ' +
        'It has been replaced with a fresh one and everybody has been signed out.',
    );
    return made;
  }

  return stored;
}

/* ------------------------------------------------------------------ files */

function fileStore(dir) {
  fs.mkdirSync(dir, { recursive: true });

  /** Rate-limit windows, keyed `bucket:key`. See `limit` below. */
  const windows = new Map();

  const file = (name) => path.join(dir, name);
  const stateFile = (uid) => file('state-' + String(uid).replace(/[^a-zA-Z0-9_-]/g, '') + '.json');

  /** Write through a temporary file, so a crash mid-write cannot truncate the real one. */
  const atomicWrite = (target, content, mode) => {
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, content, mode ? { mode } : undefined);
    fs.renameSync(tmp, target);
  };

  return {
    kind: 'files',

    async init() {},

    async getSecret() {
      const secretFile = file('secret');
      const stored = fs.existsSync(secretFile) ? fs.readFileSync(secretFile, 'utf8').trim() : null;
      return usableSecret(stored, (made) => atomicWrite(secretFile, made, 0o600));
    },

    async getVapid(generate) {
      const vapidFile = file('vapid.json');
      let stored = null;
      try { stored = JSON.parse(fs.readFileSync(vapidFile, 'utf8')); } catch {}
      if (usableVapid(stored)) return stored;

      // Regenerating signs everybody out of push notifications, which is the
      // lesser loss: the alternative is a server that cannot start at all.
      if (stored) console.warn('[push] The stored VAPID keypair is unusable; generating a new one.');
      const made = generate();
      atomicWrite(vapidFile, JSON.stringify(made), 0o600);
      return made;
    },

    async loadDb() {
      try {
        const parsed = JSON.parse(fs.readFileSync(file('db.json'), 'utf8'));
        return { ...emptyDb(), ...parsed };
      } catch {
        return emptyDb();
      }
    },

    async saveDb(db) {
      atomicWrite(file('db.json'), JSON.stringify(db, null, 2));
    },

    /**
     * Someone's stored training: null when there genuinely is none, a throw
     * when it cannot be read.
     *
     * This used to swallow every failure and return null, which made "this
     * account is new" and "this account's file is unreadable" the same answer.
     * They call for opposite responses: the first invites the client to push,
     * the second must stop it, because pushing is what replaces the data that
     * could not be read.
     */
    async readState(uid) {
      const target = stateFile(uid);
      if (!fs.existsSync(target)) return null;
      return JSON.parse(fs.readFileSync(target, 'utf8'));
    },

    async writeState(uid, state) {
      atomicWrite(stateFile(uid), JSON.stringify(state));
    },

    /**
     * A sliding window, held in memory.
     *
     * Correct here precisely because this backend implies one long-lived
     * process: there is exactly one copy of the counter, and a restart
     * resetting it is the same event as the server being unable to spend
     * anything anyway.
     */
    async readBlob(root) {
      const target = file('blob-' + String(root).replace(/[^a-zA-Z0-9]/g, '') + '.bin');
      if (!fs.existsSync(target)) return null;
      return new Uint8Array(fs.readFileSync(target));
    },

    async writeBlob(root, bytes) {
      atomicWrite(
        file('blob-' + String(root).replace(/[^a-zA-Z0-9]/g, '') + '.bin'),
        Buffer.from(bytes),
      );
    },

    async limit({ bucket, key, max, windowMs, now = Date.now() }) {
      const id = `${bucket}:${key}`;

      for (const [k, times] of windows) {
        const live = times.filter((t) => now - t < windowMs);
        if (live.length === 0) windows.delete(k);
        else windows.set(k, live);
      }

      const times = (windows.get(id) ?? []).filter((t) => now - t < windowMs);
      if (times.length >= max) return false;

      times.push(now);
      windows.set(id, times);
      return true;
    },

    async resetLimits() {
      windows.clear();
    },
  };
}

/* --------------------------------------------------------------- postgres */

/**
 * One table of JSON, deliberately.
 *
 * A schema per record type would be the textbook answer, and it would buy
 * nothing here: nothing is queried by field, nothing is joined, and the server
 * already reads and writes each of these as one whole document. A key-value
 * table keeps the two backends the same shape, so the file store stays a real
 * option rather than a legacy path nobody tests.
 */
function postgresStore(databaseUrl) {
  let sql = null;

  const connect = async () => {
    if (sql) return sql;
    const { neon } = await import('@neondatabase/serverless');
    sql = neon(databaseUrl);
    return sql;
  };

  const read = async (key) => {
    const q = await connect();
    const rows = await q`select v from kv where k = ${key}`;
    return rows.length ? rows[0].v : null;
  };

  const write = async (key, value) => {
    const q = await connect();
    await q`
      insert into kv (k, v, updated_at) values (${key}, ${JSON.stringify(value)}, now())
      on conflict (k) do update set v = excluded.v, updated_at = now()
    `;
  };

  return {
    kind: 'postgres',

    async init() {
      const q = await connect();
      await q`
        create table if not exists kv (
          k text primary key,
          v jsonb not null,
          updated_at timestamptz not null default now()
        )
      `;
      await q`
        create table if not exists rate_counter (
          bucket text not null,
          k text not null,
          window_start timestamptz not null,
          n integer not null default 0,
          primary key (bucket, k, window_start)
        )
      `;
    },

    async getSecret() {
      const stored = await read(SECRET);
      let rotated = null;
      const value = usableSecret(stored, (made) => { rotated = made; });
      if (rotated !== null) await write(SECRET, rotated);
      return value;
    },

    async getVapid(generate) {
      const stored = await read(VAPID);
      if (usableVapid(stored)) return stored;

      if (stored) console.warn('[push] The stored VAPID keypair is unusable; generating a new one.');
      const made = generate();
      await write(VAPID, made);
      return made;
    },

    async loadDb() {
      const stored = await read(DB);
      return stored ? { ...emptyDb(), ...stored } : emptyDb();
    },

    async saveDb(db) {
      await write(DB, db);
    },

    /**
     * Same contract as the file backend: null for "no data", a throw for
     * "could not read it". A failed query throws on its own, which is exactly
     * the behaviour wanted — the caller must not treat a database outage as an
     * empty account and invite the client to overwrite it.
     */
    async readState(uid) {
      return await read(stateKey(uid));
    },

    async writeState(uid, state) {
      await write(stateKey(uid), state);
    },

    /*
     * Base64 in the same jsonb table rather than a bytea column, so the two
     * backends keep the one shape and there is no migration to forget. A coach
     * blob is a few hundred bytes; this is not where size becomes interesting.
     */
    async readBlob(root) {
      const stored = await read(blobKey(root));
      if (!stored?.b64) return null;
      return new Uint8Array(Buffer.from(stored.b64, 'base64'));
    },

    async writeBlob(root, bytes) {
      await write(blobKey(root), { b64: Buffer.from(bytes).toString('base64') });
    },

    /**
     * A counter every instance shares, incremented atomically.
     *
     * This is the reason the whole limiter moved into the store. Held in
     * process memory it was correct on a long-lived server and useless on a
     * serverless one: each cold instance starts at zero, so the relayer's
     * spending cap was really "twelve per hour, per instance somebody can
     * cause to be created" — and the wallet it protects holds real money on
     * mainnet.
     *
     * One statement, so concurrent requests serialise on the row rather than
     * racing between a read and a write. Fixed windows rather than sliding:
     * sliding needs read-then-write, which is exactly the race being removed
     * here. The honest cost is the boundary — someone can spend a window's
     * worth at 10:59 and another at 11:00. Sustained throughput is still
     * capped at `max` per window, which is what protects the balance.
     */
    async limit({ bucket, key, max, windowMs, now = Date.now() }) {
      const q = await connect();
      const windowStart = new Date(Math.floor(now / windowMs) * windowMs);

      const rows = await q`
        insert into rate_counter (bucket, k, window_start, n)
        values (${bucket}, ${String(key)}, ${windowStart.toISOString()}, 1)
        on conflict (bucket, k, window_start)
          do update set n = rate_counter.n + 1
        returning n
      `;

      // Old windows are dead weight; clearing them opportunistically avoids a
      // scheduled job for a table that is small by construction.
      if (Math.random() < 0.02) {
        await q`delete from rate_counter where window_start < now() - interval '2 hours'`;
      }

      return Number(rows[0].n) <= max;
    },

    async resetLimits() {
      const q = await connect();
      await q`delete from rate_counter`;
    },
  };
}

/**
 * The store this process should use.
 *
 * DATABASE_URL decides. Nothing else in the server knows which one it got.
 */
export function createStore({ databaseUrl = process.env.DATABASE_URL, dataDir } = {}) {
  return databaseUrl ? postgresStore(databaseUrl) : fileStore(dataDir || defaultDataDir());
}

/**
 * Where files go when nothing says otherwise.
 *
 * `/data` was the default, and it is the right path in the container — the
 * image sets DATA_DIR to it and render.yaml mounts a disk there, so production
 * is unaffected by this. Everywhere else it was wrong in two directions at
 * once: on Linux it is root-owned, so importing a module that made a store
 * failed outright, and on Windows it resolves to the root of the current drive,
 * where it had quietly been accumulating storage blobs for weeks. Neither is
 * something a person running the tests asked for.
 *
 * The fallback is inside the server directory instead, next to the code that
 * writes it, ignored by git, and removable without thinking about it.
 */
export function defaultDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '.data');
}
