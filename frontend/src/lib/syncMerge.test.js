import { describe, it, expect } from 'vitest'
import { mergeStates, reconcile } from './syncMerge.js'

/**
 * The tests for the code that decides whether a month of training survives.
 *
 * Every case here was a silent loss before: no error, no warning, just an app
 * that one day has less in it than it did. That is the hardest kind of bug to
 * report and the easiest to disbelieve, so these are written as the scenarios
 * they actually are rather than as unit assertions.
 */

const workout = (id, d, end = 0) => ({ id, d, end, entries: [] })
const weighIn = (d, w, t = 0) => ({ d, w, t })

const state = (over = {}) => ({
  _ts: 1000,
  unit: 'kg',
  restSec: 90,
  workouts: [],
  bodyweight: [],
  routines: [],
  customEx: [],
  exWeights: {},
  ...over,
})

describe('two devices that both logged something', () => {
  it('keeps both sets of workouts', () => {
    /*
     * The scenario. Sessions on Monday from the phone, Tuesday from the
     * laptop, neither device having seen the other. Overwriting kept one.
     */
    const phone = state({ _ts: 2000, workouts: [workout('a', '2026-08-01')] })
    const laptop = state({ _ts: 3000, workouts: [workout('b', '2026-08-02')] })

    const merged = mergeStates(phone, laptop)
    expect(merged.workouts.map((w) => w.id).sort()).toEqual(['a', 'b'])
  })

  it('does not duplicate a workout both devices already had', () => {
    const shared = workout('a', '2026-08-01')
    const merged = mergeStates(
      state({ workouts: [shared, workout('b', '2026-08-02')] }),
      state({ workouts: [shared, workout('c', '2026-08-03')] }),
    )

    expect(merged.workouts).toHaveLength(3)
  })

  it('keeps the later version of a session edited in both places', () => {
    const merged = mergeStates(
      state({ workouts: [workout('a', '2026-08-01', 500)] }),
      state({ workouts: [workout('a', '2026-08-01', 900)] }),
    )

    expect(merged.workouts).toHaveLength(1)
    expect(merged.workouts[0].end).toBe(900)
  })

  it('keeps both weigh-ins, and one per day', () => {
    const merged = mergeStates(
      state({ bodyweight: [weighIn('2026-08-01', 80, 10)] }),
      state({ bodyweight: [weighIn('2026-08-02', 79, 20)] }),
    )

    expect(merged.bodyweight.map((b) => b.d)).toEqual(['2026-08-01', '2026-08-02'])
  })

  it('keeps the later weigh-in when the same day was logged twice', () => {
    // Weighed at home, weighed again at the gym. The later reading is the one
    // that was meant, and it must not depend on which device syncs first.
    const merged = mergeStates(
      state({ bodyweight: [weighIn('2026-08-01', 80, 10)] }),
      state({ bodyweight: [weighIn('2026-08-01', 79.5, 99)] }),
    )

    expect(merged.bodyweight).toHaveLength(1)
    expect(merged.bodyweight[0].w).toBe(79.5)
  })

  it('sorts weigh-ins by date, because the rest of the app reads the last one', () => {
    /*
     * `latestWeightKg` takes the final entry, and every calorie target is
     * computed from it. An unsorted merge silently plans somebody's diet
     * around whichever weigh-in happened to land last in an array.
     */
    const merged = mergeStates(
      state({ bodyweight: [weighIn('2026-08-05', 78, 50)] }),
      state({ bodyweight: [weighIn('2026-08-01', 80, 10), weighIn('2026-08-03', 79, 30)] }),
    )

    expect(merged.bodyweight.map((b) => b.d)).toEqual(['2026-08-01', '2026-08-03', '2026-08-05'])
    expect(merged.bodyweight.at(-1).w).toBe(78)
  })

  it('keeps the heavier lift on both sides', () => {
    /*
     * A personal best is a maximum, not a preference. Taking one side's map
     * wholesale drops a PR set on the other device — the kind of loss somebody
     * notices months later and cannot explain.
     */
    const merged = mergeStates(
      state({ exWeights: { squat: { w: 100, d: '2026-08-01' }, bench: { w: 60, d: '2026-08-01' } } }),
      state({ exWeights: { squat: { w: 90, d: '2026-08-02' }, deadlift: { w: 140, d: '2026-08-02' } } }),
    )

    expect(merged.exWeights.squat.w).toBe(100)
    expect(merged.exWeights.bench.w).toBe(60)
    expect(merged.exWeights.deadlift.w).toBe(140)
  })

  it('keeps routines and custom exercises from both', () => {
    const merged = mergeStates(
      state({ routines: [{ id: 'r1', name: 'Push' }], customEx: [{ id: 'x1', n: 'Sled' }] }),
      state({ routines: [{ id: 'r2', name: 'Pull' }], customEx: [{ id: 'x2', n: 'Yoke' }] }),
    )

    expect(merged.routines.map((r) => r.id).sort()).toEqual(['r1', 'r2'])
    expect(merged.customEx.map((x) => x.id).sort()).toEqual(['x1', 'x2'])
  })
})

