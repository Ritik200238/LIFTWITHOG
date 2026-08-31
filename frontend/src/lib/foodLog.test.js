import { describe, it, expect } from 'vitest'
import { MEALS } from './foods.js'
import {
  addEntry,
  dayKey,
  entriesFor,
  foodEntry,
  isLogged,
  copyOfDay,
  mealEntry,
  previousDay,
  progress,
  recentDays,
  removeEntry,
  searchFoods,
  totalsFor,
} from './foodLog.js'

/**
 * The half of the nutrition tab that was missing.
 *
 * It computed a target, planned a day around it, and never asked whether any
 * of it happened. These tests are about the numbers a person reads to decide
 * what to eat next, so being wrong here is worse than being absent — a total
 * that quietly drifts is one somebody plans a whole day around.
 */

const meal = MEALS.find((m) => m.id === 'boiled-eggs')
const draft = () => ({ foodLog: {} })

describe('logging a planned meal', () => {
  it('records what that meal actually contains', () => {
    // 150 g of egg: 143 kcal and 12.6 g protein per 100 g.
    const entry = mealEntry(meal, 1)

    expect(entry.name).toBe('Boiled eggs')
    expect(entry.kcal).toBe(215)
    expect(entry.proteinG).toBe(19)
  })

  it('records the portion the plan actually prescribed', () => {
    /*
     * The planner scales dishes to the person; logging the written serving
     * would under-count everybody the plan scaled up.
     *
     * 429, not 430: the real figure is 214.5 per serving, and rounding once at
     * the end is right. Rounding to 215 first and doubling would invent half a
     * calorie per meal — small, but it is the log, and a record that rounds
     * before it stores is a record that drifts.
     */
    expect(mealEntry(meal, 1).kcal).toBe(215)
    expect(mealEntry(meal, 2).kcal).toBe(429)
    expect(mealEntry(meal, 0.5).kcal).toBe(107)
  })

  it('knows whether it has been ticked off today', () => {
    const state = draft()
    expect(isLogged(state, meal.id)).toBe(false)

    addEntry(state, mealEntry(meal, 1))
    expect(isLogged(state, meal.id)).toBe(true)
  })
})

describe('logging something that was never in the plan', () => {
  it('takes any food by weight', () => {
    /*
     * The reason this exists. An app that only counts food it suggested stops
     * matching reality by Tuesday, and once the number on screen is wrong
     * nobody opens it again.
     */
    const entry = foodEntry('paneer', 100)

    expect(entry.name).toBe('Paneer')
    expect(entry.grams).toBe(100)
    expect(entry.kcal).toBe(265)
    expect(entry.proteinG).toBe(18)
  })

  it('scales by the weight given', () => {
    expect(foodEntry('paneer', 50).kcal).toBe(133)
    expect(foodEntry('paneer', 200).kcal).toBe(530)
  })

  it('refuses nonsense rather than logging a zero', () => {
    // A zero-calorie entry in the list is worse than no entry: it looks logged.
    expect(foodEntry('paneer', 0)).toBe(null)
    expect(foodEntry('paneer', -50)).toBe(null)
    expect(foodEntry('not-a-food', 100)).toBe(null)
  })
})

describe('the day totals', () => {
  it('add up everything logged', () => {
    const state = draft()
    addEntry(state, mealEntry(meal, 1))
    addEntry(state, foodEntry('paneer', 100))

    const totals = totalsFor(state)
    expect(totals.kcal).toBe(215 + 265)
    expect(totals.proteinG).toBe(19 + 18)
  })

  it('are zero for a day nothing was logged', () => {
    expect(totalsFor(draft())).toEqual({ kcal: 0, proteinG: 0, fatG: 0, carbG: 0 })
    expect(totalsFor({})).toEqual({ kcal: 0, proteinG: 0, fatG: 0, carbG: 0 })
  })

  it('come from what was stored, not from the recipe today', () => {
    /*
     * The log is a record, not a view. Correcting a recipe next month must not
     * silently rewrite what somebody ate last week.
     */
    const state = { foodLog: { [dayKey()]: [{ id: 'x', name: 'Old dish', kcal: 500, proteinG: 40 }] } }
    expect(totalsFor(state).kcal).toBe(500)
  })

  it('keep each day separate', () => {
    const state = {
      foodLog: { '2026-08-01': [{ id: 'a', kcal: 100 }], '2026-08-02': [{ id: 'b', kcal: 900 }] },
    }
    expect(totalsFor(state, '2026-08-01').kcal).toBe(100)
    expect(totalsFor(state, '2026-08-02').kcal).toBe(900)
  })
})

describe('removing something logged by mistake', () => {
  it('takes it back out', () => {
    const state = draft()
    const entry = mealEntry(meal, 1)
    addEntry(state, entry)
    removeEntry(state, entry.id)

    expect(entriesFor(state)).toEqual([])
  })

  it('drops the day entirely once it is empty', () => {
    // A year of empty days would ride along in every sync and every backup.
    const state = draft()
    const entry = foodEntry('paneer', 100)
    addEntry(state, entry)
    removeEntry(state, entry.id)

    expect(state.foodLog[dayKey()]).toBeUndefined()
  })

  it('leaves other entries alone', () => {
    const state = draft()
    const a = foodEntry('paneer', 100)
    const b = foodEntry('rice', 100)
    addEntry(state, a)
    addEntry(state, b)
    removeEntry(state, a.id)

    expect(entriesFor(state).map((e) => e.name)).toEqual(['Rice'])
  })
})

