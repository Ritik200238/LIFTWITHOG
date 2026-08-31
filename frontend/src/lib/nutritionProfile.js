/**
 * The join between what the app already knows and what the maths needs.
 *
 * Three of the five things a calorie target needs are already in the profile:
 * sex, the unit somebody thinks in, and every weigh-in they have logged. Asking
 * for those again would be the app admitting it does not read its own records —
 * and the weight in particular has to come from the log, because a target
 * computed from a number typed once in March is wrong by June.
 *
 * **The dangerous part is the unit.** Weigh-ins are stored in whatever unit the
 * person uses and the formulas are metric, so every path out of here converts
 * or is wrong by a factor of 2.2. That is not a hypothetical: this project has
 * already shipped one unit-scale bug that turned 50 grams of oats into two and
 * a half kilos, and it had passing tests.
 */

import { bmi, screenProfile, suggestedGoal } from './nutrition.js'

export const LB_TO_KG = 0.45359237
export const CM_PER_INCH = 2.54
export const CM_PER_FOOT = 30.48

/** What the app stores for nutrition, on top of what it already had. */
export const DEFAULT_NUTRITION = {
  ageYears: null,
  heightCm: null,
  activity: 'light',
  goal: null,
  diet: 'nonveg',
  paceKgPerWeek: null,
}

/**
 * The most recent weigh-in, in kilograms.
 *
 * Entries are appended and sorted by date, so the last one is the newest.
 * Returns null rather than zero when there is nothing: zero is a weight the
 * maths will happily use.
 */
export function latestWeightKg(state) {
  const log = Array.isArray(state?.bodyweight) ? state.bodyweight : []
  if (log.length === 0) return null

  const latest = log[log.length - 1]
  const value = Number(latest?.w ?? latest?.kg ?? 0)
  if (!Number.isFinite(value) || value <= 0) return null

  return state?.unit === 'lb' ? value * LB_TO_KG : value
}

/** Kilograms back into the unit somebody reads in. */
export function weightInUnit(kg, unit) {
  if (!Number.isFinite(kg)) return null
  return unit === 'lb' ? kg / LB_TO_KG : kg
}

/** Centimetres from feet and inches, for the people who think in those. */
export function heightToCm(feet, inches) {
  const ft = Number(feet) || 0
  const inch = Number(inches) || 0
  if (ft <= 0 && inch <= 0) return null
  return ft * CM_PER_FOOT + inch * CM_PER_INCH
}

/** And back, for showing it to them. */
export function cmToHeight(cm) {
  if (!cm) return { feet: null, inches: null }
  const totalInches = cm / CM_PER_INCH
  const feet = Math.floor(totalInches / 12)
  const inches = Math.round(totalInches - feet * 12)

  // 5 ft 12 in is 6 ft. Rounding the remainder can produce it.
  if (inches === 12) return { feet: feet + 1, inches: 0 }
  return { feet, inches }
}

/**
 * Everything the maths needs, assembled from the app's own state.
 *
 * `goal` is left as whatever was chosen; the caller decides whether an unset
 * goal means "suggest one" or "ask". Filling it in here would mean the app
 * silently picking somebody's diet for them.
 */
export function profileFrom(state) {
  const stored = { ...DEFAULT_NUTRITION, ...(state?.nutrition ?? {}) }

  return {
    sex: state?.body === 'female' ? 'female' : 'male',
    ageYears: Number(stored.ageYears) || null,
    heightCm: Number(stored.heightCm) || null,
    weightKg: latestWeightKg(state),
    activity: stored.activity ?? 'light',
    goal: stored.goal,
    diet: stored.diet ?? 'nonveg',
    paceKgPerWeek: stored.paceKgPerWeek ?? null,
  }
}

/**
 * What the app still needs before it can say anything, in the order to ask.
 *
 * Weight is first because it is the only one the person may already have
 * answered elsewhere, and sending them to the weigh-in they already use beats
 * a second place to type their weight that then disagrees with the first.
 */
export function missingFields(profile) {
  const missing = []
  if (!profile?.weightKg) missing.push('weight')
  if (!profile?.heightCm) missing.push('height')
  if (!profile?.ageYears) missing.push('age')
  return missing
}

export function isComplete(profile) {
  return missingFields(profile).length === 0
}

/**
 * The whole state of the nutrition screen, decided in one place.
 *
 * The view then renders a state rather than working one out from four
 * conditions — which is how a screen ends up showing a refusal and a plan at
 * the same time.
 */
export function nutritionState(state) {
  const profile = profileFrom(state)
  const missing = missingFields(profile)

  if (missing.length > 0) {
    return { status: 'incomplete', profile, missing }
  }

  const goal = profile.goal ?? suggestedGoal(profile)
  const screened = screenProfile({ ...profile, goal })

  if (!screened.ok) {
    return { status: 'refused', profile, goal, screened, bmi: bmi(profile.weightKg, profile.heightCm) }
  }

  return {
    status: 'ready',
    profile: { ...profile, goal },
    goal,
    chosen: profile.goal != null,
    bmi: bmi(profile.weightKg, profile.heightCm),
  }
}

/**
 * A plausible age and height are still worth checking.
 *
 * Not to be pedantic — a mistyped height is the single input that silently
 * distorts every number downstream, because 17 cm and 170 cm both look like a
 * number to a form.
 */
export function validate({ ageYears, heightCm }) {
  const problems = {}

  if (ageYears != null && ageYears !== '') {
    const age = Number(ageYears)
    if (!Number.isFinite(age) || age < 13 || age > 100) {
      problems.ageYears = 'That does not look like an age this app can plan for.'
    }
  }

  if (heightCm != null && heightCm !== '') {
    const height = Number(heightCm)
    if (!Number.isFinite(height) || height < 120 || height > 230) {
      problems.heightCm = 'Height should be somewhere between 120 and 230 cm.'
    }
  }

  return problems
}