describe('the settings, which cannot be unioned', () => {
  it('come from whichever side is newer', () => {
    // There is no meaningful union of "rest 90" and "rest 120".
    const older = state({ _ts: 1000, restSec: 90, unit: 'kg' })
    const newer = state({ _ts: 5000, restSec: 120, unit: 'lb' })

    expect(mergeStates(older, newer).restSec).toBe(120)
    expect(mergeStates(newer, older).unit).toBe('lb')
  })

  it('carries the nutrition profile from the newer side', () => {
    const older = state({ _ts: 1000, nutrition: { heightCm: 180, goal: 'lose' } })
    const newer = state({ _ts: 5000, nutrition: { heightCm: 180, goal: 'gain' } })

    expect(mergeStates(older, newer).nutrition.goal).toBe('gain')
  })

  it('leaves the in-progress workout on the device running it', () => {
    // The server strips `active`, and half a session belongs to the phone in
    // somebody's hand, not to the laptop that synced afterwards.
    const lifting = state({ _ts: 1000, active: { id: 'live' } })
    const other = state({ _ts: 9000, active: { id: 'stale' } })

    expect(mergeStates(lifting, other).active).toEqual({ id: 'live' })
  })

  it('comes out newer than either input, so the next sync does not undo it', () => {
    const merged = mergeStates(state({ _ts: 1000 }), state({ _ts: 2000 }))
    expect(merged._ts).toBeGreaterThanOrEqual(2000)
  })
})

describe('when to merge at all', () => {
  const local = state({ _ts: 2000, workouts: [workout('mine', '2026-08-01')] })
  const remote = state({ _ts: 3000, workouts: [workout('theirs', '2026-08-02')] })

  it('merges only when both sides really changed', () => {
    /*
     * The case that used to discard one side. `dirty` means this device has
     * work the server has not seen; a newer server means the other device has
     * work this one has not seen.
     */
    const result = reconcile({ local, remote, dirty: true, hasLocalData: true })

    expect(result.action).toBe('merge')
    expect(result.state.workouts.map((w) => w.id).sort()).toEqual(['mine', 'theirs'])
  })

  it('takes the server copy whole when this device has nothing unsent', () => {
    /*
     * The ordinary sync, and the reason deletions survive. A merge here would
     * union a workout deleted on the other device straight back into place.
     */
    const result = reconcile({ local, remote, dirty: false, hasLocalData: true })

    expect(result.action).toBe('take')
    expect(result.state).toBe(remote)
  })

  it('pushes when this device is the one that is ahead', () => {
    const result = reconcile({
      local: state({ _ts: 9000 }),
      remote,
      dirty: true,
      hasLocalData: true,
    })
    expect(result.action).toBe('push')
  })

  it('takes the server copy on a fresh install, even though the empty one is newer', () => {
    /*
     * The scenario that makes "empty" a special case rather than just an old
     * state. A new phone boots, `persist` stamps `_ts` with the moment it was
     * installed, and that is newer than a server copy written last week. On
     * timestamps alone the empty device wins and a year of training is
     * overwritten by signing in on a new handset.
     */
    const justInstalled = state({ _ts: Date.now() + 60_000, workouts: [], bodyweight: [] })
    const account = state({ _ts: 3000, workouts: [workout('a year of this', '2026-01-01')] })

    const result = reconcile({
      local: justInstalled,
      remote: account,
      dirty: false,
      hasLocalData: false,
    })

    expect(result.action).toBe('take')
    expect(result.state.workouts).toHaveLength(1)
  })

  it('does not let an empty device win even when it has unsent changes', () => {
    // Same shape, with the dirty flag set — a setting toggled before signing in
    // must not count as grounds to replace the account.
    const justInstalled = state({ _ts: Date.now() + 60_000, restSec: 120 })
    const account = state({ _ts: 3000, workouts: [workout('a', '2026-01-01')] })

    const result = reconcile({
      local: justInstalled,
      remote: account,
      dirty: true,
      hasLocalData: false,
    })

    expect(result.action).toBe('take')
    expect(result.state.workouts).toHaveLength(1)
  })

  it('pushes when the server has nothing yet', () => {
    const result = reconcile({ local, remote: null, dirty: false, hasLocalData: true })
    expect(result.action).toBe('push')
  })
})

