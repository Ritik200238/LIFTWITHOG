/**
 * Which plates go on the bar.
 *
 * The mental arithmetic every barbell lifter does between sets: 72.5 kg means
 * a 20, a 5 and a 1.25 on each side of a 20 kg bar. Easy at the desk,
 * genuinely error-prone at set four of five — and the most-requested feature
 * in every thread about what a gym tracker should do, because getting it wrong
 * means unloading a bar mid-session.
 *
 * Deliberately arithmetic with the same honesty rules as the meal planner:
 * when the target cannot be built from real plates, it says so and shows the
 * nearest weight that can, rather than rounding silently.
 */

/** Standard plate sets, heaviest first, per side. */
export const PLATES = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lb: [45, 35, 25, 10, 5, 2.5],
}

/** Olympic bars. */
export const BAR = { kg: 20, lb: 45 }

/**
 * The plates for one side of the bar.
 *
 * @returns {{
 *   perSide: {plate: number, count: number}[],
 *   achieved: number,        // the weight the listed plates actually build
 *   remainder: number,       // what could not be loaded (0 when exact)
 *   belowBar: boolean,       // the target is lighter than the empty bar
 *   barOnly: boolean,        // the target is exactly the bar
 * }}
 */
export function platesFor(target, { unit = 'kg', bar = BAR[unit] ?? BAR.kg, plates = PLATES[unit] ?? PLATES.kg } = {}) {
  const want = Number(target) || 0

  if (want < bar) {
    return { perSide: [], achieved: bar, remainder: 0, belowBar: true, barOnly: false }
  }

  /*
   * Work in integer hundredths. 72.5 - 20 = 52.5 is fine, but repeated float
   * subtraction drifts (0.1 + 0.2 territory), and a plate calculator that is
   * off by a rounding error recommends plates that do not exist.
   */
  let left = Math.round(((want - bar) / 2) * 100)
  const perSide = []

  for (const plate of plates) {
    const step = Math.round(plate * 100)
    const count = Math.floor(left / step)
    if (count > 0) {
      perSide.push({ plate, count })
      left -= count * step
    }
  }

  const loaded = perSide.reduce((sum, p) => sum + p.plate * p.count, 0)

  return {
    perSide,
    achieved: bar + loaded * 2,
    remainder: left / 100 * 2,
    belowBar: false,
    barOnly: perSide.length === 0,
  }
}

/**
 * The loadout as somebody would say it: "25 + 5 + 2.5".
 *
 * Counts are written out ("2×20") only when a plate repeats, because that is
 * how lifters actually talk about a bar.
 */
export function plateLabel(result) {
  if (result.belowBar) return null
  if (result.barOnly) return 'bar'
  return result.perSide
    .map(({ plate, count }) => (count > 1 ? `${count}×${plate}` : `${plate}`))
    .join(' + ')
}
