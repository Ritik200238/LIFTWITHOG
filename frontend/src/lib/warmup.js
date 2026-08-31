/**
 * The sets you do before the sets that count.
 *
 * Nobody walks up to a heavy bar cold, so every lifter builds up to it — and
 * every serious tracker offers to do that arithmetic, because doing it in your
 * head while the plates are in your hands is exactly when it goes wrong.
 *
 * The shape is the standard one: the empty bar, then a few rising percentages
 * of the working weight with the reps coming down as the load goes up. What is
 * not standard, and is the point here, is that every rung is rounded to a
 * weight the plates in the room can actually build — a warm-up calculator that
 * says 43.7 kg is asking somebody to do arithmetic it was supposed to do.
 */

import { BAR, PLATES, platesFor } from './plates.js'

/**
 * The ramp, as fractions of the working weight and the reps to do there.
 *
 * Five rungs at most and fewer for a light day: the warm-up exists to prepare
 * the working sets, and a warm-up that tires you out has failed at its only
 * job.
 */
const RAMP = [
  { fraction: 0.4, reps: 5 },
  { fraction: 0.6, reps: 3 },
  { fraction: 0.8, reps: 2 },
]

/**
 * Round to something the bar can hold.
 *
 * Down, never up: a warm-up rung that lands above the intended fraction is
 * heavier work than was asked for, and the whole ramp exists to stay below the
 * working weight.
 */
function toLoadable(target, unit) {
  const bar = BAR[unit] ?? BAR.kg
  if (target <= bar) return bar

  const smallest = (PLATES[unit] ?? PLATES.kg).at(-1)
  const step = smallest * 2
  const rounded = bar + Math.floor((target - bar) / step) * step

  // Confirms the rounded weight is genuinely buildable rather than merely
  // arithmetically tidy — the plate maths is the authority, not this.
  return platesFor(rounded, { unit }).achieved
}

/**
 * Warm-up sets for a working weight.
 *
 * @returns {{weight: number, reps: number, isBar: boolean}[]} lightest first,
 *   empty when there is nothing worth warming up for.
 */
export function warmupFor(workingWeight, { unit = 'kg' } = {}) {
  const target = Number(workingWeight) || 0
  const bar = BAR[unit] ?? BAR.kg

  /*
   * Nothing to ramp to. At or below the bar the warm-up *is* the working set,
   * and offering to add one would just add empty rows to somebody's session.
   */
  if (target <= bar) return []

  const sets = [{ weight: bar, reps: 8, isBar: true }]

  for (const rung of RAMP) {
    const weight = toLoadable(target * rung.fraction, unit)

    // Skip a rung that has collapsed onto the bar or onto the rung below it —
    // two identical warm-up sets is a rounding artefact, not a plan.
    if (weight <= sets.at(-1).weight) continue
    // And never a warm-up at or above the working weight.
    if (weight >= target) continue

    sets.push({ weight, reps: rung.reps, isBar: false })
  }

  return sets
}