describe('the shapes a real app actually holds', () => {
  it('survives missing and malformed collections', () => {
    expect(() => mergeStates({ _ts: 1 }, { _ts: 2 })).not.toThrow()
    expect(mergeStates({ _ts: 1, workouts: null }, { _ts: 2, workouts: undefined }).workouts).toEqual([])
    expect(mergeStates(null, state()).unit).toBe('kg')
    expect(mergeStates(state(), null).unit).toBe('kg')
  })

  it('ignores entries with no key rather than losing the rest', () => {
    // A corrupted import should cost the broken row, not the merge.
    const merged = mergeStates(
      state({ workouts: [workout('a', '2026-08-01'), { d: '2026-08-02' }] }),
      state({ workouts: [workout('b', '2026-08-03')] }),
    )

    expect(merged.workouts.map((w) => w.id).sort()).toEqual(['a', 'b'])
  })

  it('never loses a workout that only one side had, whichever way round', () => {
    // The property behind every case above: union is symmetric, and the
    // argument order must not decide whether training survives.
    const a = state({ _ts: 2000, workouts: [workout('a', '2026-08-01'), workout('c', '2026-08-03')] })
    const b = state({ _ts: 3000, workouts: [workout('b', '2026-08-02')] })

    const forwards = mergeStates(a, b).workouts.map((w) => w.id).sort()
    const backwards = mergeStates(b, a).workouts.map((w) => w.id).sort()

    expect(forwards).toEqual(['a', 'b', 'c'])
    expect(backwards).toEqual(['a', 'b', 'c'])
  })
})

describe('the food log, which is a day-keyed object rather than a list', () => {
  /**
   * The exact loss this was written for. Breakfast goes in on a phone, the
   * phone goes offline, lunch and dinner go in on a laptop. Both are edits to
   * the same date, and whole-object last-write-wins threw one side away —
   * silently, in a log people build a diet around.
   */
  const meal = (id, kcal) => ({ id, name: id, kcal, proteinG: 10 })

  it('keeps food both devices logged on the same day', () => {
    const phone = state({ _ts: 2000, foodLog: { '2026-08-30': [meal('breakfast', 500)] } })
    const laptop = state({
      _ts: 3000,
      foodLog: { '2026-08-30': [meal('lunch', 700), meal('dinner', 600)] },
    })

    const merged = mergeStates(phone, laptop)

    expect(merged.foodLog['2026-08-30'].map((e) => e.id).sort()).toEqual([
      'breakfast',
      'dinner',
      'lunch',
    ])
  })

  it('keeps days only one device knows about', () => {
    const merged = mergeStates(
      state({ foodLog: { '2026-08-29': [meal('a', 100)] } }),
      state({ foodLog: { '2026-08-30': [meal('b', 200)] } }),
    )

    expect(Object.keys(merged.foodLog).sort()).toEqual(['2026-08-29', '2026-08-30'])
  })

  it('does not duplicate an entry both devices already had', () => {
    const shared = meal('breakfast', 500)
    const merged = mergeStates(
      state({ foodLog: { '2026-08-30': [shared, meal('lunch', 700)] } }),
      state({ foodLog: { '2026-08-30': [shared] } }),
    )

    expect(merged.foodLog['2026-08-30']).toHaveLength(2)
  })

  it('is symmetric, so argument order cannot decide what survives', () => {
    const a = state({ _ts: 2000, foodLog: { '2026-08-30': [meal('a', 100)] } })
    const b = state({ _ts: 3000, foodLog: { '2026-08-30': [meal('b', 200)] } })

    const forwards = mergeStates(a, b).foodLog['2026-08-30'].map((e) => e.id).sort()
    const backwards = mergeStates(b, a).foodLog['2026-08-30'].map((e) => e.id).sort()

    expect(forwards).toEqual(['a', 'b'])
    expect(backwards).toEqual(['a', 'b'])
  })

  it('survives a device that has never logged any food', () => {
    const merged = mergeStates(
      state({ foodLog: { '2026-08-30': [meal('a', 100)] } }),
      state({ foodLog: undefined }),
    )

    expect(merged.foodLog['2026-08-30']).toHaveLength(1)
  })

  it('does not keep a day that ends up empty', () => {
    // Matches what removeEntry does, so untouched days do not pile up in every
    // sync and every backup forever.
    const merged = mergeStates(state({ foodLog: { '2026-08-30': [] } }), state({ foodLog: {} }))
    expect(merged.foodLog['2026-08-30']).toBeUndefined()
  })
})

