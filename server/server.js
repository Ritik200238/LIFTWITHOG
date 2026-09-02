/* og-fitness-api — passkey (WebAuthn) auth + per-user state storage for LIFTWITHOG
   No framework, JSON-file storage, signed session cookies.               */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import webpush from 'web-push';
import { CoachError, advise, leaksConfig, readCoachRecord, recall } from './coach.js';
import { listing, quote, redeem } from './x402.js';
import { publish as publishCard, verify as verifyCard } from './progressCard.js';
import {
  RelayError,
  callerIp,
  relayEvolve,
  relayMint,
  relaySetPrice,
  withinQuestionLimit,
  withinStoreLimit,
} from './relayer.js';
import {
  coachCreatedAt,
  fetchCardBytes,
  loadConfigFromStorage,
  runOn0GCompute,
  servicePublicKey,
  storeForDevice,
} from './coach-runtime.js';
import { isStaleWrite, stampFor } from './sync.js';
import { createStore } from './store.js';

const PORT = +(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || '/data';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';
const RP_NAME = process.env.RP_NAME || 'LIFTWITHOG';
// Admin dashboard (issue): admins are matched by uid; INVITE_ONLY gates new signups behind a
// code the admin generates. Both default off so a fresh self-hosted instance stays open.
const ADMIN_UIDS = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const INVITE_ONLY = /^(1|true|yes|on)$/i.test(process.env.INVITE_ONLY || '');
// 90 days keeps someone who trains a few times a week permanently signed in without a stolen
// cookie staying good for a year. Overridable because a family instance and one on the open
// internet don't want the same number. Only affects cookies minted from now on — the expiry is
// baked into each cookie when it's issued, so lowering this never cuts an existing session short.
const SESSION_DAYS = Math.max(1, +(process.env.SESSION_DAYS || 90) || 90);
const MAX_BODY = 5 * 1024 * 1024;
// Secure cookies require HTTPS; over plain http://localhost the flag would drop the cookie
const SECURE = /^https:/i.test(ORIGIN) ? ' Secure;' : '';

const VAPID_SUBJECT = process.env.VAPID_SUBJECT || (SECURE ? ORIGIN : 'mailto:admin@localhost');

/*
 * Storage lives behind `store` now — files when this runs on a machine with a
 * disk, Postgres when DATABASE_URL is set and the disk is a lie (serverless).
 * See store.js for why both exist.
 */
const store = createStore({ dataDir: DATA });

let db = { users: [], creds: [], subs: [], invites: [] };
let SECRET = null;
let vapid = null;

const isAdmin = user => !!user && (user.admin === true || ADMIN_UIDS.includes(user.id));
const saveDb = () => store.saveDb(db);
const readState = uid => store.readState(uid);
const writeState = (uid, state) => store.writeState(uid, state);

/**
 * Everything this process needs before it can answer anything.
 *
 * Awaited once per cold start by the long-lived server, and once per instance
 * by a serverless one. `db` is re-read on every request there instead — see
 * `ready()` — because two functions serving two requests do not share memory,
 * and a stale copy would silently drop whatever the other one wrote.
 */
let booted = null;
async function boot() {
  await store.init();
  SECRET = await store.getSecret();
  vapid = await store.getVapid(() => webpush.generateVAPIDKeys());
  db = await store.loadDb();
  webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);
}

/** Called at the top of every request. Cheap when already warm. */
export async function ready({ reloadDb = false } = {}) {
  if (!booted) booted = boot();
  await booted;
  if (reloadDb) db = await store.loadDb();
}

async function sendPush(userId, payload) {
  const subs = db.subs.filter(s => s.userId === userId);
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  let dirty = false;
  await Promise.all(subs.map(async sub => {
    // urgency 'high' is the one lever we have over delivery speed — iOS/Android throttle
    // low-urgency background push more aggressively under battery-saving modes. TTL is left
    // at the library default (long) so a briefly-offline device still gets it once reconnected,
    // rather than risking it being dropped for the sake of shaving off latency that TTL doesn't
    // actually control anyway.
    try { await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body, { urgency: 'high' }); }
    catch (e) {
      console.error('push send failed', userId, e.statusCode, e.body || e.message);
      if (e.statusCode === 404 || e.statusCode === 410) {
        db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint); dirty = true;
      }
    }
  }));
  if (dirty) await saveDb();
}

