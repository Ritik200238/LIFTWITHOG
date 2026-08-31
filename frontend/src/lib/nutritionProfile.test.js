import { describe, it, expect } from 'vitest'
import {
  DEFAULT_NUTRITION,
  cmToHeight,
  heightToCm,
  isComplete,
  latestWeightKg,
  missingFields,
  nutritionState,
  profileFrom,
  validate,
  weightInUnit,
} from './nutritionProfile.js'

/**
 * The join between the app's records and the maths.
 *
 * Almost every test here is about units. The formulas are metric, weigh-ins are
 * stored in whatever the person uses, and a missed conversion does not throw —
 * it produces a confident target computed for somebody 2.2 times their size.
 * This project has already shipped one bug of exactly that shape, with passing
 * tests, so these are written as though it will happen again.
 */

const state = (over = {}) => ({
  unit: 'kg',
  body: 'male',
  bodyweight: [{ d: '2026-08-01', w: 80, t: 1 }],
  nutrition: { ageYears: 30, heightCm: 180, activity: 'moderate', goal: 'lose', diet: 'nonveg' },
  ...over,
})

describe('reading the weigh-in log', () => {
  it('takes the most recent entry', () => {
    const log = [
      { d: '2026-06-01', w: 84 },
      { d: '2026-07-01', w: 82 },
      { d: '2026-08-01', w: 80 },
    ]
    expect(latestWeightKg(state({ bodyweight: log }))).toBe(80)
  })

  it('converts pounds, because the formulas are metric', () => {
    /*
     * The one that matters. 180 lb is 81.6 kg; used unconverted it is a person
     * more than twice their real size, and every calorie and protein number
     * downstream is confidently wrong.
     */
    const pounds = state({ unit: 'lb', bodyweight: [{ d: '2026-08-01', w: 180 }] })
    expect(latestWeightKg(pounds)).toBeCloseTo(81.65, 2)
  })

  it('leaves kilograms alone', () => {
    expect(latestWeightKg(state({ unit: 'kg', bodyweight: [{ d: '2026-08-01', w: 80 }] }))).toBe(80)
  })

  it('round-trips through the unit somebody reads in', () => {
    expect(weightInUnit(81.6466, 'lb')).toBeCloseTo(180, 3)
    expect(weightInUnit(80, 'kg')).toBe(80)
    expect(weightInUnit(null, 'kg')).toBe(null)
  })

  it('says nothing rather than zero when there is no weigh-in', () => {
    // Zero is a weight the maths will happily use, and a BMI of zero renders as
    // a number on a screen.
    expect(latestWeightKg(state({ bodyweight: [] }))).toBe(null)
    expect(latestWeightKg({})).toBe(null)
    expect(latestWeightKg(state({ bodyweight: [{ d: '2026-08-01', w: 0 }] }))).toBe(null)
  })
})

describe('height in feet and inches', () => {
  it('converts to centimetres', () => {
    expect(heightToCm(5, 10)).toBeCloseTo(177.8, 4)
    expect(heightToCm(6, 0)).toBeCloseTo(182.88, 4)
  })

  it('converts back', () => {
    expect(cmToHeight(177.8)).toEqual({ feet: 5, inches: 10 })
    expect(cmToHeight(182.88)).toEqual({ feet: 6, inches: 0 })
  })

  it('never says twelve inches', () => {
    // 5 ft 11.6 in rounds to 5 ft 12, which is not a height anybody writes.
    expect(cmToHeight(182.5)).toEqual({ feet: 6, inches: 0 })
  })

  it('has nothing to convert when nothing was entered', () => {
    expect(heightToCm(0, 0)).toBe(null)
    expect(heightToCm(null, null)).toBe(null)
    expect(cmToHeight(null)).toEqual({ feet: null, inches: null })
  })

  it('round-trips the heights people actually are', () => {
    for (let feet = 4; feet <= 7; feet += 1) {
      for (let inches = 0; inches < 12; inches += 1) {
        expect(cmToHeight(heightToCm(feet, inches))).toEqual({ feet, inches })
      }
    }
  })
})

