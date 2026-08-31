import { describe, it, expect } from 'vitest'
import { withDefaults } from './withDefaults.js'

/**
 * What happens to a profile saved by last month's build.
 *
 * The old merge was `Object.assign(clone(DEF), state)` — shallow, so a stored
 * `nutrition` object replaced the default one whole and any key added since
 * simply was not there. Nothing throws; the value arrives as `undefined` at
 * whatever screen reads it, and the cause is a release nobody is thinking
 * about any more.
 */

const DEF = {
  unit: 'kg',
  restSec: 90,
  reminder: { on: false, time: '08:00', tz: null },
  nutrition: { ageYears: null, heightCm: null, activity: 'light', goal: null, diet: 'nonveg', paceKgPerWeek: null },
  week: {},
  exWeights: {},
  workouts: [],
}

describe('a profile from an older build', () => {
  it('gains keys the defaults have grown since it was saved', () => {
    // Saved before `paceKgPerWeek` and `reminder.tz` existed.
    const stored = {
      unit: 'kg',
      reminder: { on: true, time: '07:00' },
      nutrition: { ageYears: 30, heightCm: 180, activity: 'moderate', goal: 'lose', diet: 'veg' },
    }

    const filled = withDefaults(stored, DEF)

    expect(filled.nutrition.paceKgPerWeek).toBe(null)
    expect(filled.reminder.tz).toBe(null)
  })

  it('keeps everything it actually had', () => {
    const stored = {
      unit: 'lb',
      reminder: { on: true, time: '07:00' },
      nutrition: { ageYears: 30, heightCm: 180, activity: 'moderate', goal: 'lose', diet: 'veg' },
    }

    const filled = withDefaults(stored, DEF)

    expect(filled.unit).toBe('lb')
    expect(filled.reminder.on).toBe(true)
    expect(filled.reminder.time).toBe('07:00')
    expect(filled.nutrition.goal).toBe('lose')
    expect(filled.nutrition.diet).toBe('veg')
  })

  it('does not resurrect a setting turned off', () => {
    // Filling in must never mean overriding. A false that was chosen is not a
    // missing value.
    const filled = withDefaults({ reminder: { on: false, time: '09:00', tz: 'Asia/Kolkata' } }, DEF)

    expect(filled.reminder.on).toBe(false)
    expect(filled.reminder.tz).toBe('Asia/Kolkata')
  })

  it('takes the defaults whole when there is nothing stored', () => {
    expect(withDefaults(null, DEF)).toEqual(DEF)
    expect(withDefaults(undefined, DEF)).toEqual(DEF)
    expect(withDefaults('not an object', DEF)).toEqual(DEF)
  })
})

describe('what must not be filled in', () => {
  it('leaves the user’s own maps empty when they emptied them', () => {
    /*
     * `week`, `dayPlan` and `exWeights` are the person's data, not settings.
     * Merging defaults into them would put back a weekday assignment somebody
     * deliberately cleared.
     */
    const filled = withDefaults({ week: {}, exWeights: {} }, DEF)

    expect(filled.week).toEqual({})
    expect(filled.exWeights).toEqual({})
  })

  it('never merges arrays', () => {
    /*
     * A stored list shorter than the default one is the case that matters: an
     * index-wise merge keeps the leftovers, so a workout deleted down to one
     * entry comes back with the other still attached. The first version of this
     * test used two lists of equal length, where merging and replacing give the
     * same answer and neither proves anything.
     */
    const defaults = { ...DEF, workouts: [{ id: 'seed-1' }, { id: 'seed-2' }, { id: 'seed-3' }] }
    const filled = withDefaults({ workouts: [{ id: 'the only one left' }] }, defaults)

    expect(filled.workouts).toEqual([{ id: 'the only one left' }])
    expect(filled.workouts).toHaveLength(1)
  })

  it('lets a list be emptied', () => {
    // Deleting the last routine must not hand back the defaults.
    const defaults = { ...DEF, routines: [{ id: 'starter' }] }
    expect(withDefaults({ routines: [] }, defaults).routines).toEqual([])
  })

  it('takes a stored object over a default list', () => {
    /*
     * A shape that changed between releases. Merging these produces an
     * array-shaped object with named keys hung off it — something no screen
     * knows how to read, and which looks like corrupted data rather than a
     * migration nobody wrote.
     */
    const filled = withDefaults({ week: { 1: 'push' } }, { ...DEF, week: ['push'] })

    expect(Array.isArray(filled.week)).toBe(false)
    expect(filled.week).toEqual({ 1: 'push' })
  })

  it('takes a stored list over a default object', () => {
    // The same shape change the other way round, which merges into an object
    // with "0" and "1" as keys.
    const filled = withDefaults({ routines: [{ id: 'a' }] }, { ...DEF, routines: { starter: true } })

    expect(Array.isArray(filled.routines)).toBe(true)
    expect(filled.routines).toEqual([{ id: 'a' }])
  })

  it('replaces an object with a scalar if that is genuinely what is stored', () => {
    // Shape changes are the caller's problem to migrate; this must not invent a
    // merge between a number and an object.
    const filled = withDefaults({ reminder: 5 }, DEF)
    expect(filled.reminder).toBe(5)
  })

  it('does not share structure with the defaults it was given', () => {
    /*
     * A returned state that aliases DEF means one profile's edit rewrites the
     * defaults for every profile loaded afterwards, in the same tab.
     */
    const filled = withDefaults({}, DEF)
    filled.reminder.time = '23:59'
    filled.week[1] = 'routine'

    expect(DEF.reminder.time).toBe('08:00')
    expect(DEF.week).toEqual({})
  })
})

describe('the shapes a real app holds', () => {
  it('fills in nested objects to any depth', () => {
    const defaults = { a: { b: { c: 1, d: 2 } } }
    expect(withDefaults({ a: { b: { c: 9 } } }, defaults).a.b.d).toBe(2)
  })

  it('keeps a key the defaults have never heard of', () => {
    // Forward compatibility: a newer build's field must survive an older one
    // reading and rewriting the state.
    expect(withDefaults({ somethingNewer: 42 }, DEF).somethingNewer).toBe(42)
  })

  it('treats null as a stored value, not as absence', () => {
    expect(withDefaults({ unit: null }, DEF).unit).toBe(null)
  })
})