// Rest-timer alerts: client schedules on start/extend, cancels on skip or on-screen completion —
// this only fires when the tab was backgrounded/suspended and never got to cancel it itself.
const restTimers = new Map(); // userId -> Timeout
function scheduleRestTimer(userId, sec) {
  const t = restTimers.get(userId);
  if (t) clearTimeout(t);
  restTimers.set(userId, setTimeout(() => {
    restTimers.delete(userId);
    sendPush(userId, { title: 'Rest over 💪', body: 'Time for your next set.', tag: 'rest-timer' });
  }, sec * 1000));
}
function cancelRestTimer(userId) {
  const t = restTimers.get(userId);
  if (t) { clearTimeout(t); restTimers.delete(userId); }
}

// "Workout planned today" reminder — one per user per day, at their chosen time.
// Duplicated (not imported) from frontend/src/lib/history.js effectiveRoutineId — tiny pure helper, not worth sharing across the two runtimes.
function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan?.[iso];
  if (ov === 'rest') return null;
  if (ov && S.routines?.some(r => r.id === ov)) return ov;
  const wd = new Date(iso + 'T12:00:00').getDay();
  return S.week?.[wd] || null;
}
// Computes "now" in an arbitrary IANA zone (e.g. "Europe/Lisbon") instead of the server's own —
// each user's reminder fires by their own clock, wherever they and their phone actually are.
function userNow(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    const g = t => parts.find(p => p.type === t)?.value;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, hhmm: `${g('hour')}:${g('minute')}` };
  } catch { return null; } // unknown/invalid tz string — skip this user rather than guess
}
/*
 * The reminder sweep. Async now because storage is: it reads each user's plan
 * to decide whether today is a training day.
 *
 * Only the long-lived server runs this — a serverless deployment has no
 * process between requests to run a timer in, and would need a scheduled
 * invocation instead.
 */
/**
 * Everybody whose reminder is due right now, reminded.
 *
 * Extracted from the timer so both deployments can run the same sweep: a
 * long-lived server ticks it itself, and a serverless one is poked by a
 * scheduler (see the cron route below). The logic must not fork — a reminder
 * that fires on one deployment and not the other is a bug nobody can
 * reproduce.
 *
 * `lastReminder` is the guard against sending twice, and it is written before
 * the push rather than after: a crash between the two costs somebody one
 * notification, while the other order costs them the same notification every
 * ten seconds until the day rolls over.
 */
export async function sweepReminders() {
  let sent = 0;

  for (const user of db.users) {
    if (!db.subs.some(s => s.userId === user.id)) continue;
    let S;
    // One unreadable record must not stop reminders for everybody else.
    try { S = await readState(user.id); } catch { continue; }
    if (!S?.reminder?.on) continue;
    const now = userNow(S.reminder.tz || 'UTC');
    if (!now || S.reminder.time !== now.hhmm) continue;
    if (user.lastReminder === now.date) continue;
    if ((S.workouts || []).some(w => w.d === now.date)) continue;
    const rid = effectiveRoutineId(S, now.date);
    if (!rid) continue; // rest day — nothing planned
    const routine = (S.routines || []).find(r => r.id === rid);

    console.log('reminder firing', user.id, rid);
    user.lastReminder = now.date;
    await saveDb();
    sendPush(user.id, {
      title: routine ? `${routine.emoji || '🏋️'} ${routine.name} today` : 'Workout planned today',
      body: "It's on your plan — let's go 💪",
      tag: 'day-reminder'
    });
    sent += 1;
  }

  return { sent, checked: db.users.length };
}

/*
 * Only a process that stays alive can hold a timer. Checked every 10s rather
 * than 60s: ticks are not aligned to the top of the minute, so a 60s interval
 * could sit on the target minute for up to 59 seconds before noticing.
 */
if (!process.env.VERCEL) {
  setInterval(() => { sweepReminders().catch((e) => console.error('reminder sweep failed:', e)); }, 10000).unref();
}

