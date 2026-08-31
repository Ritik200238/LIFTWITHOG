import { describe, it, expect } from 'vitest'
import { MEALS, macrosOf } from './foods.js'
import { computeTargets } from './nutrition.js'
import {
  MAX_SCALE,
  MIN_SCALE,
  SLOTS,
  planDay,
  planWeek,
  shoppingList,
} from './mealPlan.js'

/**
 * Whether the plan is a plan.
 *
 * The failure this file is written against is not a crash. It is a day of food
 * that looks complete, reads well, and comes to 1700 calories against a 2200
 * target with 40 g of protein missing — followed for a month by somebody who
 * then concludes their body is the problem.
 *
 * So the tests measure the output rather than inspecting it, and the important
 * ones sweep real people across every diet rather than checking one case
 * somebody chose because it worked.
 */

const PEOPLE = [
  ['a man cutting', { sex: 'male', ageYears: 30, heightCm: 180, weightKg: 80, activity: 'moderate' }],
  ['a woman cutting', { sex: 'female', ageYears: 30, heightCm: 165, weightKg: 60, activity: 'sedentary' }],
  ['a heavy man cutting', { sex: 'male', ageYears: 45, heightCm: 170, weightKg: 130, activity: 'sedentary' }],
  ['a light man bulking', { sex: 'male', ageYears: 22, heightCm: 170, weightKg: 55, activity: 'active' }],
  ['a heavy woman cutting', { sex: 'female', ageYears: 38, heightCm: 158, weightKg: 95, activity: 'light' }],
  ['an older man maintaining', { sex: 'male', ageYears: 60, heightCm: 175, weightKg: 70, activity: 'very_active' }],
]

const DIETS = ['nonveg', 'egg', 'veg', 'vegan']
const GOALS = ['lose', 'maintain', 'gain', 'recomp']

const targetFor = (profile, goal) => computeTargets({ ...profile, goal })

