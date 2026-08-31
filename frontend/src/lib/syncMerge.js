/**
 * Reconciling two devices that both changed something.
 *
 * The app synced by overwriting: `pushState` sent the whole state object and
 * the server wrote it down, `pullState` took the whole state object and threw
 * away what was here. Whole-object last-write-wins, with the winner decided by
 * a client clock.
 *
 * Two ways that loses real training:
 *
 *   1. A phone that was offline for a week comes back and pushes its week-old
 *      state. Everything logged on the laptop in between is gone, because the
 *      server accepted the write without looking at what it already had.
 *   2. Both devices have unsent changes. The dirty one refuses the server's
 *      copy and pushes over it, so whatever the other device logged is gone.
 *
 * Neither shows an error. Somebody just opens the app one day with a month
 * missing, and there is nothing to point at.
 *
 * **What this is not.** Not a CRDT and not a merge for arbitrary edits. It
 * exploits the one property this data actually has: the things that matter are
 * append-only logs with stable keys — a workout has an id from the moment it
 * starts, a weigh-in is keyed by its date. Two devices adding different entries
 * is the conflict that happens in practice, and unioning by key resolves it
 * exactly.
 *
 * **The honest limitation: deletions can come back.** Union has no way to tell
 * "deleted on the other device" from "never seen on this one". Deleting a
 * workout on a phone while a laptop still holds it can resurrect it on the next
 * conflicting sync. Tombstones would fix it and are not worth the machinery
 * here: reappearing sessions are visible and one tap to remove, and losing a
 * month of training is neither. Merging only happens when both sides really did
 * change — the ordinary case still takes the newer copy whole, and never
 * resurrects anything.
 */

/** Entries keyed by id: workouts, routines, custom exercises. */
const BY_ID = ['workouts', 'routines', 'customEx']

/** Weigh-ins are one per day, keyed by the day. */
const BY_DAY = 'bodyweight'

const listOf = (value) => (Array.isArray(value) ? value : [])

/**
 * Union two keyed lists, preferring the entry that was written later.
 *
 * `pick` decides a genuine collision — the same workout edited on both devices,
 * which is rare and cannot be resolved by union alone.
 */
function unionBy(mine, theirs, key, pick) {
  const merged = new Map()

  for (const entry of listOf(theirs)) {
    const id = entry?.[key]
    if (id != null) merged.set(id, entry)
  }

  for (const entry of listOf(mine)) {
    const id = entry?.[key]
    if (id == null) continue

    const other = merged.get(id)
    merged.set(id, other ? pick(entry, other) : entry)
  }

  return [...merged.values()]
}

/** A finished session's `end`; a running one has none. */
const finishedAt = (workout) => Number(workout?.end ?? workout?.start ?? 0) || 0

/** A weigh-in's moment, falling back to its date when it predates `t`. */
const weighedAt = (entry) => Number(entry?.t ?? Date.parse(entry?.d ?? '') ?? 0) || 0

/**
 * Best lift per exercise, which is a maximum rather than a choice.
 *
 * Taking one side's map wholesale would drop a personal best set on the other
 * device — and a PR quietly disappearing is exactly the kind of loss somebody
 * notices months later and cannot explain.
 */
function mergeExWeights(mine = {}, theirs = {}) {
  const merged = { ...theirs }

  for (const [id, record] of Object.entries(mine ?? {})) {
    const other = merged[id]
    if (!other || Number(record?.w ?? 0) >= Number(other?.w ?? 0)) merged[id] = record
  }

  return merged
}

/** Per-exercise notes, keyed by exercise id, newest note per exercise. */
function mergeNotes(mine, theirs) {
  const left = objectOf(mine)
  const right = objectOf(theirs)
  const merged = { ...right }

  for (const [id, note] of Object.entries(left)) {
    const other = merged[id]
    if (!other || (Number(note?.t) || 0) >= (Number(other?.t) || 0)) merged[id] = note
  }

  return merged
}

const objectOf = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}

/**
 * A log stored as `{ '2026-08-30': [entry, entry] }`.
 *
 * Every day present on either side survives, and within a day the entries are
 * unioned by their own id — so two devices adding different meals to the same
 * date keep both, which is the case that loses food today.
 */
function mergeByDay(mine, theirs) {
  const left = objectOf(mine)
  const right = objectOf(theirs)
  const merged = {}

  for (const iso of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const entries = unionBy(left[iso], right[iso], 'id', (a) => a)
    // A day that ends up empty is dropped rather than stored as [], matching
    // what `removeEntry` does, so untouched days do not accumulate forever.
    if (entries.length > 0) merged[iso] = entries
  }

  return merged
}

