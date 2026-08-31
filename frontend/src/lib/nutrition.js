/**
 * What to eat, worked out rather than guessed.
 *
 * Nothing in this file may be delegated to a model. These numbers decide what
 * somebody eats every day, so they are reproducible, auditable and bounded — a
 * model may later *describe* what this computes, and may never compute it.
 *
 * The formulas are the standard ones rather than anything invented here:
 * Mifflin-St Jeor for resting metabolism, which is the best-validated general
 * estimator; activity multipliers from the same literature; and protein set per
 * kilogram of bodyweight rather than as a share of calories.
 *
 * That last one is the difference between this and most calculators on the
 * internet. A percentage split gives a 60 kg person and a 100 kg person the
 * same protein when their needs differ by two thirds, and it is why "40/30/30"
 * advice fails the people who most need it.
 */

/** Multipliers on resting metabolism, by how much somebody actually moves. */
const ACTIVITY_MULTIPLIER = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
}

export const ACTIVITY_LABELS = {
  sedentary: 'Desk job, little exercise',
  light: 'Training 1–3 days a week',
  moderate: 'Training 3–5 days a week',
  active: 'Training 6–7 days a week',
  very_active: 'Physical job, or training twice a day',
}

export const GOAL_LABELS = {
  lose: 'Lose fat',
  maintain: 'Maintain',
  gain: 'Gain weight',
  recomp: 'Build muscle, stay lean',
}

/**
 * Intake floors we refuse to plan below, whatever is asked for.
 *
 * Not a suggestion. Somebody who asks this app for a 900-calorie day is asking
 * for something that costs them muscle, their period, and their hair, and an
 * app that simply obliges is not neutral — it is complicit.
 */
const CALORIE_FLOOR = { female: 1200, male: 1500 }

/** The adjustment is capped as a share of maintenance, independently of the floors. */
const MAX_DEFICIT_FRACTION = 0.25
const MAX_SURPLUS_FRACTION = 0.2

/** Roughly the energy in a kilogram of body mass. */
const KCAL_PER_KG = 7700
const MAX_LOSS_KG_PER_WEEK = 0.75
const MAX_GAIN_KG_PER_WEEK = 0.5

/**
 * Protein in grams per kilogram of bodyweight.
 *
 * Highest in a deficit, where the job is protecting muscle while eating less —
 * the whole point of lifting through a cut. The range across these goals is the
 * one the research supports; anything much above adds cost without benefit.
 */
const PROTEIN_G_PER_KG = { lose: 2.0, recomp: 2.0, gain: 1.8, maintain: 1.6 }

/** Below this, hormone production suffers. Fat is not the enemy. */
const FAT_G_PER_KG_FLOOR = 0.8
const MIN_CARB_G = 50

/**
 * The BMI above which protein stops being scaled to total bodyweight.
 *
 * The g/kg figures above come from studies on lean, training populations, and
 * applying them to total bodyweight well outside that range overstates the
 * requirement: adipose tissue carries almost no protein demand. Clinical
 * practice scales protein to lean mass for exactly this reason.
 *
 * Found by trying to build a day of food that met the result. A 130 kg man on a
 * cut came out needing 260 g of protein inside 2176 calories — 48% of his
 * intake, above the densest single dish in the food library, unreachable on any
 * diet including chicken and whey. A target nobody can hit is not a safe target
 * that happens to be strict; it is a number that teaches somebody the app is
 * wrong about them.
 *
 * **What this is.** A proxy for lean mass, using height, because asking for a
 * body-fat percentage would get a guess in return and a guess is worse than
 * this. 27.5 rather than 25 so that a genuinely muscular build is not scaled
 * down. It changes nothing for anybody inside the usual range.
 *
 * **What it is not.** Validated. It is a considered approximation of standard
 * practice, and somebody who knows their body composition has better
 * information than this rule does.
 */
const PROTEIN_REFERENCE_BMI = 27.5

/**
 * The bodyweight the per-kilogram figures are applied to.
 *
 * The person's own, until that stops being the useful number.
 */
export function referenceWeight({ weightKg, heightCm }) {
  if (!weightKg || !heightCm) return weightKg || 0
  const metres = heightCm / 100
  return Math.min(weightKg, PROTEIN_REFERENCE_BMI * metres * metres)
}

/** Mifflin-St Jeor. */
export function basalMetabolicRate({ sex, ageYears, heightCm, weightKg }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears
  return sex === 'male' ? base + 5 : base - 161
}

export function bmi(weightKg, heightCm) {
  if (!weightKg || !heightCm) return 0
  const metres = heightCm / 100
  return weightKg / (metres * metres)
}

/**
 * What a BMI means, in the words somebody would use.
 *
 * WHO cut-offs. Worth knowing that they were derived from European populations
 * and that the WHO itself publishes lower thresholds for Asian populations,
 * where the same index carries more metabolic risk — so this is a signpost, not
 * a diagnosis, and the copy says so.
 */
export function bmiCategory(value) {
  if (!value) return null
  if (value < 18.5) return { key: 'under', label: 'Under the usual range' }
  if (value < 25) return { key: 'normal', label: 'Usual range' }
  if (value < 30) return { key: 'over', label: 'Above the usual range' }
  return { key: 'obese', label: 'Well above the usual range' }
}

/**
 * Daily targets for one goal.
 *
 * Every clamp that fires leaves a note, because a number that was quietly
 * changed is worse than one that was refused: somebody plans around it, it does
 * not do what they expected, and they conclude the app is wrong rather than
 * that they were protected.
 */