describe('day plan overrides', () => {
  it('keeps a reschedule made on each device', () => {
    // Moving Thursday's session on one device and Saturday's on another are not
    // in conflict, and taking one side whole loses the other.
    const merged = mergeStates(
      state({ _ts: 2000, dayPlan: { '2026-08-27': 'r1' } }),
      state({ _ts: 3000, dayPlan: { '2026-08-29': 'rest' } }),
    )

    expect(merged.dayPlan).toEqual({ '2026-08-27': 'r1', '2026-08-29': 'rest' })
  })

  it('lets the newer device win the same day', () => {
    // Two devices rescheduling the same date is a genuine conflict, and there
    // is nothing to combine — so the more recent intent stands.
    const merged = mergeStates(
      state({ _ts: 2000, dayPlan: { '2026-08-30': 'r1' } }),
      state({ _ts: 9000, dayPlan: { '2026-08-30': 'rest' } }),
    )

    expect(merged.dayPlan['2026-08-30']).toBe('rest')
  })
})

describe('notes about exercises', () => {
  it('keeps notes both devices wrote about different lifts', () => {
    const merged = mergeStates(
      state({ _ts: 2000, exNotes: { squat: { text: 'knees out', t: 100 } } }),
      state({ _ts: 3000, exNotes: { bench: { text: 'elbows in', t: 200 } } }),
    )

    expect(merged.exNotes.squat.text).toBe('knees out')
    expect(merged.exNotes.bench.text).toBe('elbows in')
  })

  it('keeps the later thought when both edited the same lift', () => {
    /*
     * By the note's own timestamp, not by which device synced last — the
     * newer idea about a lift is the one worth keeping, and sync order says
     * nothing about which that is.
     */
    const merged = mergeStates(
      state({ _ts: 9000, exNotes: { squat: { text: 'old idea', t: 100 } } }),
      state({ _ts: 1000, exNotes: { squat: { text: 'newer idea', t: 500 } } }),
    )

    expect(merged.exNotes.squat.text).toBe('newer idea')
  })

  it('keeps the later thought whichever device is holding it', () => {
    /*
     * The half the first version of this test missed: it only ever put the
     * newer note on the side that already wins by default, so it passed with
     * or without the comparison. Here the newer note is on the *other* side.
     */
    const merged = mergeStates(
      state({ _ts: 1000, exNotes: { squat: { text: 'newer idea', t: 500 } } }),
      state({ _ts: 9000, exNotes: { squat: { text: 'old idea', t: 100 } } }),
    )

    expect(merged.exNotes.squat.text).toBe('newer idea')
  })

  it('survives a device with no notes at all', () => {
    const merged = mergeStates(
      state({ exNotes: { squat: { text: 'knees out', t: 100 } } }),
      state({ exNotes: undefined }),
    )

    expect(merged.exNotes.squat.text).toBe('knees out')
  })
})
