import { describe, it, expect } from 'vitest'
import {
  allGoals,
  basalMetabolicRate,
  bmi,
  bmiCategory,
  computeTargets,
  referenceWeight,
  screenProfile,
  suggestedGoal,
} from './nutrition.js'

/**
 * The numbers somebody eats by.
 *
 * Everything else in this app can be wrong for a day and cost somebody a bad
 * session. This can be wrong for a month and cost them muscle, or their period,
 * or their hair — so the tests here are less about whether the arithmetic runs
 * and more about whether the guards actually hold when a real person leans on
 * them, which is the case nobody writes a test for.
 *
 * Every expected number below was computed by running the module and checking
 * the result by hand against the formula, not copied out of its output.
 */

const man = (over = {}) => ({
  sex: 'male',
  ageYears: 30,
  heightCm: 180,
  weightKg: 80,
  activity: 'moderate',
  goal: 'maintain',
  ...over,
})

const woman = (over = {}) => ({
  sex: 'female',
  ageYears: 30,
  heightCm: 165,
  weightKg: 60,
  activity: 'sedentary',
  goal: 'maintain',
  ...over,
})

describe('resting metabolism', () => {
  it('is Mifflin-St Jeor, to the term', () => {
    // 10(80) + 6.25(180) - 5(30) + 5 = 1780
    expect(basalMetabolicRate(man())).toBe(1780)
  })

  it('differs by sex by the constant, not by a fudge factor', () => {
    // The same body, the two constants: +5 and -161 are 166 apart.
    const male = basalMetabolicRate({ sex: 'male', ageYears: 30, heightCm: 180, weightKg: 80 })
    const female = basalMetabolicRate({ sex: 'female', ageYears: 30, heightCm: 180, weightKg: 80 })
    expect(male - female).toBe(166)
  })

  it('falls with age', () => {
    expect(basalMetabolicRate(man({ ageYears: 50 }))).toBe(1780 - 100)
  })
})

describe('bmi', () => {
  it('is weight over height in metres squared', () => {
    expect(bmi(80, 180)).toBeCloseTo(24.69, 2)
  })

  it('returns nothing rather than infinity when a field is missing', () => {
    // A half-filled form must not produce a number, because a number on the
    // screen is read as an answer.
    expect(bmi(80, 0)).toBe(0)
    expect(bmi(0, 180)).toBe(0)
    expect(bmi(undefined, undefined)).toBe(0)
  })

  it('names the WHO bands at their exact edges', () => {
    expect(bmiCategory(18.49).key).toBe('under')
    expect(bmiCategory(18.5).key).toBe('normal')
    expect(bmiCategory(24.99).key).toBe('normal')
    expect(bmiCategory(25).key).toBe('over')
    expect(bmiCategory(29.99).key).toBe('over')
    expect(bmiCategory(30).key).toBe('obese')
  })

  it('has no band for a missing number', () => {
    expect(bmiCategory(0)).toBe(null)
  })
})

describe('maintenance', () => {
  it('is resting metabolism times how much somebody moves', () => {
    // 1780 x 1.55
    expect(computeTargets(man()).tdee).toBe(2759)
  })

  it('spans the full activity range, not a token adjustment', () => {
    const sedentary = computeTargets(man({ activity: 'sedentary' })).tdee
    const veryActive = computeTargets(man({ activity: 'very_active' })).tdee

    expect(sedentary).toBe(2136) // 1780 x 1.2
    expect(veryActive).toBe(3382) // 1780 x 1.9
  })

  it('leaves maintenance alone', () => {
    const t = computeTargets(man({ goal: 'maintain' }))
    expect(t.calories).toBe(t.tdee)
    expect(t.safetyNotes).toEqual([])
  })
})