/* ---------- sessions (signed cookie) ---------- */
function sign(payload) {
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + mac;
}
function verifySig(token) {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  } catch { return null; }
  return payload;
}
// Session payload is `<uid>:<expiry>:<version>`, where the version is the user's `sv` counter.
// Bumping `sv` (POST /api/logout/all) makes every cookie ever handed out for that account stop
// verifying, which is the only revocation there was before short of deleting ./data/secret and
// signing out the whole instance. Cookies minted before `sv` existed have no third field and are
// read as version 0, matching a user who has never bumped — they stay valid until they expire.
const sessionVersion = user => user.sv || 0;
function makeSession(user) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  return sign(user.id + ':' + exp + ':' + sessionVersion(user));
}
function readSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => {
    const i = c.indexOf('='); return i < 0 ? ['', ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
  }));
  const tok = cookies.gymsid;
  if (!tok) return null;
  const payload = verifySig(tok);
  if (!payload) return null;
  const [uid, exp, ver] = payload.split(':');
  if (!uid || +exp < Date.now()) return null;
  const user = db.users.find(u => u.id === uid) || null;
  if (!user) return null;
  if (user.disabled) return null;           // disabled accounts are locked out everywhere
  // Missing third field = pre-versioning cookie = version 0. Anything non-numeric is a malformed
  // payload (it still had to pass the HMAC, so this is belt-and-braces) and is refused outright.
  const claimed = ver === undefined ? 0 : Number(ver);
  if (!Number.isInteger(claimed) || claimed !== sessionVersion(user)) return null;
  return user;
}
// Guard for /api/admin/* — resolves the caller and 401/403s if they aren't an admin.
function requireAdmin(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  if (!isAdmin(user)) { json(res, 403, { error: 'forbidden' }); return null; }
  return user;
}
function sessionCookie(user) {
  return `gymsid=${makeSession(user)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly;${SECURE} SameSite=Lax`;
}
const clearCookie = `gymsid=; Path=/; Max-Age=0; HttpOnly;${SECURE} SameSite=Lax`;

/* ---------- challenge store (in-memory, 5 min TTL) ---------- */
const challenges = new Map(); // cid -> {challenge, name?, uid?, exp}
function putChallenge(data) {
  const cid = crypto.randomBytes(16).toString('base64url');
  challenges.set(cid, { ...data, exp: Date.now() + 5 * 60000 });
  return cid;
}
function takeChallenge(cid) {
  const c = challenges.get(cid);
  challenges.delete(cid);
  if (!c || c.exp < Date.now()) return null;
  return c;
}
setInterval(() => { for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k); }, 60000).unref();