describe('a day of food', () => {
  it('lands on the calorie and protein targets for real people, on every diet', () => {
    /*
     * 672 plans: six bodies, four goals, four diets, seven days. Not a
     * demonstration case — the sweep is the test, because the interesting
     * failures are the combinations nobody would think to try.
     *
     * This sweep is how the protein bug in nutrition.js was found. The maths
     * had passing tests and produced, for one of these people, a target no
     * combination of food could meet.
     */
    const missed = []

    for (const [who, profile] of PEOPLE) {
      for (const goal of GOALS) {
        const target = targetFor(profile, goal)

        for (const diet of DIETS) {
          for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
            const plan = planDay(target, { diet, dayIndex })

            if (!plan.meetsProtein || !plan.meetsCalories) {
              missed.push(
                `${who}, ${goal}, ${diet}, day ${dayIndex}: ` +
                  `${plan.totals.kcal}/${target.calories} kcal, ` +
                  `${plan.totals.proteinG}/${target.proteinG} g protein`,
              )
            }
          }
        }
      }
    }

    expect(missed, missed.slice(0, 5).join('\n')).toEqual([])
  })

  it('does not overshoot protein either', () => {
    /*
     * The half of the target that had no test. `meetsProtein` is a floor, so a
     * planner that piled on protein passed everything above while producing
     * days 30% over — and every one of those grams displaced the carbohydrate
     * the same screen had just prescribed. A plan that does not match the
     * numbers printed above it is a plan somebody stops trusting.
     */
    const overshot = []

    for (const [who, profile] of PEOPLE) {
      for (const goal of GOALS) {
        const target = targetFor(profile, goal)

        for (const diet of DIETS) {
          for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
            const plan = planDay(target, { diet, dayIndex })
            const over = (plan.totals.proteinG - target.proteinG) / target.proteinG

            if (over > 0.15) {
              overshot.push(
                `${who}, ${goal}, ${diet}, day ${dayIndex}: ` +
                  `${plan.totals.proteinG} g against a ${target.proteinG} g target`,
              )
            }
          }
        }
      }
    }

    expect(overshot, overshot.slice(0, 5).join('\n')).toEqual([])
  })

  it('serves the fat and carbohydrate it prescribed, not just the protein', () => {
    // Protein is the constraint the planner optimises for, which is exactly why
    // the other two need checking: they are what gets displaced when it wins.
    const target = targetFor(PEOPLE[0][1], 'lose')

    for (const diet of DIETS) {
      const plan = planDay(target, { diet })
      expect(Math.abs(plan.totals.carbG - target.carbG) / target.carbG, diet).toBeLessThan(0.35)
      expect(Math.abs(plan.totals.fatG - target.fatG) / target.fatG, diet).toBeLessThan(0.6)
    }
  })

  it('fills every meal of the day', () => {
    const plan = planDay(targetFor(PEOPLE[0][1], 'lose'), { diet: 'veg' })
    expect(plan.meals.map((meal) => meal.slot)).toEqual(SLOTS)
  })

  it('gives the same person the same plan twice', () => {
    /*
     * A plan that changes when the app is reopened is not a plan — somebody
     * shopped for the last one. It also cannot be tested, which is how a
     * planner ends up unverified.
     */
    const target = targetFor(PEOPLE[1][1], 'recomp')
    const first = planDay(target, { diet: 'veg', dayIndex: 3 })
    const second = planDay(target, { diet: 'veg', dayIndex: 3 })

    expect(first).toEqual(second)
  })

  it('does not depend on the order the food library happens to be written in', () => {
    /*
     * Two dishes with identical macros and different names, so the cost of
     * choosing either is exactly equal and only the tie-break separates them.
     * A real tie is the only way to test this: with the real library every cost
     * is a distinct float, sorting is stable, and an order-dependent planner
     * looks order-independent right up until two dishes happen to match.
     */
    const twins = [
      { id: 'zzz-twin', name: 'Twin Z', slot: 'lunch', items: { rice: 100, chicken: 100 } },
      { id: 'aaa-twin', name: 'Twin A', slot: 'lunch', items: { rice: 100, chicken: 100 } },
      { id: 'b-breakfast', name: 'B', slot: 'breakfast', items: { oats: 60, milk: 200 } },
      { id: 'c-dinner', name: 'C', slot: 'dinner', items: { chicken: 150, rice: 60 } },
      { id: 'd-snack', name: 'D', slot: 'snack', items: { curd: 200 } },
    ]

    const target = { calories: 2200, proteinG: 150 }
    const forwards = planDay(target, { diet: 'nonveg', library: twins })
    const backwards = planDay(target, { diet: 'nonveg', library: [...twins].reverse() })

    expect(forwards.meals.map((m) => m.id)).toEqual(backwards.meals.map((m) => m.id))
    // And it is the id that decides, not whichever was written first.
    expect(forwards.meals.find((m) => m.slot === 'lunch').id).toBe('aaa-twin')
  })

  it('serves portions somebody would actually put on a plate', () => {
    /*
     * Hitting a target by prescribing four and a half servings of dal is not
     * hitting the target — it is a number that makes somebody close the app.
     *
     * Written as literals rather than against the module's own constants. The
     * first version of this test imported MIN_SCALE and MAX_SCALE, which meant
     * widening them widened the assertion too and the test could never fail.
     */
    for (const [, profile] of PEOPLE) {
      for (const goal of GOALS) {
        for (const diet of DIETS) {
          for (const meal of planDay(targetFor(profile, goal), { diet }).meals) {
            expect(meal.servings).toBeGreaterThanOrEqual(0.5)
            expect(meal.servings).toBeLessThanOrEqual(2.5)
          }
        }
      }
    }

    // The constants themselves are part of the promise, so they are checked
    // once here rather than assumed by every case above.
    expect(MIN_SCALE).toBe(0.5)
    expect(MAX_SCALE).toBe(2.5)
  })

  it('shows numbers that add up to the total beside them', () => {
    /*
     * The totals are summed from the rounded per-meal figures rather than the
     * exact ones. A column that does not add up to its own total reads as a bug
     * even when the underlying maths is right.
     */
    for (const diet of DIETS) {
      const plan = planDay(targetFor(PEOPLE[2][1], 'lose'), { diet })
      const summed = plan.meals.reduce(
        (total, meal) => ({
          kcal: total.kcal + meal.kcal,
          proteinG: total.proteinG + meal.proteinG,
        }),
        { kcal: 0, proteinG: 0 },
      )

      expect(summed.kcal).toBe(plan.totals.kcal)
      expect(summed.proteinG).toBe(plan.totals.proteinG)
    }
  })

  it('respects the diet it was asked for', () => {
    const forbidden = {
      vegan: ['paneer', 'curd', 'milk', 'whey', 'ghee', 'egg', 'chicken', 'fish'],
      veg: ['egg', 'chicken', 'fish'],
      egg: ['chicken', 'fish'],
    }

    for (const [diet, banned] of Object.entries(forbidden)) {
      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        const plan = planDay(targetFor(PEOPLE[0][1], 'gain'), { diet, dayIndex })
        const used = plan.meals.flatMap((meal) => meal.portions.map((p) => p.key))

        for (const key of banned) {
          expect(used, `${diet} plan contains ${key}`).not.toContain(key)
        }
      }
    }
  })
})