export function computeTargets(profile) {
  const notes = []
  const bmrValue = basalMetabolicRate(profile)
  const tdee = bmrValue * (ACTIVITY_MULTIPLIER[profile.activity] ?? ACTIVITY_MULTIPLIER.light)

  const goalCalories = applyGoalAdjustment(tdee, profile, notes)

  /*
   * Both per-kilogram figures run off the reference weight, not the scale
   * reading. The fat floor has the same problem as protein and for the same
   * reason: 0.8 g/kg of a 130 kg body is 104 g, which is 43% of a cutting
   * budget spent before any food is chosen.
   */
  const basis = referenceWeight(profile)
  if (basis < profile.weightKg) {
    notes.push(
      'Protein and fat are set for a lean bodyweight rather than your total, which is how they are prescribed clinically.',
    )
  }

  const proteinG = Math.round((PROTEIN_G_PER_KG[profile.goal] ?? PROTEIN_G_PER_KG.maintain) * basis)
  const fatG = Math.round(Math.max(FAT_G_PER_KG_FLOOR * basis, (goalCalories * 0.25) / 9))

  /*
   * Carbohydrate takes the remainder. When protein and fat alone overshoot the
   * budget — possible at a high bodyweight on a low target — the calories go up
   * rather than the carbohydrate going to nothing. Prescribing a near-zero carb
   * day to somebody who lifts is how a plan gets abandoned in week two.
   */
  const proteinKcal = proteinG * 4
  const fatKcal = fatG * 9
  let calories = goalCalories
  let carbG = Math.round((calories - proteinKcal - fatKcal) / 4)

  if (carbG < MIN_CARB_G) {
    calories = proteinKcal + fatKcal + MIN_CARB_G * 4
    carbG = MIN_CARB_G
    notes.push('Calories raised so protein, fat and a minimum of carbohydrate all fit.')
  }

  return {
    bmr: Math.round(bmrValue),
    tdee: Math.round(tdee),
    calories: Math.round(calories),
    proteinG,
    fatG,
    carbG,
    safetyNotes: notes,
  }
}

function applyGoalAdjustment(tdee, profile, notes) {
  if (profile.goal === 'maintain') return tdee

  if (profile.goal === 'recomp') {
    // Recomposition runs on protein and training, not on a large cut.
    return clampToFloor(tdee * 0.95, profile, notes)
  }

  const losing = profile.goal === 'lose'
  const direction = losing ? -1 : 1
  const maxPace = losing ? MAX_LOSS_KG_PER_WEEK : MAX_GAIN_KG_PER_WEEK
  const requested = profile.paceKgPerWeek ?? (losing ? 0.5 : 0.25)

  let pace = requested
  if (pace > maxPace) {
    pace = maxPace
    notes.push(`Pace limited to ${maxPace} kg a week. Faster costs muscle and rarely lasts.`)
  }

  const dailyDelta = (pace * KCAL_PER_KG) / 7
  let target = tdee + direction * dailyDelta

  const maxFraction = losing ? MAX_DEFICIT_FRACTION : MAX_SURPLUS_FRACTION
  const bound = losing ? tdee * (1 - maxFraction) : tdee * (1 + maxFraction)
  const exceeded = losing ? target < bound : target > bound

  if (exceeded) {
    target = bound
    notes.push(`Adjustment capped at ${Math.round(maxFraction * 100)}% of maintenance.`)
  }

  return clampToFloor(target, profile, notes)
}

function clampToFloor(target, profile, notes) {
  const floor = CALORIE_FLOOR[profile.sex] ?? CALORIE_FLOOR.female
  if (target >= floor) return target

  notes.push(`Held at ${floor} calories. Below that this stops being a diet and starts being harm.`)
  return floor
}

/** Every goal at once, which is what somebody actually wants to see. */
export function allGoals(profile) {
  return ['lose', 'maintain', 'gain', 'recomp'].map((goal) => ({
    goal,
    label: GOAL_LABELS[goal],
    ...computeTargets({ ...profile, goal }),
  }))
}

/**
 * Whether this app should be planning a diet for this person at all.
 *
 * A calorie calculator handed to a stranger is a health instrument, and two
 * cases are not ours to serve. Both refuse rather than adjust, because a
 * quietly softened number still reads as approval of the request.
 */
export function screenProfile(profile) {
  if (!profile?.ageYears || !profile?.heightCm || !profile?.weightKg) {
    return { ok: false, reason: 'incomplete' }
  }

  if (profile.ageYears < 18) {
    return {
      ok: false,
      reason: 'under_18',
      message:
        'Bodies still growing need a professional rather than a calculator. Talk to a doctor or a dietitian before changing how you eat.',
    }
  }

  const index = bmi(profile.weightKg, profile.heightCm)

  if (index < 17.5 && (profile.goal === 'lose' || profile.goal === 'recomp')) {
    return {
      ok: false,
      reason: 'underweight_cut',
      message:
        'Your weight is already below the usual range, so this app will not plan a deficit. If you would like to gain, it can help with that.',
      suggest: 'gain',
    }
  }

  return { ok: true }
}

/** A sensible starting goal, so the first screen is not a blank form. */
export function suggestedGoal(profile) {
  const index = bmi(profile?.weightKg, profile?.heightCm)
  if (!index) return 'maintain'

  if (index < 18.5) return 'gain'
  if (index >= 25) return 'lose'
  return 'recomp'
}
