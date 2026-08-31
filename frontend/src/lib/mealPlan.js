/**
 * Turning a calorie and protein target into a day somebody can actually eat.
 *
 * This is deliberately arithmetic rather than a model. A language model asked
 * for a 2200-calorie day with 160 g of protein will produce something that
 * reads beautifully and adds up to 1700 — it is not counting, it is writing
 * about counting. Every dish here is scaled from real per-100 g figures and the
 * total is measured, not asserted.
 *
 * **The rule this file exists to enforce: it reports what it could not do.**
 * A planner that quietly hands back a day 40 g short of protein and calls it
 * the plan has done something worse than fail — the person follows it for a
 * month and concludes their body is the problem. Every plan carries the gap it
 * did not close, and the screen shows it.
 *
 * The protein target is treated as the binding constraint and calories as the
 * thing to land near. That is the right way round: eating 100 calories over is
 * a rounding error, and eating 40 g of protein under, every day, through a cut,
 * is the difference between losing fat and losing muscle.
 */

import { MEALS, macrosOf, mealsFrom, portionsOf } from './foods.js'

/**
 * How the day divides.
 *
 * Four eating occasions, weighted the way people actually eat rather than
 * evenly — a snack is a snack. Somebody who eats differently can still follow
 * this; the totals are what matter and they are stated per meal.
 */
export const SLOT_SHARE = { breakfast: 0.25, lunch: 0.35, snack: 0.1, dinner: 0.3 }
export const SLOTS = ['breakfast', 'lunch', 'snack', 'dinner']

export const SLOT_LABELS = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  snack: 'Snack',
  dinner: 'Dinner',
}

/**
 * How far a dish may be scaled from its written serving.
 *
 * Outside this it stops being the dish. Half a portion is a light version; two
 * and a half is a big eater's version; four is a number that makes somebody
 * close the app.
 */
export const MIN_SCALE = 0.5
export const MAX_SCALE = 2.5

/** Protein is the constraint, so missing it costs more than missing calories. */
const PROTEIN_PRIORITY = 3

/**
 * Overshooting protein is a real cost, not a free win.
 *
 * Cheaper than falling short, because the harm is not symmetrical — but not
 * zero, which is what it used to be. A planner that only ever pushed protein up
 * produced days 30% over target, and every one of those grams displaced the
 * carbohydrate the same screen had just prescribed. The plan stopped matching
 * the numbers printed directly above it.
 */
const PROTEIN_OVERSHOOT = 1

/** Bounded, because this runs on every render and the library will grow. */
const MAX_REFINE_PASSES = 6

/** How many of the best-fitting dishes rotate across the week. */
const ROTATION_DEPTH = 3

/** Close enough to stop calling it a gap. */
export const CALORIE_TOLERANCE = 0.05
export const PROTEIN_TOLERANCE = 0.1

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))

/**
 * How badly this dish, scaled as far as it may be, fits this slot.
 *
 * Both terms are in calories so they can be added: a gram of protein is four,
 * and the priority multiplier is what makes the planner reach for the chicken
 * over the rice when it has to choose.
 */
function costOf(meal, slotKcal, slotProtein) {
  const base = macrosOf(meal)
  if (base.kcal <= 0) return Infinity

  const scale = clamp(slotKcal / base.kcal, MIN_SCALE, MAX_SCALE)
  const at = macrosOf(meal, scale)

  const proteinMiss = Math.max(0, slotProtein - at.proteinG)
  const proteinOver = Math.max(0, at.proteinG - slotProtein)

  return (
    Math.abs(at.kcal - slotKcal) +
    proteinMiss * 4 * PROTEIN_PRIORITY +
    // Overshooting protein is a mild inefficiency, not a failure. Penalising it
    // symmetrically makes the planner avoid the chicken it should be reaching
    // for whenever the slot's share happens to be modest.
    proteinOver * 4 * 0.25
  )
}

function servingFor(meal, slotKcal) {
  const base = macrosOf(meal)
  if (base.kcal <= 0) return MIN_SCALE
  return clamp(slotKcal / base.kcal, MIN_SCALE, MAX_SCALE)
}

function describe(meal, scale) {
  const at = macrosOf(meal, scale)
  return {
    id: meal.id,
    slot: meal.slot,
    name: meal.name,
    servings: Math.round(scale * 100) / 100,
    portions: portionsOf(meal, scale),
    kcal: Math.round(at.kcal),
    proteinG: Math.round(at.proteinG),
    fatG: Math.round(at.fatG),
    carbG: Math.round(at.carbG),
  }
}

