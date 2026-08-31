import { describe, it, expect } from 'vitest'
import { DIETS, INGREDIENTS, MEALS, macrosOf, mealsFor, portionsOf, roundGrams } from './foods.js'

/**
 * The food table, checked against itself.
 *
 * Nothing here can be tested against the truth — the truth is a food
 * composition table, and re-typing it into a test file would only prove that
 * the same fingers typed it twice. What can be tested is consistency: protein,
 * fat and carbohydrate at 4, 9 and 4 calories a gram have to reconcile with the
 * stated calorie figure, and a transposed digit breaks that arithmetic even
 * though nothing about the row looks wrong.
 */

const SLOTS = ['breakfast', 'lunch', 'snack', 'dinner']

/**
 * Where 4/9/4 legitimately disagrees with the table.
 *
 * Composition tables report carbohydrate by difference, which sweeps in fibre —
 * and fibre yields roughly 2 calories a gram rather than 4. In a food that is
 * mostly fibre and water the two figures diverge by a lot, and the table is the
 * one that is right. These are the rows where that dominates, listed by name so
 * the tolerance cannot quietly widen to cover a genuine mistake.
 */
const HIGH_FIBRE = new Set(['spinach', 'apple', 'banana', 'tofu', 'mixedVeg'])

describe('the ingredient table', () => {
  it('reconciles with itself at 4/9/4', () => {
    for (const [key, food] of Object.entries(INGREDIENTS)) {
      if (HIGH_FIBRE.has(key)) continue

      const atwater = 4 * food.p + 9 * food.f + 4 * food.c
      const drift = Math.abs(atwater - food.kcal) / food.kcal

      expect(drift, `${key}: ${food.kcal} kcal stated, ${atwater.toFixed(0)} from macros`).toBeLessThan(0.08)
    }
  })

  it('is still within reach on the high-fibre rows', () => {
    // Loose, but not unbounded — a digit dropped from a fibrous vegetable is
    // still a digit dropped.
    for (const key of HIGH_FIBRE) {
      const food = INGREDIENTS[key]
      const atwater = 4 * food.p + 9 * food.f + 4 * food.c
      expect(Math.abs(atwater - food.kcal) / food.kcal, key).toBeLessThan(0.35)
    }
  })

  it('has no negative or absurd rows', () => {
    for (const [key, food] of Object.entries(INGREDIENTS)) {
      expect(food.name, key).toBeTruthy()
      for (const field of ['kcal', 'p', 'f', 'c']) {
        expect(food[field], `${key}.${field}`).toBeGreaterThanOrEqual(0)
      }
      // Nothing is more than pure fat.
      expect(food.kcal, key).toBeLessThanOrEqual(900)
      // Nothing is more than 100 g of macros per 100 g.
      expect(food.p + food.f + food.c, key).toBeLessThanOrEqual(100)
    }
  })
})