/**
 * The test's own measure of "closer to what was asked for".
 *
 * Deliberately written here rather than imported, so it is an independent
 * yardstick. A test that scores a planner with the planner's own cost function
 * can only ever confirm that the code agrees with itself.
 */
const distance = (plan, target) =>
  Math.abs(plan.totals.kcal - target.calories) +
  Math.max(0, target.proteinG - plan.totals.proteinG) * 12 +
  Math.max(0, plan.totals.proteinG - target.proteinG) * 4

describe('what it optimises for', () => {
  it('takes the protein over the exact calorie count when it must choose', () => {
    /*
     * The asymmetry, made visible. Lunch offers a dish that lands the calories
     * perfectly and leaves protein short, and one that meets the protein while
     * running the calories over. Both are defensible; only one of them is the
     * right call during a cut, and treating the two errors as equal costs picks
     * the wrong one.
     */
    const library = [
      { id: 'a-breakfast', name: 'B', slot: 'breakfast', items: { oats: 60, milk: 200 } },
      { id: 'a-snack', name: 'S', slot: 'snack', items: { curd: 200 } },
      { id: 'a-dinner', name: 'D', slot: 'dinner', items: { rice: 100, chicken: 60 } },
      // 700 kcal of almost pure carbohydrate: the calories fit, the protein does not.
      { id: 'lunch-empty', name: 'Rice only', slot: 'lunch', items: { rice: 200 } },
      // The protein is here, and it brings calories with it.
      { id: 'lunch-protein', name: 'Chicken and rice', slot: 'lunch', items: { chicken: 300, rice: 90 } },
    ]

    const plan = planDay({ calories: 2000, proteinG: 150 }, { diet: 'nonveg', library })
    expect(plan.meals.find((meal) => meal.slot === 'lunch').id).toBe('lunch-protein')
  })

  it('settles somewhere close to the best day available', () => {
    /*
     * What "refine" is supposed to mean, stated honestly. The search is greedy
     * and changes one dish at a time, so it finds a good local optimum rather
     * than the global one — removing a dish it chose can land it in a different
     * basin that is a hair better, and that is the algorithm working as
     * designed, not a defect.
     *
     * What must not happen is a large regression. If dropping one dish produces
     * a materially better day, the search accepted a swap that made things
     * worse and stopped there. The bound is 3% of the calorie target, which is
     * far wider than the handful of units greedy search actually leaves on the
     * table and far tighter than a broken search would need.
     */
    for (const [, profile] of PEOPLE.slice(0, 3)) {
      for (const diet of ['nonveg', 'veg']) {
        const target = targetFor(profile, 'lose')
        const plan = planDay(target, { diet })
        const settled = distance(plan, target)
        const slack = target.calories * 0.03

        for (const meal of plan.meals) {
          const without = planDay(target, {
            diet,
            library: MEALS.filter((m) => m.id !== meal.id),
          })

          expect(
            distance(without, target),
            `dropping ${meal.id} produced a materially better day than keeping it`,
          ).toBeGreaterThan(settled - slack)
        }
      }
    }
  })

  it('still counts calories when the portions have bottomed out', () => {
    /*
     * Every candidate is scaled to the calorie target before being judged, so
     * for most people the calorie term decides nothing. It earns its place at
     * the bottom of the range, where nothing can shrink any further and the
     * only way to eat less is to choose a smaller dish.
     */
    const library = [
      { id: 'a-breakfast', name: 'B', slot: 'breakfast', items: { oats: 40 } },
      { id: 'a-lunch', name: 'L', slot: 'lunch', items: { rice: 60, chicken: 50 } },
      { id: 'a-snack', name: 'S', slot: 'snack', items: { curd: 100 } },
      { id: 'small-dinner', name: 'Small', slot: 'dinner', items: { rice: 40, chicken: 40 } },
      { id: 'huge-dinner', name: 'Huge', slot: 'dinner', items: { rice: 300, chicken: 300, oil: 40 } },
    ]

    const plan = planDay({ calories: 700, proteinG: 45 }, { diet: 'nonveg', library })
    expect(plan.meals.find((meal) => meal.slot === 'dinner').id).toBe('small-dinner')
  })
})