function sumOf(chosen) {
  return chosen.reduce(
    (total, { meal, scale }) => {
      const at = macrosOf(meal, scale)
      return {
        kcal: total.kcal + at.kcal,
        proteinG: total.proteinG + at.proteinG,
        fatG: total.fatG + at.fatG,
        carbG: total.carbG + at.carbG,
      }
    },
    { kcal: 0, proteinG: 0, fatG: 0, carbG: 0 },
  )
}

/**
 * A day of food for one set of targets.
 *
 * `dayIndex` rotates through the best-fitting dishes rather than randomising,
 * so the same person on the same day gets the same plan — a plan that changes
 * when you reopen the app is not a plan, and it cannot be tested either.
 */
export function planDay(target, options = {}) {
  const { diet = 'nonveg', dayIndex = 0, library = MEALS } = options

  const calories = Number(target?.calories) || 0
  const proteinTarget = Number(target?.proteinG) || 0

  if (calories <= 0) {
    return emptyPlan(target, ['There is no calorie target to plan against yet.'])
  }

  const allowed = mealsFrom(library, diet)

  const chosen = []
  for (const slot of SLOTS) {
    const share = SLOT_SHARE[slot]
    const slotKcal = calories * share
    const slotProtein = proteinTarget * share

    const candidates = allowed
      .filter((meal) => meal.slot === slot)
      .map((meal) => ({ meal, cost: costOf(meal, slotKcal, slotProtein) }))
      // Cost first, id second. The tie-break matters: without it the plan
      // depends on the order of an array literal, and a reordered library
      // silently changes everybody's diet.
      .sort((a, b) => a.cost - b.cost || a.meal.id.localeCompare(b.meal.id))

    if (candidates.length === 0) continue

    const pick = candidates[dayIndex % Math.min(ROTATION_DEPTH, candidates.length)]
    chosen.push({ meal: pick.meal, scale: servingFor(pick.meal, slotKcal), slotKcal })
  }

  if (chosen.length === 0) {
    return emptyPlan(target, ['No meals match that diet yet.'])
  }

  const day = { calories, proteinG: proteinTarget }
  return report(refine(chosen, allowed, day), day)
}

/**
 * How far a whole day is from what was asked for, in calories.
 *
 * One number, so competing plans can be compared rather than judged one macro
 * at a time. Falling short of protein costs three times what overshooting does,
 * which is the honest ratio: under is a failed cut, over is an inefficiency.
 */
function dayCost(chosen, target) {
  const totals = sumOf(chosen)
  const miss = Math.max(0, target.proteinG - totals.proteinG)
  const over = Math.max(0, totals.proteinG - target.proteinG)

  return (
    Math.abs(totals.kcal - target.calories) +
    miss * 4 * PROTEIN_PRIORITY +
    over * 4 * PROTEIN_OVERSHOOT
  )
}

/**
 * Swap dishes until the day stops getting closer to the target.
 *
 * Choosing each slot's best fit independently lands close on calories and can
 * miss badly on protein, because every slot rounds the same way. This closes
 * that the way a person would: change one meal for another in the same slot,
 * keep it if the day improved, and look again.
 *
 * **It used to only push protein upward.** Each pass took the single largest
 * available gain, which met the target and then sailed well past it — days came
 * out 30% over, and every one of those grams displaced carbohydrate the app had
 * prescribed on the same screen. Judging the whole day instead means a swap
 * that overshoots is simply not an improvement, so it is not made.
 *
 * Bounded. An unbounded improvement loop over a library somebody will edit
 * later is a hang waiting to happen, and this runs on every render.
 */