describe('how today is going', () => {
  const targets = { calories: 2000, proteinG: 150, fatG: 60, carbG: 200 }

  it('says how much is left', () => {
    const p = progress({ kcal: 1200, proteinG: 90, fatG: 40, carbG: 120 }, targets)

    expect(p.calories.left).toBe(800)
    expect(p.calories.pct).toBe(60)
    expect(p.protein.left).toBe(60)
  })

  it('reports going over instead of hiding it', () => {
    /*
     * Somebody who has eaten 2,600 against 2,200 needs to see 400 over, not a
     * bar sitting politely at 100%. The number is the entire point of logging.
     */
    const p = progress({ kcal: 2600 }, { calories: 2200 })

    expect(p.calories.over).toBe(400)
    expect(p.calories.left).toBe(0)
    expect(p.calories.pct).toBe(100)
  })

  it('survives having no target yet', () => {
    const p = progress({ kcal: 500 }, {})
    expect(p.calories.eaten).toBe(500)
    expect(p.calories.pct).toBe(0)
  })
})

describe('the last few days', () => {
  it('comes back newest first', () => {
    const days = recentDays(draft(), 7, new Date('2026-08-30T12:00:00'))

    expect(days).toHaveLength(7)
    expect(days[0].iso).toBe('2026-08-30')
    expect(days[6].iso).toBe('2026-08-24')
  })

  it('carries each day totals and whether anything was logged', () => {
    const state = { foodLog: { '2026-08-29': [{ id: 'a', kcal: 500 }] } }
    const days = recentDays(state, 3, new Date('2026-08-30T12:00:00'))

    expect(days[1].totals.kcal).toBe(500)
    expect(days[1].count).toBe(1)
    expect(days[0].count).toBe(0)
  })
})

describe('finding a food', () => {
  it('matches on name', () => {
    expect(searchFoods('paneer').map((f) => f.key)).toContain('paneer')
  })

  it('puts what you typed the start of first', () => {
    /*
     * Typing "p" must offer Palak before Apple. Alphabetical order alone puts
     * Apple first because it merely contains a p, and somebody hunting for
     * paneer with one thumb should not have to scroll past fruit.
     *
     * The first version of this used "rice", where nothing else contains the
     * word — so it passed with or without the rule and proved nothing.
     */
    expect(searchFoods('p')[0].name).toBe('Palak')
    expect(searchFoods('p').slice(0, 4).every((f) => f.name.toLowerCase().startsWith('p'))).toBe(true)
  })

  it('lists everything when nothing is typed', () => {
    expect(searchFoods('').length).toBeGreaterThan(20)
    expect(searchFoods('  ').length).toBeGreaterThan(20)
  })

  it('comes back empty rather than wrong', () => {
    expect(searchFoods('zzzzz')).toEqual([])
  })
})

describe('which day an entry belongs to', () => {
  it('is the local date, not UTC', () => {
    /*
     * Late-evening food in a positive-offset timezone is tomorrow in UTC. A
     * day that rolls over at the wrong moment moves somebody's dinner into the
     * next day's total and makes both wrong.
     */
    expect(dayKey(new Date('2026-08-30T23:30:00'))).toBe('2026-08-30')
    expect(dayKey(new Date('2026-08-30T00:30:00'))).toBe('2026-08-30')
  })
})

describe('eating the same as yesterday', () => {
  it('copies what was logged the day before', () => {
    // People eat the same things. Re-ticking four meals and re-typing a snack
    // every morning is the friction that ends the habit.
    const state = { foodLog: { '2026-08-29': [{ id: 'a', name: 'Dal chawal', kcal: 600 }] } }
    const copy = copyOfDay(state, '2026-08-29')

    expect(copy).toHaveLength(1)
    expect(copy[0].name).toBe('Dal chawal')
    expect(copy[0].kcal).toBe(600)
  })

  it('gives the copies their own ids', () => {
    /*
     * Sharing an id would mean removing today's dinner also removed
     * yesterday's — the log would edit its own history.
     */
    const state = { foodLog: { '2026-08-29': [{ id: 'a', name: 'X', kcal: 100 }] } }
    const copy = copyOfDay(state, '2026-08-29')

    expect(copy[0].id).not.toBe('a')
  })

  it('is empty when there was nothing yesterday', () => {
    expect(copyOfDay({ foodLog: {} }, '2026-08-29')).toEqual([])
    expect(copyOfDay({}, '2026-08-29')).toEqual([])
  })

  it('knows which day yesterday was, including across a month', () => {
    expect(previousDay('2026-08-30')).toBe('2026-08-29')
    expect(previousDay('2026-09-01')).toBe('2026-08-31')
    expect(previousDay('2026-01-01')).toBe('2025-12-31')
  })
})