/* ---------- helpers ---------- */
function json(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extraHeaders || {}) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => {
      size += d.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
const b64uToBuf = s => Buffer.from(s, 'base64url');

/* ---------- live presence (in-memory) ---------- */
// Clients heartbeat /api/activity while a workout is on screen; the admin dashboard reads who's
// live. Purely ephemeral — never persisted. Expires shortly after the last ping.
const presence = new Map();               // uid -> { name, exIdx, exTotal, setsDone, setsTotal, startedAt, updatedAt }
const PRESENCE_TTL = 70000;               // ~3.5× the 20s client heartbeat
function livePresence(uid) {
  const p = presence.get(uid);
  if (!p) return null;
  if (Date.now() - p.updatedAt > PRESENCE_TTL) { presence.delete(uid); return null; }
  return p;
}
setInterval(() => { for (const [k, v] of presence) if (Date.now() - v.updatedAt > PRESENCE_TTL) presence.delete(k); }, 30000).unref();

/* ---------- routes ---------- */
const routes = {
  'GET /api/health': async (req, res) => json(res, 200, { ok: true, users: db.users.length }),

  // Public config the login screen needs before anyone is signed in.
  'GET /api/config': async (req, res) => json(res, 200, { invite_only: INVITE_ONLY }),

  'GET /api/me': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } });
  },

  'POST /api/register/options': async (req, res) => {
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) return json(res, 400, { error: 'name required' });
    const code = String(body.code || '').trim().toUpperCase();
    if (INVITE_ONLY && !db.invites.some(i => i.code === code && !i.usedBy && !i.revoked))
      return json(res, 403, { error: 'a valid invite code is required' });
    const uid = crypto.randomBytes(12).toString('base64url');
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID,
      userID: Buffer.from(uid), userName: name, userDisplayName: name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge, name, uid, code });
    json(res, 200, { cid, options });
  },

  'POST /api/register/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c || !c.uid) return json(res, 400, { error: 'challenge expired — try again' });
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    const { credential } = verification.registrationInfo;
    if (db.creds.find(x => x.id === credential.id)) return json(res, 409, { error: 'credential already registered' });
    // Re-check the invite at the last moment (it may have been used/revoked since options), then burn it.
    let invite = null;
    if (INVITE_ONLY) {
      invite = db.invites.find(i => i.code === c.code && !i.usedBy && !i.revoked);
      if (!invite) return json(res, 403, { error: 'invite code is no longer valid — ask for a new one' });
    }
    const user = { id: c.uid, name: c.name, created: new Date().toISOString() };
    if (invite) { user.invitedBy = invite.code; invite.usedBy = user.id; invite.usedAt = user.created; }
    db.users.push(user);
    db.creds.push({
      id: credential.id, userId: user.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter || 0,
      transports: body.credential?.response?.transports || []
    });
    await saveDb();
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/login/options': async (req, res) => {
    const options = await generateAuthenticationOptions({
      rpID: RP_ID, userVerification: 'preferred', allowCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge });
    json(res, 200, { cid, options });
  },

  'POST /api/login/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c) return json(res, 400, { error: 'challenge expired — try again' });
    const cred = db.creds.find(x => x.id === body.credential?.id);
    if (!cred) return json(res, 404, { error: 'unknown passkey — create a profile first' });
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false,
        credential: {
          id: cred.id,
          publicKey: b64uToBuf(cred.publicKey),
          counter: cred.counter,
          transports: cred.transports
        }
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    cred.counter = verification.authenticationInfo.newCounter;
    await saveDb();
    const user = db.users.find(u => u.id === cred.userId);
    if (!user) return json(res, 500, { error: 'user missing' });
    if (user.disabled) return json(res, 403, { error: 'this account has been disabled' });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/logout': async (req, res) => json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie }),

  // "Sign out everywhere" — bumps this user's session version, which invalidates every cookie
  // ever issued for the account, on every device, including a copy someone else walked off with.
  // The caller's own cookie is cleared here too, so the browser doing it doesn't sit on a token
  // it no longer accepts. Passkeys are untouched: signing back in works immediately.
  'POST /api/logout/all': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    user.sv = sessionVersion(user) + 1;
    await saveDb();
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  'GET /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    try {
      json(res, 200, { state: await readState(user.id) });
    } catch (e) {
      /*
       * Not `{ state: null }`. Telling a client with a year of training that
       * the server has nothing invites it to push over the file that could not
       * be read — turning a recoverable disk problem into a deletion. An error
       * makes the client keep what it has and try again.
       */
      console.error('state unreadable', user.id, e.message);
      json(res, 500, { error: 'stored data could not be read' });
    }
  },

  'PUT /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (!body.state || typeof body.state !== 'object') return json(res, 400, { error: 'state required' });
    delete body.state.active;              // in-progress workouts stay device-local

    /*
     * A write that is older than what is already here is refused.
     *
     * This accepted anything. A phone that had been offline for a week came
     * back, pushed its week-old copy, and everything logged elsewhere in the
     * meantime was overwritten — silently, because the client had no reason to
     * think the write had done any harm.
     *
     * The current state goes back with the refusal so the client can merge and
     * try again rather than simply failing. No override flag: every client
     * write goes through `persist`, which stamps a fresh `_ts`, so a deliberate
     * restore already carries a newer moment and is never the stale one.
     */
    let existing;
    try {
      existing = await readState(user.id);
    } catch (e) {
      // Same reasoning as the read: an unreadable file is not an absent one,
      // and accepting a write here is what overwrites it.
      console.error('state unreadable', user.id, e.message);
      return json(res, 500, { error: 'stored data could not be read' });
    }

    if (isStaleWrite(body.state, existing)) {
      return json(res, 409, { error: 'stale write', ts: existing._ts || null, state: existing });
    }

    /*
     * The stored moment is clamped, not whatever the client claimed. Writing
     * the raw value back would leave a device with a fast clock holding a
     * timestamp nothing can ever beat, so its copy would become permanent and
     * every honest device would be refused from then on.
     */
    body.state._ts = stampFor(body.state);

    await writeState(user.id, body.state);
    json(res, 200, { ok: true, ts: body.state._ts || null });
  },

  'GET /api/push/public-key': async (req, res) => json(res, 200, { key: vapid.publicKey }),

  'POST /api/push/subscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json(res, 400, { error: 'invalid subscription' });
    db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint);
    db.subs.push({ userId: user.id, endpoint: sub.endpoint, keys: sub.keys, created: new Date().toISOString() });
    await saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/unsubscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    db.subs = db.subs.filter(s => !(s.userId === user.id && s.endpoint === body.endpoint));
    await saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/test': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    await sendPush(user.id, { title: 'LIFTWITHOG', body: 'Test notification ✅ — this is what alerts look like.', tag: 'test' });
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sec = Math.max(1, Math.min(3600, Math.round(+body.seconds || 0)));
    if (!sec) return json(res, 400, { error: 'seconds required' });
    scheduleRestTimer(user.id, sec);
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer/cancel': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    cancelRestTimer(user.id);
    json(res, 200, { ok: true });
  },

  // Live-workout heartbeat: client pings while a workout is on screen; { active:false } drops it.
  'POST /api/activity': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (body.active) {
      presence.set(user.id, {
        name: String(body.name || '').slice(0, 60),
        exIdx: +body.exIdx || 0, exTotal: +body.exTotal || 0,
        setsDone: +body.setsDone || 0, setsTotal: +body.setsTotal || 0,
        startedAt: +body.startedAt || Date.now(),
        updatedAt: Date.now()
      });
    } else presence.delete(user.id);
    json(res, 200, { ok: true });
  },

  /* ---------- admin dashboard ---------- */
  // One row per user, cheap enough for a personal instance (reads each state file once).
  'GET /api/admin/users': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    // Reads run together rather than one after another: on Postgres each is a
    // round trip, and serially that is one dashboard load per user.
    const users = await Promise.all(db.users.map(async u => {
      const S = await readState(u.id) || {};
      const workouts = S.workouts || [];
      const last = workouts[workouts.length - 1];
      return {
        id: u.id, name: u.name, created: u.created || null,
        disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invitedBy || null,
        workouts: workouts.length,
        lastWorkout: last ? last.d : null,
        lastSync: S._ts || null,
        hasPush: db.subs.some(s => s.userId === u.id),
        live: livePresence(u.id)
      };
    }));
    json(res, 200, { users, invite_only: INVITE_ONLY, now: Date.now() });
  },

  // Drill-down: full workout history + body-weight log for one user.
  'GET /api/admin/user': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const u = db.users.find(x => x.id === id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const S = await readState(u.id) || {};
    json(res, 200, {
      user: { id: u.id, name: u.name, created: u.created || null, disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invitedBy || null },
      unit: S.unit || 'kg',
      lastSync: S._ts || null,
      routines: (S.routines || []).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: (r.ex || []).length })),
      bodyweight: S.bodyweight || [],
      workouts: (S.workouts || []).slice().reverse()   // newest first for display
    });
  },

  'POST /api/admin/user/disable': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (isAdmin(u)) return json(res, 400, { error: 'cannot disable an admin' });
    u.disabled = !!body.disabled;
    if (u.disabled) presence.delete(u.id);   // drop them off "training now" at once
    await saveDb();
    json(res, 200, { ok: true, id: u.id, disabled: u.disabled });
  },

  'GET /api/admin/invites': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    // resolve usedBy uid → name for display
    const invites = db.invites.map(i => ({
      ...i, usedByName: i.usedBy ? (db.users.find(u => u.id === i.usedBy) || {}).name || null : null
    }));
    json(res, 200, { invites, invite_only: INVITE_ONLY });
  },

  'POST /api/admin/invites/new': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    let code;
    // 16 hex chars = 64 bits, up from 8 chars / 32 bits. The app has no rate limiting by design
    // (that's the reverse proxy's job) and /api/register/options tells a caller whether a code is
    // good, so the code itself has to be the thing that isn't worth guessing. Codes already in
    // db.json keep working — validation is an exact string compare, never a length or format check.
    do { code = crypto.randomBytes(8).toString('hex').toUpperCase(); } while (db.invites.some(i => i.code === code));
    const invite = { code, note: String(body.note || '').slice(0, 60), createdBy: admin.id, created: new Date().toISOString() };
    db.invites.push(invite);
    await saveDb();
    json(res, 200, { invite });
  },

  /**
   * Ask a coach for advice.
   *
   * Deliberately not behind the passkey session. A coach is owned by an address
   * on 0G Chain, and the athlete renting one may have no account on this server
   * at all — the signature is the identity, and the chain is the authority on
   * whether that identity is allowed.
   *
   * The coach's configuration is decrypted here and never returned. That is the
   * entire reason this endpoint exists rather than the browser doing it: a
   * renter is entitled to the advice, not to the method that produced it.
   */
  /**
   * Mint a coach for a device that holds no coin.
   *
   * The device signs; this pays. The owner is named inside the signature the
   * contract checks, so nothing here can redirect the coach — the worst this
   * endpoint can do is refuse, or spend our money, and the rate limit is about
   * the second one.
   *
   * No session required, deliberately: the coach belongs to an address, and
   * somebody may have one before they have an account here.
   */
  /**
   * The public key a device seals a new coach to.
   *
   * Served rather than baked into the frontend so that rotating the service key
   * does not strand every installed app on a key this server no longer holds.
   * It is a public key: there is nothing here worth withholding, and a device
   * that cannot fetch it cannot create a coach the server could ever answer.
   */
  'GET /api/coach/pubkey': async (_req, res) => {
    try {
      return json(res, 200, { publicKey: servicePublicKey() });
    } catch (e) {
      if (e instanceof CoachError) return json(res, e.status, { error: e.code, message: e.message });
      throw e;
    }
  },

  /**
   * Store a device's encrypted blob on 0G Storage, paid for by us.
   *
   * Writing to 0G Storage costs gas and the device key holds none. It arrives
   * already sealed for this service's key, so the storage network and anybody
   * fetching by root hash sees ciphertext; only the enclave path opens it.
   */
  'POST /api/coach/store': async (req, res) => {
    /*
     * Limited by caller before anything is read, because this endpoint spends
     * our gas on a blob it cannot inspect — it arrives encrypted, which is the
     * point. Keyed on the address behind any proxy where there is one, so a
     * single machine cannot spend the wallet a megabyte at a time.
     */
    const caller = callerIp(req);

    if (!(await withinStoreLimit(caller))) {
      return json(res, 429, {
        error: 'too_many',
        message: 'That is more storage than anybody needs in an hour.',
      });
    }

    const body = await readBody(req);

    const base64 = String(body.ciphertext || '');
    // ~1 MB of base64. A coach profile is a few hundred bytes; anything near
    // this is somebody using us as free storage.
    if (!base64 || base64.length > 1_400_000) {
      return json(res, 400, { error: 'bad_request', message: 'That is not a coach profile.' });
    }

    let bytes;
    try {
      bytes = new Uint8Array(Buffer.from(base64, 'base64'));
      if (bytes.length === 0) throw new Error('empty');
    } catch {
      return json(res, 400, { error: 'bad_request', message: 'That did not decode.' });
    }

    try {
      const rootHash = await storeForDevice(bytes);
      return json(res, 200, { rootHash });
    } catch (e) {
      if (e instanceof CoachError) return json(res, e.status, { error: e.code, message: e.message });
      console.error('storage relay failed:', e);
      return json(res, 502, { error: 'storage_failed', message: 'That could not be stored.' });
    }
  },

  'POST /api/coach/mint': async (req, res) => {
    const body = await readBody(req);
    try {
      const result = await relayMint(body);
      return json(res, 200, result);
    } catch (e) {
      if (e instanceof RelayError) return json(res, e.status, { error: e.code, message: e.message });
      console.error('relay mint failed:', e);
      return json(res, 502, { error: 'relay_failed', message: 'That could not be submitted.' });
    }
  },

  /**
   * The reminder sweep, for a deployment with no process to run a timer in.
   *
   * Serverless has no clock between requests, so the schedule lives outside
   * and pokes this. Guarded by a shared secret rather than a session: the
   * caller is a scheduler, not a person, and without the guard anybody could
   * drive the sweep — which is not catastrophic (the per-day guard still
   * holds) but is somebody else deciding when our push traffic happens.
   *
   * Refuses rather than running unguarded when CRON_SECRET is unset: a
   * scheduled endpoint that silently accepts everybody is worse than one that
   * is honestly turned off.
   *
   * On the sweep's accuracy, because it differs by deployment and the
   * difference is visible to users: the self-hosted server ticks this every
   * ten seconds and hits the requested minute. Vercel's Hobby plan permits one
   * cron per day with up to an hour of drift, so the hosted app can only
   * approximate a daily nudge — a Pro plan restores per-minute scheduling with
   * no code change, and self-hosting has always been exact. The docs say so
   * rather than leaving somebody to discover it.
   */
  'GET /api/cron/reminders': async (req, res) => {
    const expected = process.env.CRON_SECRET;
    if (!expected) {
      return json(res, 503, { error: 'not_configured', message: 'No CRON_SECRET is set, so this endpoint is closed.' });
    }

    const offered = String(req.headers.authorization || '').replace(/^Bearer /i, '');
    if (offered.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(offered), Buffer.from(expected))) {
      return json(res, 401, { error: 'unauthorized' });
    }

    return json(res, 200, await sweepReminders());
  },

  /** Put a coach on the market, or take it off. Signed by its owner's device. */
  'POST /api/coach/price': async (req, res) => {
    const body = await readBody(req);
    try {
      return json(res, 200, await relaySetPrice(body));
    } catch (e) {
      if (e instanceof RelayError) return json(res, e.status, { error: e.code, message: e.message });
      console.error('relay price failed:', e);
      return json(res, 502, { error: 'relay_failed', message: 'That could not be submitted.' });
    }
  },

  /** Record what a coach learned. The flywheel, running in the background. */
  'POST /api/coach/evolve': async (req, res) => {
    const body = await readBody(req);
    try {
      const result = await relayEvolve(body);
      return json(res, 200, result);
    } catch (e) {
      if (e instanceof RelayError) return json(res, e.status, { error: e.code, message: e.message });
      console.error('relay evolve failed:', e);
      return json(res, 502, { error: 'relay_failed', message: 'That could not be submitted.' });
    }
  },

  'POST /api/coach/advice': async (req, res) => {
    const body = await readBody(req);

    try {
      const { answer } = await advise(
        {
          tokenId: body.tokenId,
          issuedAt: body.issuedAt,
          signature: body.signature,
          question: body.question,
        },
        { loadConfig: loadConfigFromStorage, runModel: runOn0GCompute, withinQuestionLimit },
      );

      return json(res, 200, { answer });
    } catch (e) {
      if (e instanceof CoachError) return json(res, e.status, { error: e.code, message: e.message });

      /*
       * Anything unexpected is reported without its detail. An error thrown
       * while the plaintext config is in scope is exactly where a stack trace
       * would carry it out of here.
       */
      console.error('coach advice failed:', e);
      return json(res, 500, { error: 'server_error', message: 'The coach could not answer.' });
    }
  },

  /**
   * What this coach has learned, for the person who owns it.
   *
   * The coaching record is the product's answer to "it learns from your
   * training", and it lived in one browser's local storage — so changing phone
   * emptied the screen while the record itself sat on 0G Storage, hashed on
   * chain, intact. Owner-only, and only the memory comes back: the rest of the
   * payload is what the ask path takes care never to emit.
   */
  'POST /api/coach/recall': async (req, res) => {
    const body = await readBody(req);

    try {
      const { memory, version } = await recall(
        { tokenId: body.tokenId, issuedAt: body.issuedAt, signature: body.signature },
        { loadConfig: loadConfigFromStorage },
      );

      return json(res, 200, { memory, version });
    } catch (e) {
      if (e instanceof CoachError) return json(res, e.status, { error: e.code, message: e.message });
      console.error('coach recall failed:', e);
      return json(res, 500, { error: 'server_error', message: 'That could not be read.' });
    }
  },

  /**
   * A coach another agent can hire, over HTTP.
   *
   * `GET` answers 402 with what it costs and how to pay; `POST` takes the
   * transaction hash and hands back the answer it bought. Everything else in
   * this API assumes a browser and a device key — this is the same coach
   * exposed the way software buys things, which is what makes the ERC-8004
   * registration mean something to a machine.
   */
  /**
   * Publish one claim about a coach, signed by the address that owns it.
   *
   * Unencrypted on purpose — it is the one thing here meant to be read by
   * strangers. The owner picks a sentence their coach already wrote rather than
   * exposing the record; everything else stays sealed.
   */
  'POST /api/coach/card': async (req, res) => {
    const body = await readBody(req);

    try {
      const { root } = await publishCard(
        { tokenId: body.tokenId, claim: body.claim, issuedAt: body.issuedAt, signature: body.signature },
        {
          createdAt: coachCreatedAt,
          store: (bytes) => storeForDevice(bytes),
        },
      );
      return json(res, 200, { root, url: `/api/card/${root}` });
    } catch (e) {
      if (e instanceof CoachError) return json(res, e.status, { error: e.code, message: e.message });
      console.error('card publish failed:', e);
      return json(res, 500, { error: 'server_error', message: 'That could not be published.' });
    }
  },

  /**
   * Check a card, trusting nothing in it.
   *
   * Public: no account, no signature, no wallet. Everything the card asserts
   * about itself is re-derived from the chain, and the answer ships with what it
   * does and does not cover.
   */
  'GET /api/card': async (req, res) => {
    const root = new URL(req.url, 'http://x').searchParams.get('root');
    if (!root) return json(res, 400, { error: 'bad_request', message: 'Which card?' });

    try {
      const result = await verifyCard(root, { createdAt: coachCreatedAt, fetch: fetchCardBytes });
      return json(res, 200, result);
    } catch (e) {
      if (e instanceof CoachError) return json(res, e.status, { error: e.code, message: e.message });
      console.error('card verify failed:', e);
      return json(res, 502, { error: 'chain_unreachable', message: 'That could not be checked.' });
    }
  },

  /** Coaches for rent, so an agent can find one before paying for it. */
  'GET /api/coaches': async (_req, res) => {
    try {
      return json(res, 200, await listing());
    } catch (e) {
      if (e instanceof CoachError) return json(res, e.status, { error: e.code, message: e.message });
      console.error('coach listing failed:', e);
      return json(res, 502, { error: 'chain_unreachable', message: 'The marketplace could not be read.' });
    }
  },

  'GET /api/coach/:tokenId/service': async (req, res) => {
    try {
      const terms = await quote(req.params.tokenId);
      /*
       * 402 with the terms, which is the whole convention: the status says
       * "pay", and the body says what and where. A 200 carrying a price would
       * need a client that knows to look.
       */
      return json(res, 402, terms);
    } catch (e) {
      if (e instanceof CoachError) return json(res, e.status, { error: e.code, message: e.message });
      console.error('x402 quote failed:', e);
      return json(res, 500, { error: 'server_error', message: 'That could not be quoted.' });
    }
  },

  'POST /api/coach/:tokenId/service': async (req, res) => {
    const body = await readBody(req);

    if (!(await withinQuestionLimit(callerIp(req)))) {
      return json(res, 429, { error: 'too_many', message: 'That is a lot of questions in an hour.' });
    }

    try {
      const result = await redeem(
        {
          tokenId: req.params.tokenId,
          txHash: body.txHash,
          question: body.question,
          caller: body.caller,
        },
        {
          readCoach: readCoachRecord,
          loadConfig: loadConfigFromStorage,
          runModel: runOn0GCompute,
          leaksConfig,
        },
      );

      return json(res, 200, result);
    } catch (e) {
      if (e instanceof CoachError) return json(res, e.status, { error: e.code, message: e.message });
      console.error('x402 redeem failed:', e);
      return json(res, 500, { error: 'server_error', message: 'The coach could not answer.' });
    }
  },

  'POST /api/admin/invites/revoke': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const inv = db.invites.find(i => i.code === String(body.code || '').toUpperCase());
    if (!inv) return json(res, 404, { error: 'no such code' });
    if (inv.usedBy) return json(res, 400, { error: 'already used — cannot revoke' });
    db.invites = db.invites.filter(i => i.code !== inv.code);
    await saveDb();
    json(res, 200, { ok: true });
  }
};