function refine(chosen, allowed, target) {
  const settled = (config) => {
    const copy = config.map((entry) => ({ ...entry }))
    // Scored after the calorie fit, because that is the plan somebody is
    // actually served. Scoring before it ranks portions nobody will see.
    fitCalories(copy, target.calories)
    return copy
  }

  let current = settled(chosen)
  let currentCost = dayCost(current, target)

  for (let pass = 0; pass < MAX_REFINE_PASSES; pass += 1) {
    let best = null

    for (let i = 0; i < current.length; i += 1) {
      for (const meal of allowed) {
        if (meal.slot !== current[i].meal.slot || meal.id === current[i].meal.id) continue

        const trial = current.map((entry) => ({ ...entry }))
        trial[i] = { ...trial[i], meal, scale: servingFor(meal, trial[i].slotKcal) }

        const fitted = settled(trial)
        const cost = dayCost(fitted, target)

        // Strictly better, with the id as the tie-break so an equal-cost swap
        // is resolved the same way on every machine and every render.
        if (
          cost < currentCost &&
          (!best || cost < best.cost || (cost === best.cost && meal.id < best.meal.id))
        ) {
          best = { cost, config: fitted, meal }
        }
      }
    }

    if (!best) break

    current = best.config
    currentCost = best.cost
  }

  return current
}

/**
 * Scale the whole day to land on the calorie target.
 *
 * Proportional, so the balance between meals is preserved, and clamped per dish
 * so nothing turns into a portion nobody would serve. When the clamps bind the
 * total stays off target, which `report` then says out loud.
 */
function fitCalories(chosen, calories) {
  for (let pass = 0; pass < 3; pass += 1) {
    const total = sumOf(chosen).kcal
    if (total <= 0) return

    const factor = calories / total
    if (Math.abs(factor - 1) < 0.005) return

    let moved = false
    for (const entry of chosen) {
      const next = clamp(entry.scale * factor, MIN_SCALE, MAX_SCALE)
      if (next !== entry.scale) moved = true
      entry.scale = next
    }

    if (!moved) return
  }
}

function report(chosen, target) {
  const meals = chosen.map(({ meal, scale }) => describe(meal, scale))

  /*
   * Summed from the rounded per-meal numbers, not from the exact ones. The
   * screen shows those rounded figures, and a total that does not equal the
   * column above it reads as a bug even when the maths is right.
   */
  const totals = meals.reduce(
    (sum, meal) => ({
      kcal: sum.kcal + meal.kcal,
      proteinG: sum.proteinG + meal.proteinG,
      fatG: sum.fatG + meal.fatG,
      carbG: sum.carbG + meal.carbG,
    }),
    { kcal: 0, proteinG: 0, fatG: 0, carbG: 0 },
  )

  const gaps = []

  const proteinFloor = target.proteinG * (1 - PROTEIN_TOLERANCE)
  const meetsProtein = target.proteinG <= 0 || totals.proteinG >= proteinFloor
  if (!meetsProtein) {
    const short = Math.round(target.proteinG - totals.proteinG)
    gaps.push(
      `This day is ${short} g short of your protein target. The foods available for your diet cannot reach it at this calorie level — a protein supplement, or more calories, would close it.`,
    )
  }

  const drift = Math.abs(totals.kcal - target.calories) / target.calories
  const meetsCalories = drift <= CALORIE_TOLERANCE
  if (!meetsCalories) {
    const direction = totals.kcal > target.calories ? 'over' : 'under'
    gaps.push(
      `This day comes to ${totals.kcal} calories, ${Math.abs(totals.kcal - target.calories)} ${direction} your target. Portions are held within a range somebody would actually serve, so it does not always land exactly.`,
    )
  }

  return { meals, totals, target, gaps, meetsProtein, meetsCalories }
}

function emptyPlan(target, gaps) {
  return {
    meals: [],
    totals: { kcal: 0, proteinG: 0, fatG: 0, carbG: 0 },
    target: { calories: Number(target?.calories) || 0, proteinG: Number(target?.proteinG) || 0 },
    gaps,
    meetsProtein: false,
    meetsCalories: false,
  }
}

/** Seven days, rotated so it is not the same plate every day. */
export function planWeek(target, options = {}) {
  return Array.from({ length: 7 }, (_, dayIndex) => planDay(target, { ...options, dayIndex }))
}

/**
 * Everything to buy for a week, added up.
 *
 * The step that turns a plan into something somebody does. A week of meals
 * nobody shopped for is a week of ordering in.
 */
export function shoppingList(days) {
  const totals = new Map()

  for (const day of days) {
    for (const meal of day.meals) {
      for (const portion of meal.portions) {
        const existing = totals.get(portion.key)
        totals.set(portion.key, {
          name: portion.name,
          grams: (existing?.grams ?? 0) + portion.grams,
        })
      }
    }
  }

  return [...totals.values()].sort((a, b) => b.grams - a.grams)
}
