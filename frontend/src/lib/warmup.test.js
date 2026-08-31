import { describe, it, expect } from 'vitest'
import { warmupFor } from './warmup.js'
import { platesFor } from './plates.js'

/**
 * The sets before the sets that count.
 *
 * Wrong here wastes a session at best and hurts somebody at worst: a ramp that
 * lands too heavy is working sets in disguise, and one that cannot be loaded on
 * a real bar is arithmetic handed back to the person it was meant to spare.
 */

describe('ramping to a working weight', () => {
  it('starts with the empty bar', () => {
    // Nobody's first rep of the day is loaded, and the bar is where the
    // movement gets rehearsed.
    const sets = warmupFor(100, { unit: 'kg' })

    expect(sets[0]).toEqual({ weight: 20, reps: 8, isBar: true })
  })

  it('climbs while the reps come down', () => {
    // 100 kg: bar, then 40 / 60 / 80.
    const sets = warmupFor(100, { unit: 'kg' })

    expect(sets.map((s) => s.weight)).toEqual([20, 40, 60, 80])
    expect(sets.map((s) => s.reps)).toEqual([8, 5, 3, 2])
  })

  it('never reaches the working weight', () => {
    // A warm-up set at the working weight is a working set, and it steals one.
    for (const target of [40, 60, 80, 100, 140, 200]) {
      for (const set of warmupFor(target, { unit: 'kg' })) {
        expect(set.weight, `${target} kg`).toBeLessThan(target)
      }
    }
  })

  it('only ever goes up', () => {
    for (const target of [30, 55, 72.5, 100, 137.5, 180]) {
      const weights = warmupFor(target, { unit: 'kg' }).map((s) => s.weight)
      const sorted = [...weights].sort((a, b) => a - b)

      expect(weights, `${target} kg`).toEqual(sorted)
      expect(new Set(weights).size, `${target} kg has a repeated rung`).toBe(weights.length)
    }
  })
})

describe('every rung is a weight the bar can actually hold', () => {
  it('is loadable with real plates', () => {
    /*
     * The reason this rounds at all. 40% of 137.5 is 55, which happens to be
     * fine — but 40% of 72.5 is 29, which no combination of plates builds. A
     * warm-up calculator that prints 29 has handed the arithmetic back.
     */
    for (const target of [45, 72.5, 87.5, 111, 137.5, 163]) {
      for (const set of warmupFor(target, { unit: 'kg' })) {
        const load = platesFor(set.weight, { unit: 'kg' })

        expect(load.remainder, `${target} kg -> ${set.weight} kg`).toBe(0)
        expect(load.achieved, `${target} kg -> ${set.weight} kg`).toBe(set.weight)
      }
    }
  })

  it('rounds down, never up', () => {
    // Rounding a rung up makes it heavier work than the ramp intended.
    const sets = warmupFor(72.5, { unit: 'kg' })
    const second = sets[1]

    expect(second.weight).toBeLessThanOrEqual(72.5 * 0.4)
  })
})

describe('when there is nothing to warm up for', () => {
  it('offers nothing at or below the bar', () => {
    // The warm-up would be the working set. Adding rows here is noise.
    expect(warmupFor(20, { unit: 'kg' })).toEqual([])
    expect(warmupFor(15, { unit: 'kg' })).toEqual([])
    expect(warmupFor(0, { unit: 'kg' })).toEqual([])
  })

  it('offers just the bar for a light working weight', () => {
    // 25 kg: every percentage rung rounds back onto the bar, so one set of
    // the bar is the honest answer rather than four identical rows.
    expect(warmupFor(25, { unit: 'kg' })).toEqual([{ weight: 20, reps: 8, isBar: true }])
  })

  it('survives nonsense', () => {
    expect(warmupFor(null, { unit: 'kg' })).toEqual([])
    expect(warmupFor(undefined, { unit: 'kg' })).toEqual([])
    expect(warmupFor(-100, { unit: 'kg' })).toEqual([])
  })
})

describe('in pounds', () => {
  it('uses the pound bar and pound plates', () => {
    // 225 lb: the 45 / 90 / 135 / 180 ramp every American gym does by habit.
    const sets = warmupFor(225, { unit: 'lb' })

    expect(sets.map((s) => s.weight)).toEqual([45, 90, 135, 180])
  })

  it('keeps every pound rung loadable too', () => {
    for (const set of warmupFor(185, { unit: 'lb' })) {
      expect(platesFor(set.weight, { unit: 'lb' }).remainder).toBe(0)
    }
  })
})