/**
 * Per-date schedule overrides, which are single values rather than lists.
 *
 * Union the dates; where both devices changed the same date there is nothing to
 * combine, so the newer state wins that one key — the same rule the settings
 * follow, applied per day instead of to the whole object.
 */
function mergeDayPlan(mine, theirs, mineIsNewer) {
  const left = objectOf(mine)
  const right = objectOf(theirs)

  return mineIsNewer ? { ...right, ...left } : { ...left, ...right }
}

/**
 * Combine two states that both moved on.
 *
 * Settings, the weekly plan and everything else scalar come from whichever side
 * is newer: there is no meaningful union of "rest timer is 90" and "rest timer
 * is 120", and picking the more recent one is what somebody would expect.
 * The logs are unioned, because those are the ones that cost training to lose.
 */
export function mergeStates(mine, theirs) {
  if (!mine) return theirs
  if (!theirs) return mine

  const mineIsNewer = (Number(mine._ts) || 0) >= (Number(theirs._ts) || 0)
  const base = mineIsNewer ? mine : theirs

  const merged = { ...base }

  for (const field of BY_ID) {
    merged[field] = unionBy(mine[field], theirs[field], 'id', (a, b) =>
      finishedAt(a) >= finishedAt(b) ? a : b,
    )
  }

  merged[BY_DAY] = unionBy(mine[BY_DAY], theirs[BY_DAY], 'd', (a, b) =>
    weighedAt(a) >= weighedAt(b) ? a : b,
  ).sort((a, b) => (a.d < b.d ? -1 : 1))

  merged.exWeights = mergeExWeights(mine.exWeights, theirs.exWeights)

  /*
   * The food log is a day-keyed object rather than a list, so `unionBy` — which
   * reads a key off each entry — does not apply to it directly. It is still an
   * append-only log with stable ids, which is the property that makes merging
   * possible, so it gets the same treatment one level down.
   *
   * This was missing when the food log shipped, and the file's own header
   * describes exactly the invariant it satisfies. Breakfast logged on a phone
   * and lunch logged on a laptop are edits to the same day, and whole-object
   * last-write-wins threw one of them away.
   */
  merged.foodLog = mergeByDay(mine.foodLog, theirs.foodLog)

  /*
   * A note is per exercise, so two devices writing notes about different lifts
   * are not in conflict. Where both edited the same one there is nothing to
   * combine, and the note carries its own timestamp — so the later thought
   * wins rather than the device that happened to sync last.
   */
  merged.exNotes = mergeNotes(mine.exNotes, theirs.exNotes)

  /*
   * Day plan overrides — "train legs on Thursday instead", "rest today" — are
   * per-date facts, not settings. Two devices rescheduling different days is
   * the same shape of conflict, and the same fix.
   */
  merged.dayPlan = mergeDayPlan(mine.dayPlan, theirs.dayPlan, mineIsNewer)

  /*
   * An in-progress workout is device-local — the server strips it — so it is
   * whatever this device is holding, never the other one's.
   */
  merged.active = mine.active ?? null

  // The merge is a new fact about the data, so it carries a new moment. Keeping
  // the older of the two would make the result look stale and invite the next
  // sync to overwrite the work this just saved.
  merged._ts = Math.max(Number(mine._ts) || 0, Number(theirs._ts) || 0, Date.now())

  return merged
}

/**
 * What a device should do with what the server has.
 *
 * Separated from the merge so the decision can be read and tested on its own.
 * Three outcomes, and only one of them merges: an ordinary sync still takes the
 * newer copy whole, which is what keeps deletions deleted.
 */
export function reconcile({ local, remote, dirty, hasLocalData }) {
  if (!remote) return { action: 'push', state: local }
  if (!hasLocalData) return { action: 'take', state: remote }

  const localTs = Number(local?._ts) || 0
  const remoteTs = Number(remote?._ts) || 0

  // Both sides moved since they last agreed. This is the case that used to
  // silently discard one of them.
  if (dirty && remoteTs > localTs) {
    return { action: 'merge', state: mergeStates(local, remote) }
  }

  if (dirty) return { action: 'push', state: local }
  if (remoteTs >= localTs) return { action: 'take', state: remote }

  return { action: 'push', state: local }
}
