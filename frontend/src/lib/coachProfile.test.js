import { describe, it, expect } from 'vitest'
import {
  HISTORY_WINDOW,
  MIN_SESSIONS_FOR_CONFIDENCE,
  buildCoachProfile,
  canonicalise,
  hasLearned,
  nutritionFor,
} from './coachProfile.js'

/**
 * The coach profile is the only part of coach ownership that can be checked
 * from the outside. Once it is encrypted and on 0G Storage, nobody sees inside
 * it again — so a mistake here is a mistake that never surfaces, in the payload
 * a person is told is their training history.
 */

/** A logged session in the shape the app actually stores. */
function session(d, entries) {
  return { d, entries }
}

function entry(id, sets) {
  return { id, sets }
}

function set(w, r, done = true) {
  return { w, r, done }
}

describe('buildCoachProfile', () => {
  it('reads what was actually lifted', () => {
    const state = {
      unit: 'kg',
      workouts: [
        session('2026-01-01', [entry('squat', [set(60, 5), set(70, 5)])]),
        session('2026-01-03', [entry('squat', [set(80, 5)])]),
      ],
    }

    const profile = buildCoachProfile(state, { now: 1000 })
    const squat = profile.lifts.find((l) => l.id === 'squat')

    expect(profile.sessions).toBe(2)
    expect(squat.sessions).toBe(2)
    expect(squat.bestWeight).toBe(80)
    expect(squat.lastTrained).toBe('2026-01-03')
  })

  it('ignores sets that were planned but never done', () => {
    /*
     * The difference between what somebody intended and what they lifted. A
     * coach built from unticked sets prescribes weights nobody has ever moved,
     * which is both useless and a way to get hurt.
     */
    const state = {
      workouts: [session('2026-01-01', [entry('bench', [set(60, 5, true), set(100, 5, false)])])],
    }

    const bench = buildCoachProfile(state).lifts.find((l) => l.id === 'bench')
    expect(bench.bestWeight).toBe(60)
  })

  it('drops an exercise where nothing was completed at all', () => {
    const state = {
      workouts: [session('2026-01-01', [entry('deadlift', [set(100, 5, false)])])],
    }
    expect(buildCoachProfile(state).lifts).toHaveLength(0)
  })

  it('ranks by what someone actually trains, not what they tried once', () => {
    const state = {
      workouts: [
        session('2026-01-01', [entry('squat', [set(60, 5)]), entry('curl', [set(10, 10)])]),
        session('2026-01-02', [entry('squat', [set(62, 5)])]),
        session('2026-01-03', [entry('squat', [set(64, 5)])]),
      ],
    }

    expect(buildCoachProfile(state).lifts[0].id).toBe('squat')
  })

  it('says out loud when it has too little to go on', () => {
    /*
     * A coach built on three sessions is a guess. Presenting it with the same
     * authority as two years of history is how somebody follows a number that
     * was never earned.
     */
    const thin = buildCoachProfile({ workouts: [session('2026-01-01', [entry('squat', [set(60, 5)])])] })
    expect(thin.confident).toBe(false)

    const workouts = Array.from({ length: MIN_SESSIONS_FOR_CONFIDENCE }, (_, i) =>
      session(`2026-02-${String(i + 1).padStart(2, '0')}`, [entry('squat', [set(60, 5)])]),
    )
    expect(buildCoachProfile({ workouts }).confident).toBe(true)
  })

  it('looks at recent training, not everything ever', () => {
    const workouts = Array.from({ length: HISTORY_WINDOW + 15 }, (_, i) =>
      session(`2026-03-${String((i % 28) + 1).padStart(2, '0')}`, [entry('squat', [set(60, 5)])]),
    )
    expect(buildCoachProfile({ workouts }).sessions).toBe(HISTORY_WINDOW)
  })

  it('survives the states a real app actually holds', () => {
    // A fresh install, a corrupted import, a session logged with nothing in it.
    expect(buildCoachProfile({}).lifts).toEqual([])
    expect(buildCoachProfile({ workouts: null }).sessions).toBe(0)
    expect(buildCoachProfile({ workouts: [session('2026-01-01', null)] }).lifts).toEqual([])
    expect(buildCoachProfile({ workouts: [session('2026-01-01', [entry(null, [])])] }).lifts).toEqual([])
  })

  it('carries the unit, because 100 means two different lifts', () => {
    expect(buildCoachProfile({ unit: 'lb', workouts: [] }).unit).toBe('lb')
    expect(buildCoachProfile({ unit: 'nonsense', workouts: [] }).unit).toBe('kg')
  })
})