describe('protein', () => {
  it('does not move when the calorie target does', () => {
    /*
     * The thing that separates this from the calculators people already have.
     * These two eat 1230 calories apart and need exactly the same protein,
     * because protein is a property of the body, not of the budget. Any rule
     * expressed as a percentage of calories fails this.
     */
    const desk = computeTargets(man({ activity: 'sedentary', goal: 'lose' }))
    const athlete = computeTargets(man({ activity: 'very_active', goal: 'lose' }))

    expect(athlete.calories - desk.calories).toBeGreaterThan(1000)
    expect(desk.proteinG).toBe(160)
    expect(athlete.proteinG).toBe(160)
  })

  it('scales with the body instead', () => {
    // Both inside the usual range, so nothing but bodyweight is in play.
    const light = computeTargets(man({ weightKg: 60, heightCm: 175, goal: 'lose' }))
    const heavy = computeTargets(man({ weightKg: 88, heightCm: 180, goal: 'lose' }))

    expect(light.proteinG).toBe(120) // 2.0 x 60
    expect(heavy.proteinG).toBe(176) // 2.0 x 88
    expect(heavy.proteinG / light.proteinG).toBeCloseTo(88 / 60, 5)
  })

  it('is highest in a deficit, where muscle is what is at risk', () => {
    const lose = computeTargets(man({ goal: 'lose' })).proteinG
    const gain = computeTargets(man({ goal: 'gain' })).proteinG
    const maintain = computeTargets(man({ goal: 'maintain' })).proteinG

    expect(lose).toBe(160) // 2.0 x 80
    expect(gain).toBe(144) // 1.8 x 80
    expect(maintain).toBe(128) // 1.6 x 80
    expect(lose).toBeGreaterThan(gain)
    expect(gain).toBeGreaterThan(maintain)
  })
})

describe('the weight the per-kilogram figures apply to', () => {
  it('is the actual weight for anybody inside the usual range', () => {
    // The rule must be invisible to almost everybody. BMI 24.7 here.
    expect(referenceWeight({ weightKg: 80, heightCm: 180 })).toBe(80)
    expect(computeTargets(man({ goal: 'lose' })).proteinG).toBe(160)
    expect(computeTargets(man({ goal: 'lose' })).safetyNotes).toEqual([])
  })

  it('stops tracking total weight well above that range', () => {
    /*
     * The failure that produced this rule. At 2.0 g per kg of total bodyweight
     * a 130 kg man on a cut needs 260 g of protein inside 2176 calories — 48%
     * of his intake, denser than any single dish the app can plan with, and
     * unreachable on any diet. The g/kg figures come from studies on lean
     * populations; fat mass carries almost no protein requirement.
     */
    expect(referenceWeight({ weightKg: 130, heightCm: 170 })).toBeCloseTo(79.48, 1)

    const t = computeTargets({
      sex: 'male',
      ageYears: 45,
      heightCm: 170,
      weightKg: 130,
      activity: 'sedentary',
      goal: 'lose',
    })

    expect(t.proteinG).toBe(159) // 2.0 x 79.48, not 2.0 x 130
    expect(t.proteinG * 4).toBeLessThan(t.calories * 0.4)
  })

  it('applies to the fat floor too, for the same reason', () => {
    // 0.8 g/kg of 130 kg is 104 g, which is 43% of a cutting budget spent
    // before a single meal is chosen.
    const t = computeTargets({
      sex: 'male',
      ageYears: 45,
      heightCm: 170,
      weightKg: 130,
      activity: 'sedentary',
      goal: 'lose',
    })

    expect(t.fatG).toBe(64) // 0.8 x 79.48
  })

  it('says so when it changes the answer, and stays quiet when it does not', () => {
    const heavy = computeTargets({
      sex: 'male',
      ageYears: 45,
      heightCm: 170,
      weightKg: 130,
      activity: 'sedentary',
      goal: 'lose',
    })

    expect(heavy.safetyNotes.join(' ')).toMatch(/lean bodyweight/)
    expect(computeTargets(man()).safetyNotes.join(' ')).not.toMatch(/lean bodyweight/)
  })

  it('never returns more than the person actually weighs', () => {
    // A rule meant to reduce a number must not be able to raise one.
    for (const heightCm of [150, 165, 180, 195]) {
      for (const weightKg of [45, 60, 80, 110, 160]) {
        expect(referenceWeight({ weightKg, heightCm })).toBeLessThanOrEqual(weightKg)
      }
    }
  })

  it('has nothing to say about a half-filled form', () => {
    expect(referenceWeight({ weightKg: 80 })).toBe(80)
    expect(referenceWeight({})).toBe(0)
  })
})