describe('when it cannot hit the target', () => {
  it('says so, in grams, instead of handing over a plan that misses', () => {
    /*
     * The whole reason this module reports rather than returns. Given only
     * low-protein dishes and a lifter's protein target, the honest output is
     * the shortfall and what would close it — not four meals and a silence.
     */
    const thin = MEALS.filter((meal) =>
      ['poha', 'upma', 'dal-chawal', 'khichdi', 'apple-almonds', 'banana-pb'].includes(meal.id),
    )

    const plan = planDay({ calories: 2200, proteinG: 180 }, { diet: 'veg', library: thin })

    expect(plan.meetsProtein).toBe(false)
    expect(plan.gaps.join(' ')).toMatch(/short of your protein target/)
    expect(plan.gaps.join(' ')).toMatch(/\d+ g/)
    expect(plan.meals.length).toBeGreaterThan(0) // it still offers the best it can
  })

  it('trades dishes up before giving up', () => {
    /*
     * Picking each slot's best fit independently lands close on calories and
     * can still come in well under on protein, because every slot rounds the
     * same way. The planner swaps the weakest meal for a denser one in the same
     * slot until the target is met — without that pass this plan misses.
     */
    const target = { calories: 2000, proteinG: 165 }
    const plan = planDay(target, { diet: 'veg' })

    expect(plan.meetsProtein).toBe(true)
    expect(plan.totals.proteinG).toBeGreaterThanOrEqual(165 * 0.9)
  })

  it('says when the portions bottomed out before the calories did', () => {
    /*
     * Nothing in the library can be served at less than half a portion, so
     * below a certain target the day simply cannot be made small enough. That
     * is a fine thing to happen and a terrible thing to hide: the person needs
     * to know the plan on their screen is not the number they asked for.
     */
    const plan = planDay({ calories: 600, proteinG: 40 }, { diet: 'nonveg' })

    expect(plan.meetsCalories).toBe(false)
    expect(plan.totals.kcal).toBeGreaterThan(600)
    expect(plan.gaps.join(' ')).toMatch(/over your target/)
    expect(plan.gaps.join(' ')).toMatch(/actually serve/)
  })

  it('has nothing to say before there is a target', () => {
    const plan = planDay({ calories: 0, proteinG: 0 })
    expect(plan.meals).toEqual([])
    expect(plan.gaps[0]).toMatch(/no calorie target/)
    expect(plan.totals.kcal).toBe(0)
  })

  it('does not crash on a diet with no food in it', () => {
    const plan = planDay({ calories: 2000, proteinG: 150 }, { diet: 'veg', library: [] })
    expect(plan.meals).toEqual([])
    expect(plan.gaps.length).toBeGreaterThan(0)
  })
})