describe('canonicalise and hasLearned', () => {
  const state = {
    workouts: [session('2026-01-01', [entry('squat', [set(60, 5)])])],
  }

  it('hashes the same profile the same way whenever it was built', () => {
    /*
     * The generation time must not reach the hash. If it did, every rebuild
     * would look like new learning — a fee charged for nothing, and an on-chain
     * version count that stops being evidence of anything.
     */
    const morning = buildCoachProfile(state, { now: 1_000 })
    const evening = buildCoachProfile(state, { now: 9_999_999 })

    expect(canonicalise(morning)).toBe(canonicalise(evening))
    expect(hasLearned(morning, evening)).toBe(false)
  })

  it('notices when the training has actually moved', () => {
    const before = buildCoachProfile(state)
    const after = buildCoachProfile({
      workouts: [...state.workouts, session('2026-01-02', [entry('squat', [set(80, 5)])])],
    })

    expect(hasLearned(before, after)).toBe(true)
  })

  it('treats a first coach as something to record', () => {
    expect(hasLearned(null, buildCoachProfile(state))).toBe(true)
  })
})

describe('what the coach knows about eating', () => {
  /**
   * A coach that does not know whether somebody is in a deficit is guessing at
   * half the question. The same lifter, the same lifts, the same week reads
   * completely differently at 1800 calories than at 2800: a stalled bench
   * during a cut is the plan working, and during a bulk it is the plan failing.
   */
  const fed = (over = {}) => ({
    unit: 'kg',
    body: 'male',
    bodyweight: [{ d: '2026-08-01', w: 80 }],
    nutrition: { ageYears: 30, heightCm: 180, activity: 'moderate', goal: 'lose', diet: 'veg' },
    workouts: [session('2026-01-01', [entry('squat', [set(60, 5)])])],
    ...over,
  })

  it('carries the targets, so advice can account for them', () => {
    const nutrition = nutritionFor(fed())

    expect(nutrition.goal).toBe('lose')
    expect(nutrition.diet).toBe('veg')
    expect(nutrition.calories).toBe(2209)
    expect(nutrition.proteinG).toBe(160)
    expect(nutrition.chosen).toBe(true)
  })

  it('says nothing rather than something half-known', () => {
    /*
     * A partial object would reach the model as a set of half-facts, which is
     * worse than an admitted absence — it would answer confidently about a body
     * it does not have the numbers for.
     */
    expect(nutritionFor({ body: 'male', bodyweight: [], nutrition: {} })).toBe(null)
    expect(nutritionFor({})).toBe(null)
  })

  it('says nothing for somebody the app refused to plan for', () => {
    // The refusal has to travel. A coach handed targets for a fifteen-year-old
    // would coach a fifteen-year-old.
    expect(nutritionFor(fed({ nutrition: { ageYears: 15, heightCm: 170, goal: 'lose' } }))).toBe(null)
  })

  it('rides along in the profile that gets encrypted and hashed', () => {
    expect(buildCoachProfile(fed()).nutrition.proteinG).toBe(160)
    expect(buildCoachProfile({ workouts: [] }).nutrition).toBe(null)
  })

  it('counts a changed goal as something the coach learned', () => {
    /*
     * Switching from a bulk to a cut changes what this coach is for. Leaving it
     * out of the hash would mean the app knew something new and recorded no
     * version — and the on-chain count is supposed to be the evidence that a
     * coach has history, so it has to move when the history does.
     */
    const cutting = buildCoachProfile(fed())
    const bulking = buildCoachProfile(fed({
      nutrition: { ageYears: 30, heightCm: 180, activity: 'moderate', goal: 'gain', diet: 'veg' },
    }))

    expect(hasLearned(cutting, bulking)).toBe(true)
  })

  it('does not count rebuilding the same profile as learning', () => {
    // The other half of the same promise: every evolve is a fee somebody pays.
    expect(hasLearned(buildCoachProfile(fed()), buildCoachProfile(fed()))).toBe(false)
  })

  it('notices a diet change without a goal change', () => {
    // Different food, same target. A coach suggesting chicken to somebody who
    // switched to vegetarian last month is a coach nobody listens to twice.
    const before = buildCoachProfile(fed())
    const after = buildCoachProfile(fed({
      nutrition: { ageYears: 30, heightCm: 180, activity: 'moderate', goal: 'lose', diet: 'vegan' },
    }))

    expect(hasLearned(before, after)).toBe(true)
  })
})