/**
 * One request, whoever is calling.
 *
 * Exported so a serverless function can hand it a request without this module
 * opening a port — the two deployments differ only in who owns the socket.
 */
export async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const key = req.method + ' ' + url.pathname;

  /*
   * Exact match first, then the one parameterised shape.
   *
   * Every route here is a fixed path, which is a fine trade for an API this
   * small — until something has to be addressed as a resource. The 402
   * endpoint does: an agent hiring a coach is told about `coach/5`, and a
   * query string would work but would not look like a thing you can point at.
   * So one pattern rather than a router.
   */
  let handler = routes[key];
  let params = null;

  if (!handler) {
    const service = /^\/api\/coach\/(\d+)\/service$/.exec(url.pathname);
    if (service) {
      handler = routes[`${req.method} /api/coach/:tokenId/service`];
      params = { tokenId: service[1] };
    }
  }

  if (!handler) return json(res, 404, { error: 'not found' });
  req.params = params ?? {};

  try {
    /*
     * Re-read the account list per request when the store is shared, because
     * another instance may have written since this one last looked. On a
     * single long-lived process the in-memory copy is already the truth, and
     * re-reading it every request would be a query for nothing.
     */
    await ready({ reloadDb: store.kind === 'postgres' });
    await handler(req, res);
  } catch (e) {
    console.error(key, e);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
}

/*
 * Only listen when started directly. Imported — by the serverless entry point,
 * or by a test — this module defines the handler and opens nothing.
 */
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  await ready();
  http.createServer(handle).listen(PORT, () =>
    console.log(`liftwithog-api on :${PORT} (rpID=${RP_ID}, origin=${ORIGIN}, store=${store.kind})`),
  );
}