describe('a week', () => {
  const target = targetFor(PEOPLE[0][1], 'lose')

  it('is seven days, and not the same plate seven times', () => {
    const week = planWeek(target, { diet: 'nonveg' })
    expect(week).toHaveLength(7)

    for (const slot of SLOTS) {
      const dishes = new Set(
        week.map((day) => day.meals.find((meal) => meal.slot === slot)?.id).filter(Boolean),
      )
      expect(dishes.size, `${slot} repeats the same dish all week`).toBeGreaterThan(1)
    }
  })

  it('still hits the targets on every one of those days', () => {
    // Variety must not be bought with accuracy.
    for (const day of planWeek(target, { diet: 'veg' })) {
      expect(day.meetsProtein).toBe(true)
      expect(day.meetsCalories).toBe(true)
    }
  })

  it('adds up to a shopping list', () => {
    /*
     * The step that turns a plan into something somebody does. A week of meals
     * nobody shopped for is a week of ordering in.
     */
    const week = planWeek(target, { diet: 'veg' })
    const list = shoppingList(week)

    expect(list.length).toBeGreaterThan(5)
    expect(list.every((item) => item.name && item.grams > 0)).toBe(true)

    // Sorted heaviest first, so the staples are at the top where somebody
    // reading quickly will see them.
    for (let i = 1; i < list.length; i += 1) {
      expect(list[i - 1].grams).toBeGreaterThanOrEqual(list[i].grams)
    }
  })

  it('totals the same grams the days actually asked for', () => {
    const week = planWeek(target, { diet: 'nonveg' })
    const list = shoppingList(week)

    const expected = new Map()
    for (const day of week) {
      for (const meal of day.meals) {
        for (const portion of meal.portions) {
          expected.set(portion.key, (expected.get(portion.key) ?? 0) + portion.grams)
        }
      }
    }

    const total = [...expected.values()].reduce((a, b) => a + b, 0)
    expect(list.reduce((sum, item) => sum + item.grams, 0)).toBe(total)
  })
})

describe('the arithmetic behind a meal', () => {
  it('reports what the dish actually contains at the portion served', () => {
    // Spot-checked by hand against the ingredient table, so the whole chain
    // from grams to displayed macros is verified once end to end.
    const boiledEggs = MEALS.find((meal) => meal.id === 'boiled-eggs')
    const at = macrosOf(boiledEggs, 1)

    // 150 g of egg at 143 kcal, 12.6 g protein, 9.5 g fat and 0.7 g carb
    // per 100 g. All four, because a macro nobody asserts is a macro that can
    // silently be dropped from the arithmetic.
    expect(at.kcal).toBeCloseTo(214.5, 5)
    expect(at.proteinG).toBeCloseTo(18.9, 5)
    expect(at.fatG).toBeCloseTo(14.25, 5)
    expect(at.carbG).toBeCloseTo(1.05, 5)
  })

  it('carries fat and carbohydrate through to the plan, not just protein', () => {
    // The planner optimises for calories and protein, so fat and carbohydrate
    // are the two that could quietly become zero without a single test noticing.
    const plan = planDay(targetFor(PEOPLE[0][1], 'maintain'), { diet: 'veg' })

    expect(plan.totals.fatG).toBeGreaterThan(30)
    expect(plan.totals.carbG).toBeGreaterThan(50)
    for (const meal of plan.meals) {
      expect(meal.fatG, meal.id).toBeGreaterThan(0)
    }
  })
})