describe('what counts as the coach having learned', () => {
  /**
   * The on-chain version count is the product's evidence that a coach has
   * history behind it, so it has to move exactly when the history does and
   * never otherwise — every evolve is a fee somebody pays.
   *
   * The pairs below were found by search rather than invented. Each one differs
   * in exactly one field of what the app knows about eating and is identical in
   * every other, which is the only way to prove that field reaches the hash:
   * these values co-vary, so a goal change usually drags the calories with it
   * and a test built on that proves nothing about the goal.
   */
  const eating = (nutrition, over = {}) => ({
    unit: 'kg',
    body: 'male',
    bodyweight: [{ d: '2026-08-01', w: 45 }],
    workouts: [],
    ...over,
    nutrition,
  })

  it('records a goal change even when every number stays the same', () => {
    /*
     * At the calorie floor a cut and a recomposition collapse onto identical
     * targets — 1200 calories, 90 g of protein, 36 g of fat, 129 g of carbs,
     * all of it the same. They are still different intentions, and a coach
     * that could not tell them apart would give the same advice to somebody
     * trying to lose fat and somebody trying not to.
     */
    const shared = { ageYears: 70, heightCm: 150, activity: 'sedentary', diet: 'veg' }
    const cutting = buildCoachProfile(eating({ ...shared, goal: 'lose' }, { body: 'female' }))
    const recomping = buildCoachProfile(eating({ ...shared, goal: 'recomp' }, { body: 'female' }))

    expect(cutting.nutrition.calories).toBe(recomping.nutrition.calories)
    expect(cutting.nutrition.proteinG).toBe(recomping.nutrition.proteinG)
    expect(cutting.nutrition.carbG).toBe(recomping.nutrition.carbG)
    expect(hasLearned(cutting, recomping)).toBe(true)
  })

  it('records a calorie change on its own', () => {
    // Same weight, same macros to the gram, same goal, same everything the hash
    // otherwise sees — and two calories apart.
    const shared = { activity: 'sedentary', goal: 'maintain', diet: 'veg' }
    const younger = buildCoachProfile(eating({ ...shared, ageYears: 18, heightCm: 150 }))
    const older = buildCoachProfile(eating({ ...shared, ageYears: 19, heightCm: 151 }))

    expect(younger.nutrition.calories).toBe(1563)
    expect(older.nutrition.calories).toBe(1565)
    expect(younger.nutrition.proteinG).toBe(older.nutrition.proteinG)
    expect(younger.nutrition.carbG).toBe(older.nutrition.carbG)
    expect(hasLearned(younger, older)).toBe(true)
  })

  it('tells a chosen goal from one it merely suggested', () => {
    /*
     * Identical numbers, because the suggestion is the same goal. The
     * difference is whether the person committed to it — which is exactly what
     * decides whether a coach should question the goal or work within it.
     */
    const shared = { ageYears: 30, heightCm: 180, activity: 'moderate', diet: 'veg' }
    const heavier = { bodyweight: [{ d: '2026-08-01', w: 80 }] }

    const suggested = buildCoachProfile(eating(shared, heavier))
    const chosen = buildCoachProfile(eating({ ...shared, goal: 'recomp' }, heavier))

    expect(suggested.nutrition.goal).toBe('recomp')
    expect(suggested.nutrition.chosen).toBe(false)
    expect(chosen.nutrition.chosen).toBe(true)
    expect(suggested.nutrition.calories).toBe(chosen.nutrition.calories)
    expect(hasLearned(suggested, chosen)).toBe(true)
  })

  it('records a diet change that moves no number at all', () => {
    // Different food, same targets. A coach suggesting chicken to somebody who
    // went vegetarian last month is one nobody asks twice.
    const shared = { ageYears: 30, heightCm: 180, activity: 'moderate', goal: 'lose' }
    // 80 kg, not the helper's 45: at 180 cm that is a BMI of 13.9, and the app
    // refuses to plan a deficit for it — correctly, which this test learned the
    // hard way.
    const heavier = { bodyweight: [{ d: '2026-08-01', w: 80 }] }

    const before = buildCoachProfile(eating({ ...shared, diet: 'veg' }, heavier))
    const after = buildCoachProfile(eating({ ...shared, diet: 'vegan' }, heavier))

    expect(before.nutrition.calories).toBe(after.nutrition.calories)
    expect(hasLearned(before, after)).toBe(true)
  })
})