describe('fat', () => {
  it('never drops below the hormonal floor, whatever the calorie target', () => {
    // 0.8 x 80 = 64 g. A quarter of 2209 calories would be 61 g, so the floor
    // is what decides this one.
    const t = computeTargets(man({ goal: 'lose' }))
    expect(t.fatG).toBe(64)
  })

  it('rises with calories once the floor is cleared', () => {
    const t = computeTargets(man({ goal: 'gain' }))
    expect(t.fatG).toBe(84) // 3034 x 0.25 / 9
    expect(t.fatG).toBeGreaterThan(0.8 * 80)
  })
})

describe('the deficit', () => {
  it('defaults to half a kilo a week', () => {
    // 0.5 x 7700 / 7 = 550 a day
    const t = computeTargets(man({ goal: 'lose' }))
    expect(t.calories).toBe(2759 - 550)
    expect(t.safetyNotes).toEqual([])
  })

  it('refuses a pace faster than three quarters of a kilo a week', () => {
    /*
     * Somebody who types "2 kg a week" is not going to be told yes and quietly
     * given something else. They get the number this app will plan, and the
     * sentence saying why.
     */
    const t = computeTargets(man({ goal: 'lose', paceKgPerWeek: 2 }))
    expect(t.safetyNotes[0]).toMatch(/0\.75 kg a week/)
    expect(t.calories).toBeGreaterThan(2759 - (2 * 7700) / 7)
  })

  it('caps the cut at a quarter of maintenance even at a legal pace', () => {
    /*
     * The pace cap alone is not enough. 0.75 kg/week is 825 calories a day,
     * which is a third of this person's maintenance — a percentage cap is what
     * makes the limit scale to the body it applies to.
     */
    const t = computeTargets(man({ goal: 'lose', paceKgPerWeek: 0.75 }))
    expect(t.calories).toBe(Math.round(2759 * 0.75))
    expect(t.safetyNotes).toContain('Adjustment capped at 25% of maintenance.')
  })

  it('holds a woman at 1200 calories and says so', () => {
    // 1584 maintenance, a 25% cut lands at 1188, which is below the floor.
    const t = computeTargets(woman({ goal: 'lose' }))
    expect(t.calories).toBe(1200)
    expect(t.safetyNotes.join(' ')).toMatch(/Held at 1200 calories/)
  })

  it('holds a man at 1500', () => {
    const t = computeTargets(man({ weightKg: 55, heightCm: 165, activity: 'sedentary', goal: 'lose' }))
    expect(t.calories).toBe(1500)
    expect(t.safetyNotes.join(' ')).toMatch(/Held at 1500 calories/)
  })

  it('never plans below the floor for anybody, at any pace, at any size', () => {
    /*
     * The property behind the two cases above. A floor that holds for the
     * examples somebody thought of and not for the shape they did not is not a
     * floor.
     */
    for (const sex of ['male', 'female']) {
      for (const weightKg of [45, 55, 70, 95, 140]) {
        for (const activity of ['sedentary', 'light', 'moderate', 'active', 'very_active']) {
          for (const paceKgPerWeek of [0.25, 0.5, 0.75, 3]) {
            const t = computeTargets({
              sex,
              ageYears: 70,
              heightCm: 150,
              weightKg,
              activity,
              goal: 'lose',
              paceKgPerWeek,
            })
            expect(t.calories).toBeGreaterThanOrEqual(sex === 'male' ? 1500 : 1200)
          }
        }
      }
    }
  })
})

