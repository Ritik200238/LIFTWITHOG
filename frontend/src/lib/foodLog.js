/**
 * What somebody actually ate, as opposed to what they were told to eat.
 *
 * The nutrition tab computed a target, planned a day of food around it, and
 * then never asked whether any of it happened. Every other part of this app
 * closes its loop — you log a set, you log a weigh-in — and this one only
 * talked. A plan you cannot tick off is a reference sheet, and reference sheets
 * get read once.
 *
 * Two ways in, because both happen:
 *
 *   - tick off a meal from the plan, which is the easy case
 *   - log something that was never in the plan, which is most days
 *
 * The second one is the whole reason this exists. An app that only counts food
 * it suggested is an app that stops matching reality by Tuesday, and once the
 * number on screen is wrong, nobody opens it again.
 */

import { INGREDIENTS, macrosOf } from './foods.js'

/** Entries are grouped by local date, the same key the workout log uses. */
export const dayKey = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

const listFor = (log, iso) => (Array.isArray(log?.[iso]) ? log[iso] : [])

export function entriesFor(state, iso = dayKey()) {
  return listFor(state?.foodLog, iso)
}

/**
 * What a day comes to.
 *
 * Summed from the stored per-entry numbers rather than recomputed from the
 * source food. A recipe corrected next month must not silently rewrite what
 * somebody ate last week — the log is a record, not a view.
 */
export function totalsFor(state, iso = dayKey()) {
  return entriesFor(state, iso).reduce(
    (sum, entry) => ({
      kcal: sum.kcal + (Number(entry.kcal) || 0),
      proteinG: sum.proteinG + (Number(entry.proteinG) || 0),
      fatG: sum.fatG + (Number(entry.fatG) || 0),
      carbG: sum.carbG + (Number(entry.carbG) || 0),
    }),
    { kcal: 0, proteinG: 0, fatG: 0, carbG: 0 },
  )
}

let counter = 0
const newId = () => `f${Date.now().toString(36)}${(counter++).toString(36)}`

/** A planned meal, at the portion the plan actually prescribed. */
export function mealEntry(meal, scale = 1, at = Date.now()) {
  const macros = macrosOf(meal, scale)
  return {
    id: newId(),
    kind: 'meal',
    ref: meal.id,
    slot: meal.slot,
    name: meal.name,
    kcal: Math.round(macros.kcal),
    proteinG: Math.round(macros.proteinG),
    fatG: Math.round(macros.fatG),
    carbG: Math.round(macros.carbG),
    at,
  }
}

/** Anything else, by weight. */
export function foodEntry(key, grams, at = Date.now()) {
  const food = INGREDIENTS[key]
  if (!food) return null

  const amount = (Number(grams) || 0) / 100
  if (amount <= 0) return null

  return {
    id: newId(),
    kind: 'food',
    ref: key,
    name: food.name,
    grams: Math.round(Number(grams)),
    kcal: Math.round(food.kcal * amount),
    proteinG: Math.round(food.p * amount),
    fatG: Math.round(food.f * amount),
    carbG: Math.round(food.c * amount),
    at,
  }
}

/** Mutating helpers, shaped for the store's `update(draft => …)`. */
export function addEntry(draft, entry, iso = dayKey()) {
  if (!entry) return
  if (!draft.foodLog || typeof draft.foodLog !== 'object') draft.foodLog = {}
  if (!Array.isArray(draft.foodLog[iso])) draft.foodLog[iso] = []
  draft.foodLog[iso].push(entry)
}

export function removeEntry(draft, id, iso = dayKey()) {
  const day = draft?.foodLog?.[iso]
  if (!Array.isArray(day)) return
  draft.foodLog[iso] = day.filter((entry) => entry.id !== id)
  // An emptied day is removed rather than kept as [], so a year of untouched
  // days does not accumulate in every sync and backup.
  if (draft.foodLog[iso].length === 0) delete draft.foodLog[iso]
}

/** Whether a given planned meal has already been ticked off today. */
export function isLogged(state, mealId, iso = dayKey()) {
  return entriesFor(state, iso).some((entry) => entry.kind === 'meal' && entry.ref === mealId)
}

/**
 * How today is going against the target.
 *
 * `over` is reported rather than clamped. Somebody who has eaten 2,600 against
 * a 2,200 target needs to see 400 over, not a bar sitting politely at 100% —
 * the number is the entire point of having logged it.
 */
export function progress(totals, targets) {
  const of = (eaten, target) => {
    const goal = Number(target) || 0
    const had = Number(eaten) || 0
    if (goal <= 0) return { eaten: had, target: 0, left: 0, pct: 0, over: 0 }
    return {
      eaten: Math.round(had),
      target: Math.round(goal),
      left: Math.max(0, Math.round(goal - had)),
      pct: Math.min(100, Math.round((had / goal) * 100)),
      over: Math.max(0, Math.round(had - goal)),
    }
  }

  return {
    calories: of(totals?.kcal, targets?.calories),
    protein: of(totals?.proteinG, targets?.proteinG),
    fat: of(totals?.fatG, targets?.fatG),
    carbs: of(totals?.carbG, targets?.carbG),
  }
}

/** The last `days` days, newest first, for the history strip. */
export function recentDays(state, days = 7, today = new Date()) {
  return Array.from({ length: days }, (_, back) => {
    const date = new Date(today)
    date.setDate(date.getDate() - back)
    const iso = dayKey(date)
    return { iso, totals: totalsFor(state, iso), count: entriesFor(state, iso).length }
  })
}

/**
 * Yesterday's entries, ready to be logged again today.
 *
 * People eat the same things. Re-ticking four meals and re-typing a snack
 * every morning is the friction that ends the habit, and the app already knows
 * exactly what yesterday was.
 *
 * Fresh ids and a fresh moment, because these are new entries recording a new
 * day — copying the ids would make removing one from today remove it from
 * yesterday as well.
 */
export function copyOfDay(state, fromIso, at = Date.now()) {
  return entriesFor(state, fromIso).map((entry) => ({ ...entry, id: newId(), at }))
}

/** The day before a given one. */
export function previousDay(iso) {
  const date = new Date(`${iso}T12:00:00`)
  date.setDate(date.getDate() - 1)
  return dayKey(date)
}

/** Foods somebody can search for, sorted so a typed prefix wins. */
export function searchFoods(query) {
  const q = String(query ?? '').trim().toLowerCase()
  const all = Object.entries(INGREDIENTS).map(([key, food]) => ({ key, ...food }))
  if (!q) return all.sort((a, b) => a.name.localeCompare(b.name))

  return all
    .filter((food) => food.name.toLowerCase().includes(q) || food.key.toLowerCase().includes(q))
    .sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q)
      const bStarts = b.name.toLowerCase().startsWith(q)
      if (aStarts !== bStarts) return aStarts ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}