describe('the dishes', () => {
  it('name only ingredients that exist', () => {
    /*
     * The quiet one. `macrosOf` skips an unknown key rather than throwing, so a
     * mistyped ingredient does not crash — it silently removes food from the
     * dish, and the plan comes out under target for a reason nobody can see.
     */
    for (const meal of MEALS) {
      for (const key of Object.keys(meal.items)) {
        expect(INGREDIENTS[key], `${meal.id} refers to "${key}"`).toBeDefined()
      }
    }
  })

  it('have unique ids', () => {
    // Ids are the tie-break that makes planning deterministic. Two dishes
    // sharing one makes the plan depend on array order again.
    const ids = MEALS.map((meal) => meal.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('belong to a real slot and are worth eating', () => {
    for (const meal of MEALS) {
      expect(SLOTS, meal.id).toContain(meal.slot)
      expect(meal.name.length, meal.id).toBeGreaterThan(3)
      expect(macrosOf(meal).kcal, meal.id).toBeGreaterThan(100)
    }
  })

  it('scale linearly, which is what makes portioning possible', () => {
    const meal = MEALS[0]
    const single = macrosOf(meal, 1)
    const double = macrosOf(meal, 2)

    expect(double.kcal).toBeCloseTo(single.kcal * 2, 6)
    expect(double.proteinG).toBeCloseTo(single.proteinG * 2, 6)
    // Fat and carbohydrate too. Asserting only the two the planner optimises
    // for leaves the other two free to be dropped from the sum entirely.
    expect(double.fatG).toBeCloseTo(single.fatG * 2, 6)
    expect(double.carbG).toBeCloseTo(single.carbG * 2, 6)
    expect(single.fatG).toBeGreaterThan(0)
    expect(single.carbG).toBeGreaterThan(0)
    expect(macrosOf(meal, 0).kcal).toBe(0)
  })

  it('adds up to what its ingredients contain', () => {
    /*
     * The whole chain from grams to displayed macros, checked by hand once. Oats
     * with milk, banana and peanuts: 60 g oats, 200 g milk, 100 g banana,
     * 15 g peanuts.
     */
    const meal = MEALS.find((m) => m.id === 'oats-milk-banana')
    const at = macrosOf(meal)

    // 389(0.6) + 58(2) + 89(1) + 567(0.15)
    expect(at.kcal).toBeCloseTo(233.4 + 116 + 89 + 85.05, 5)
    // 17(0.6) + 3.2(2) + 1.1(1) + 26(0.15)
    expect(at.proteinG).toBeCloseTo(10.2 + 6.4 + 1.1 + 3.9, 5)
  })
})

describe('diets', () => {
  it('widen in one direction, so nothing can be allowed by a stricter one', () => {
    const vegan = new Set(mealsFor('vegan').map((m) => m.id))
    const veg = new Set(mealsFor('veg').map((m) => m.id))
    const egg = new Set(mealsFor('egg').map((m) => m.id))
    const nonveg = new Set(mealsFor('nonveg').map((m) => m.id))

    for (const id of vegan) expect(veg.has(id), `veg should allow ${id}`).toBe(true)
    for (const id of veg) expect(egg.has(id), `egg should allow ${id}`).toBe(true)
    for (const id of egg) expect(nonveg.has(id), `nonveg should allow ${id}`).toBe(true)

    expect(nonveg.size).toBe(MEALS.length)
  })

  it('keeps meat out of vegetarian and dairy out of vegan', () => {
    for (const meal of mealsFor('veg')) {
      const keys = Object.keys(meal.items)
      expect(keys, meal.id).not.toContain('chicken')
      expect(keys, meal.id).not.toContain('fish')
      expect(keys, meal.id).not.toContain('egg')
    }

    for (const meal of mealsFor('vegan')) {
      for (const key of ['paneer', 'curd', 'milk', 'whey', 'ghee', 'egg', 'chicken', 'fish']) {
        expect(Object.keys(meal.items), `${meal.id} is not vegan`).not.toContain(key)
      }
    }
  })

  it('lets a vegetarian keep dairy, which is the distinction most apps lose', () => {
    // If `veg` were implemented as vegan-plus-nothing this list would be empty
    // and every Indian vegetarian would be offered a plan with no paneer in it.
    const dairyDishes = mealsFor('veg').filter((meal) =>
      Object.keys(meal.items).some((key) => ['paneer', 'curd', 'milk', 'ghee'].includes(key)),
    )
    expect(dairyDishes.length).toBeGreaterThan(3)
  })

  it('can fill every meal of the day, on every diet', () => {
    /*
     * The one that would have caught the original bug. `vegan` was hand-tagged
     * ingredient by ingredient, the grains and pulses were missed, and it
     * resolved to two snacks — an option the app could offer and never fill.
     */
    for (const diet of Object.keys(DIETS)) {
      for (const slot of SLOTS) {
        const options = mealsFor(diet).filter((meal) => meal.slot === slot)
        expect(options.length, `${diet} has nothing for ${slot}`).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('can reach a cutting protein target on every diet', () => {
    /*
     * Roughly 7.5 g of protein per 100 calories is what a lifter on a deficit
     * needs. A diet whose densest dish falls short of that cannot produce an
     * honest plan for the person most likely to be asking for one — which is
     * how the library ended up with soya and tofu dishes in it.
     */
    for (const diet of Object.keys(DIETS)) {
      for (const slot of SLOTS) {
        const best = Math.max(
          ...mealsFor(diet)
            .filter((meal) => meal.slot === slot)
            .map((meal) => {
              const at = macrosOf(meal)
              return (at.proteinG / at.kcal) * 100
            }),
        )
        expect(best, `${diet} ${slot} peaks at ${best.toFixed(1)} g per 100 kcal`).toBeGreaterThan(6.5)
      }
    }
  })
})

describe('portions', () => {
  it('round to something somebody can measure', () => {
    expect(roundGrams(63.4)).toBe(65)
    expect(roundGrams(62.4)).toBe(60)
    expect(roundGrams(200)).toBe(200)
  })

  it('keeps a finer step on the small amounts, where five grams matters', () => {
    // Oil and nuts. Rounding 6 g of oil to the nearest five is a third of the
    // fat in the dish.
    expect(roundGrams(6)).toBe(6)
    expect(roundGrams(12.4)).toBe(12)
  })

  it('never rounds a real ingredient away to nothing', () => {
    expect(roundGrams(0.6)).toBe(1)
  })

  it('lists the components at the portion actually served', () => {
    const meal = MEALS.find((m) => m.id === 'dal-chawal')
    const portions = portionsOf(meal, 2)

    expect(portions.find((p) => p.key === 'rice').grams).toBe(160)
    expect(portions.every((p) => p.name && p.grams > 0)).toBe(true)
  })
})