describe('assembling the profile', () => {
  it('takes sex from the profile the app already has', () => {
    // Asking again would be the app admitting it does not read its own records.
    expect(profileFrom(state({ body: 'female' })).sex).toBe('female')
    expect(profileFrom(state({ body: 'male' })).sex).toBe('male')
  })

  it('defaults sex rather than producing an undefined one', () => {
    // `undefined` here silently means "female" to the BMR formula, which is a
    // 166-calorie error nobody would ever see.
    expect(profileFrom(state({ body: undefined })).sex).toBe('male')
  })

  it('takes the weight from the log, in kilograms', () => {
    const pounds = state({ unit: 'lb', bodyweight: [{ d: '2026-08-01', w: 200 }] })
    expect(profileFrom(pounds).weightKg).toBeCloseTo(90.72, 2)
  })

  it('fills in what has never been set', () => {
    const blank = profileFrom({ body: 'male', bodyweight: [] })
    expect(blank.activity).toBe(DEFAULT_NUTRITION.activity)
    expect(blank.diet).toBe(DEFAULT_NUTRITION.diet)
    expect(blank.goal).toBe(null)
    expect(blank.weightKg).toBe(null)
  })

  it('does not choose a goal on somebody behalf', () => {
    // A suggested goal is offered by the screen. Filling it in here would mean
    // the app quietly deciding whether somebody is cutting or bulking.
    expect(profileFrom(state({ nutrition: {} })).goal).toBe(null)
  })
})

describe('what is still missing', () => {
  it('asks for weight first, because that one may already exist', () => {
    const empty = profileFrom({ body: 'male', bodyweight: [], nutrition: {} })
    expect(missingFields(empty)).toEqual(['weight', 'height', 'age'])
  })

  it('names only what is actually absent', () => {
    const partial = profileFrom(state({ nutrition: { ageYears: 30 } }))
    expect(missingFields(partial)).toEqual(['height'])
  })

  it('is complete when all three are there', () => {
    expect(isComplete(profileFrom(state()))).toBe(true)
  })
})

describe('the state of the screen', () => {
  it('is incomplete until the app can say something', () => {
    const result = nutritionState({ body: 'male', bodyweight: [], nutrition: {} })
    expect(result.status).toBe('incomplete')
    expect(result.missing.length).toBe(3)
  })

  it('is ready once it can, and suggests a goal without committing to one', () => {
    const result = nutritionState(state({ nutrition: { ageYears: 30, heightCm: 180 } }))
    expect(result.status).toBe('ready')
    expect(result.goal).toBeTruthy()
    expect(result.chosen).toBe(false) // suggested, not chosen
    expect(result.bmi).toBeCloseTo(24.69, 2)
  })

  it('knows when the person has chosen for themselves', () => {
    const result = nutritionState(state())
    expect(result.chosen).toBe(true)
    expect(result.goal).toBe('lose')
  })

  it('refuses rather than planning, when the maths says to', () => {
    /*
     * The refusal has to reach the screen as a state of its own. A screen that
     * works this out from separate conditions is a screen that eventually shows
     * a refusal and a meal plan at the same time.
     */
    const child = nutritionState(state({ nutrition: { ageYears: 15, heightCm: 170, goal: 'lose' } }))
    expect(child.status).toBe('refused')
    expect(child.screened.reason).toBe('under_18')

    const underweight = nutritionState(
      state({
        bodyweight: [{ d: '2026-08-01', w: 45 }],
        nutrition: { ageYears: 30, heightCm: 175, goal: 'lose' },
      }),
    )
    expect(underweight.status).toBe('refused')
    expect(underweight.screened.reason).toBe('underweight_cut')
  })

  it('carries the refusal through the pound path too', () => {
    // A refusal that only fires in kilograms is not a refusal. 99 lb at 175 cm
    // is a BMI of 14.7.
    const result = nutritionState(
      state({
        unit: 'lb',
        bodyweight: [{ d: '2026-08-01', w: 99 }],
        nutrition: { ageYears: 30, heightCm: 175, goal: 'lose' },
      }),
    )
    expect(result.status).toBe('refused')
    expect(result.screened.reason).toBe('underweight_cut')
  })
})

describe('checking what was typed', () => {
  it('catches a height that is off by a decimal point', () => {
    /*
     * The input that silently distorts everything downstream, because 17 and
     * 170 both look like a number to a form and only one of them is a person.
     */
    expect(validate({ heightCm: 17 }).heightCm).toBeTruthy()
    expect(validate({ heightCm: 1700 }).heightCm).toBeTruthy()
    expect(validate({ heightCm: 170 }).heightCm).toBeUndefined()
  })

  it('catches an impossible age', () => {
    expect(validate({ ageYears: 3 }).ageYears).toBeTruthy()
    expect(validate({ ageYears: 250 }).ageYears).toBeTruthy()
    expect(validate({ ageYears: 30 }).ageYears).toBeUndefined()
  })

  it('says nothing about a field somebody has not filled in yet', () => {
    // Validation that fires while somebody is still typing is an app that
    // argues with you mid-sentence.
    expect(validate({})).toEqual({})
    expect(validate({ ageYears: '', heightCm: '' })).toEqual({})
  })

  it('accepts the edges it claims to accept', () => {
    expect(validate({ ageYears: 13, heightCm: 120 })).toEqual({})
    expect(validate({ ageYears: 100, heightCm: 230 })).toEqual({})
  })
})