describe('the surplus', () => {
  it('is smaller than the deficit, because gaining fat is easy', () => {
    // 0.25 kg/week = 275 a day, against 550 for the cut.
    const t = computeTargets(man({ goal: 'gain' }))
    expect(t.calories).toBe(2759 + 275)
  })

  it('refuses a pace faster than half a kilo a week', () => {
    /*
     * The pace cap and the percentage cap are separate limits and only one of
     * them binds at a time. For a big man half a kilo a week is 550 calories,
     * comfortably inside the 20% bound — so he is the only person who can show
     * that the pace cap is doing anything at all.
     */
    const t = computeTargets(man({ goal: 'gain', paceKgPerWeek: 2 }))

    expect(t.calories).toBe(2759 + 550) // 0.5 x 7700 / 7
    expect(t.safetyNotes).toContain('Pace limited to 0.5 kg a week. Faster costs muscle and rarely lasts.')
    expect(t.safetyNotes).not.toContain('Adjustment capped at 20% of maintenance.')
  })

  it('caps a bulk at a fifth over maintenance', () => {
    /*
     * A smaller person, deliberately. For a big man the pace cap binds first
     * and the percentage cap never fires at all — half a kilo a week is 550
     * calories, which is under a fifth of a 2759-calorie maintenance. The
     * percentage cap exists for the person it does bind for, and testing it on
     * somebody it cannot reach would have proved nothing.
     */
    const t = computeTargets(woman({ goal: 'gain', paceKgPerWeek: 2 }))

    expect(t.calories).toBe(1901) // 1584 x 1.2
    expect(t.safetyNotes).toContain('Adjustment capped at 20% of maintenance.')
  })

  it('does not confuse the two caps', () => {
    // 25% down, 20% up. A single constant used for both would pass every test
    // above that only ever cut.
    const cut = computeTargets(woman({ goal: 'lose', paceKgPerWeek: 5 }))
    const bulk = computeTargets(woman({ goal: 'gain', paceKgPerWeek: 5 }))

    expect(cut.safetyNotes).toContain('Adjustment capped at 25% of maintenance.')
    expect(bulk.safetyNotes).toContain('Adjustment capped at 20% of maintenance.')
  })
})

describe('recomposition', () => {
  it('is a small cut carried by protein, not a diet', () => {
    const t = computeTargets(man({ goal: 'recomp' }))
    expect(t.calories).toBe(Math.round(2759 * 0.95))
    expect(t.proteinG).toBe(160) // the same as a cut: 2.0 x 80
  })
})

describe('carbohydrate', () => {
  it('takes what is left', () => {
    const t = computeTargets(man({ goal: 'maintain' }))
    expect(t.proteinG * 4 + t.fatG * 9 + t.carbG * 4).toBeCloseTo(t.calories, -1)
  })

  it('raises calories rather than prescribing a near-zero carb day', () => {
    /*
     * A tall, older, sedentary man on a cut: 192 g of protein and 77 g of fat
     * is 1461 calories against a 1658 target, which leaves 49 g of
     * carbohydrate. That is not a plan somebody trains on, so the budget moves.
     */
    const t = computeTargets({
      sex: 'male',
      ageYears: 60,
      heightCm: 188,
      weightKg: 96,
      activity: 'sedentary',
      goal: 'lose',
    })

    expect(t.carbG).toBe(50)
    expect(t.calories).toBe(1661) // 192x4 + 77x9 + 50x4
    expect(t.safetyNotes.join(' ')).toMatch(/Calories raised/)
  })

  it('never returns a negative or trivial carb target', () => {
    for (const weightKg of [50, 80, 110, 150, 200]) {
      for (const goal of ['lose', 'maintain', 'gain', 'recomp']) {
        const t = computeTargets({
          sex: 'male',
          ageYears: 60,
          heightCm: 160,
          weightKg,
          activity: 'sedentary',
          goal,
        })
        expect(t.carbG).toBeGreaterThanOrEqual(50)
      }
    }
  })
})

