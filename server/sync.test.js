import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStaleWrite } from './sync.js';

/**
 * The rule that stops one device overwriting another's training.
 *
 * `PUT /api/data` accepted every write. A phone offline for a week came back,
 * pushed its week-old copy, and everything logged elsewhere in between was
 * gone — with no error anywhere, because from the client's side the write
 * succeeded.
 */

test('a write older than what is stored is refused', () => {
  // The week-offline phone. This is the whole bug.
  assert.equal(isStaleWrite({ _ts: 1000 }, { _ts: 5000 }), true);
});

test('a newer write is accepted', () => {
  assert.equal(isStaleWrite({ _ts: 5000 }, { _ts: 1000 }), false);
});

test('a repeat of the same write is accepted, not refused', () => {
  /*
   * A retry after a dropped connection sends the same state again. Treating
   * equal timestamps as a conflict would leave that device permanently dirty,
   * retrying forever and never clearing.
   */
  assert.equal(isStaleWrite({ _ts: 5000 }, { _ts: 5000 }), false);
});

test('the first write for an account is always accepted', () => {
  assert.equal(isStaleWrite({ _ts: 1 }, null), false);
  assert.equal(isStaleWrite({ _ts: 0 }, undefined), false);
});

test('a state with no timestamp cannot overwrite one that has a real one', () => {
  // An import or an older client with no `_ts` must not silently win against
  // a month of real training.
  assert.equal(isStaleWrite({}, { _ts: 5000 }), true);
  assert.equal(isStaleWrite({ _ts: null }, { _ts: 5000 }), true);
});

test('anything beats a stored state with no timestamp', () => {
  assert.equal(isStaleWrite({ _ts: 5000 }, {}), false);
});

// ------------------------------------------------------------- wrong clocks

test('a device claiming next year cannot outrank everybody forever', async () => {
  /*
   * Ordering by a client-chosen timestamp means trusting every client's clock,
   * and phones with a badly wrong one are not rare. Unclamped, a device
   * claiming next year wins every comparison from then on: its copy can never
   * be replaced by a device telling the truth, and whatever it was holding
   * becomes permanent.
   */
  const { isStaleWrite, MAX_CLOCK_LEAD_MS } = await import('./sync.js');
  const now = 1_700_000_000_000;

  const fastClock = { _ts: now + 365 * 24 * 3600 * 1000 };
  const honest = { _ts: now };

  assert.equal(isStaleWrite(honest, fastClock, now), false);
  assert.ok(MAX_CLOCK_LEAD_MS > 0);
});

test('ordinary drift and timezone confusion still order normally', async () => {
  // A day of slack: within it, the claimed moment is used as given.
  const { isStaleWrite } = await import('./sync.js');
  const now = 1_700_000_000_000;

  const slightlyAhead = { _ts: now + 60_000 };
  assert.equal(isStaleWrite({ _ts: now }, slightlyAhead, now), true);
  assert.equal(isStaleWrite(slightlyAhead, { _ts: now }, now), false);
});

test('the moment recorded for a write is the clamped one', async () => {
  const { stampFor } = await import('./sync.js');
  const now = 1_700_000_000_000;

  assert.equal(stampFor({ _ts: now + 10 * 365 * 24 * 3600 * 1000 }, now), now);
  assert.equal(stampFor({ _ts: now - 5000 }, now), now - 5000);
  assert.equal(stampFor({}, now), 0);
});
