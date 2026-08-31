import { describe, it, expect } from 'vitest'
import { BAR, PLATES, plateLabel, platesFor } from './plates.js'

/**
 * The plates on the bar.
 *
 * Wrong here is not cosmetic: somebody loads what the app says, and a bar
 * loaded to the wrong weight is either a failed set or an injury. Every
 * expected value below was worked out on paper first.
 */

describe('loading a bar in kilograms', () => {
  it('does the classic case', () => {
    // 100 kg: 20 bar + 40 a side = 25 + 15.
    const r = platesFor(100, { unit: 'kg' })

    expect(r.perSide).toEqual([{ plate: 25, count: 1 }, { plate: 15, count: 1 }])
    expect(r.achieved).toBe(100)
    expect(r.remainder).toBe(0)
  })

  it('handles the fiddly one with the smallest plates', () => {
    /*
     * 72.5 kg: 26.25 a side. I first wrote this expecting 20 + 5 + 1.25 — the
     * loadout I would build from habit — and the test failed, because greedy
     * finds 25 + 1.25: the same weight in two plates instead of three. The
     * code was better at this than the test was, which is worth recording.
     */
    const r = platesFor(72.5, { unit: 'kg' })

    expect(r.perSide).toEqual([
      { plate: 25, count: 1 },
      { plate: 1.25, count: 1 },
    ])
    expect(r.achieved).toBe(72.5)
  })

  it('uses repeated plates when that is the load', () => {
    // 180 kg: 80 a side = 3×25 + 5.
    const r = platesFor(180, { unit: 'kg' })

    expect(r.perSide[0]).toEqual({ plate: 25, count: 3 })
    expect(r.achieved).toBe(180)
  })

  it('says when the exact weight cannot be built', () => {
    /*
     * 71 kg needs 25.5 a side and the smallest plate is 1.25. Rounding
     * silently is how somebody lifts a different weight than they logged; the
     * nearest achievable weight and the shortfall are both reported instead.
     */
    const r = platesFor(71, { unit: 'kg' })

    expect(r.achieved).toBe(70)
    expect(r.remainder).toBe(1)
  })

  it('never drifts through float arithmetic', () => {
    /*
     * Every reachable total from the bar to 200 kg must come out exact.
     * Reachable steps by 2.5, not 1.25 — plates go on in pairs, so the total
     * moves by twice the smallest plate. (My first version stepped by 1.25 and
     * "failed", asserting weights no barbell on earth can hold.)
     */
    for (let w = 20; w <= 200; w += 2.5) {
      const r = platesFor(w, { unit: 'kg' })
      expect(r.achieved, `${w} kg`).toBe(w)
      expect(r.remainder, `${w} kg`).toBe(0)
    }
  })

  it('returns clean numbers even for weights floats cannot represent', () => {
    /*
     * 71.3 kg is not representable in binary, and without integer arithmetic
     * inside, the remainder comes out 1.2999999999999998 — which is what would
     * be shown to the person. Plate weights themselves are all halves and
     * quarters (exact in binary), which is why only a typed odd decimal can
     * expose this, and why the sweep above never did.
     */
    const r = platesFor(20.1, { unit: 'kg' })

    expect(r.achieved).toBe(20)
    expect(r.remainder).toBe(0.1)

    // 71.3 happens to wash out either way; 20.1 was found by sweeping every
    // 0.1 step for an input where the two implementations actually differ —
    // 615 of them do, and this is the first.
    expect(platesFor(71.3, { unit: 'kg' }).remainder).toBe(1.3)
  })

  it('knows an empty bar when it sees one', () => {
    const r = platesFor(20, { unit: 'kg' })
    expect(r.barOnly).toBe(true)
    expect(plateLabel(r)).toBe('bar')
  })

  it('flags a target lighter than the bar instead of inventing negative plates', () => {
    const r = platesFor(15, { unit: 'kg' })
    expect(r.belowBar).toBe(true)
    expect(plateLabel(r)).toBe(null)
  })
})

describe('loading a bar in pounds', () => {
  it('uses the pound bar and pound plates', () => {
    // 135 lb: 45 bar + 45 a side = one 45. The most-loaded bar in America.
    const r = platesFor(135, { unit: 'lb' })

    expect(r.perSide).toEqual([{ plate: 45, count: 1 }])
    expect(r.achieved).toBe(135)
  })

  it('does a heavy pound load', () => {
    // 225 lb: 90 a side = 2×45.
    const r = platesFor(225, { unit: 'lb' })
    expect(r.perSide).toEqual([{ plate: 45, count: 2 }])
  })
})

describe('saying it the way a lifter would', () => {
  it('reads like the bar', () => {
    expect(plateLabel(platesFor(100, { unit: 'kg' }))).toBe('25 + 15')
    expect(plateLabel(platesFor(72.5, { unit: 'kg' }))).toBe('25 + 1.25')
    expect(plateLabel(platesFor(180, { unit: 'kg' }))).toBe('3×25 + 5')
  })
})

describe('the constants', () => {
  it('are the standard sets', () => {
    // Pinned: a typo in a plate denomination invalidates every answer.
    expect(PLATES.kg).toEqual([25, 20, 15, 10, 5, 2.5, 1.25])
    expect(PLATES.lb).toEqual([45, 35, 25, 10, 5, 2.5])
    expect(BAR).toEqual({ kg: 20, lb: 45 })
  })
})