describe('every goal at once', () => {
  it('is what the screen shows, so somebody can compare before choosing', () => {
    const rows = allGoals(man())
    expect(rows.map((r) => r.goal)).toEqual(['lose', 'maintain', 'gain', 'recomp'])
    expect(rows.every((r) => r.label && r.calories > 0)).toBe(true)
  })

  it('orders the calories the way the goals imply', () => {
    const by = Object.fromEntries(allGoals(man()).map((r) => [r.goal, r.calories]))
    expect(by.lose).toBeLessThan(by.recomp)
    expect(by.recomp).toBeLessThan(by.maintain)
    expect(by.maintain).toBeLessThan(by.gain)
  })
})

describe('who this app will not plan for', () => {
  it('refuses anybody under eighteen', () => {
    /*
     * Not a legal box. A calorie target handed to a fifteen-year-old is handed
     * to somebody whose body is still being built and who is the likeliest
     * person in the room to take it too far.
     */
    const result = screenProfile(man({ ageYears: 17 }))
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('under_18')
    expect(result.message).toMatch(/doctor or a dietitian/)
  })

  it('lets eighteen through', () => {
    expect(screenProfile(man({ ageYears: 18 })).ok).toBe(true)
  })

  it('refuses to plan a cut for somebody already underweight', () => {
    // 45 kg at 170 cm is a BMI of 15.6.
    const result = screenProfile(man({ weightKg: 45, heightCm: 170, goal: 'lose' }))
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('underweight_cut')
    expect(result.suggest).toBe('gain')
  })

  it('refuses a recomp there too, because a recomp is still a deficit', () => {
    // The case that gets missed: recomp reads as neutral and is not.
    const result = screenProfile(man({ weightKg: 45, heightCm: 170, goal: 'recomp' }))
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('underweight_cut')
  })

  it('still helps that person gain', () => {
    expect(screenProfile(man({ weightKg: 45, heightCm: 170, goal: 'gain' })).ok).toBe(true)
    expect(screenProfile(man({ weightKg: 45, heightCm: 170, goal: 'maintain' })).ok).toBe(true)
  })

  it('does not refuse somebody merely slim', () => {
    // BMI 18.0 at 52 kg / 170 cm — under the usual range, above the line where
    // this stops being our call.
    expect(screenProfile(man({ weightKg: 52, heightCm: 170, goal: 'lose' })).ok).toBe(true)
  })

  it('says nothing at all until the form is filled in', () => {
    // An empty form must not produce a refusal, which reads as a judgement of
    // something the person has not yet told us.
    expect(screenProfile({ goal: 'lose' })).toEqual({ ok: false, reason: 'incomplete' })
    expect(screenProfile(null).reason).toBe('incomplete')
  })

  it('waits for every field, not just the first one missing', () => {
    /*
     * A form is filled in top to bottom, so for most of the time somebody
     * spends on this screen exactly one field is blank. Each of the three has
     * to hold on its own — a check that only catches a missing age passes every
     * test written with an empty object and still divides by zero the moment
     * somebody types their age and stops.
     */
    expect(screenProfile({ ageYears: 30, heightCm: 180, goal: 'lose' }).reason).toBe('incomplete')
    expect(screenProfile({ ageYears: 30, weightKg: 80, goal: 'lose' }).reason).toBe('incomplete')
    expect(screenProfile({ heightCm: 180, weightKg: 80, goal: 'lose' }).reason).toBe('incomplete')
  })
})

describe('the goal we open on', () => {
  it('is the one their numbers point at', () => {
    expect(suggestedGoal({ weightKg: 50, heightCm: 175 })).toBe('gain') // BMI 16.3
    expect(suggestedGoal({ weightKg: 75, heightCm: 175 })).toBe('recomp') // BMI 24.5
    expect(suggestedGoal({ weightKg: 90, heightCm: 175 })).toBe('lose') // BMI 29.4
  })

  it('assumes nothing when it knows nothing', () => {
    expect(suggestedGoal({})).toBe('maintain')
    expect(suggestedGoal(null)).toBe('maintain')
  })
})
