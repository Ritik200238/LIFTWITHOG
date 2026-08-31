/**
 * When the coach should record what it has learned.
 *
 * The loop this product runs on: train more, the coach knows more, the coaching
 * gets better, so you train with it more. For that to be worth anything the
 * learning has to actually be recorded somewhere — and on chain, so "this coach
 * has trained with me for two years" is a thing somebody can check rather than
 * a sentence in an app.
 *
 * It also has to be free and invisible. Nobody confirms anything, nobody waits,
 * nobody holds a coin. That means deciding *when* is a real decision: every
 * recording is a transaction we pay for, and one per set would be absurd while
 * one per year would make the version count meaningless.
 *
 * Kept as a pure function because it is the one part of the flywheel that can
 * be tested without a chain — and the part most likely to be quietly wrong,
 * since nobody watches a background task that never complains.
 */

/**
 * Sessions between recordings.
 *
 * Ten is roughly a fortnight of training for somebody serious. Often enough
 * that the number on the card moves while they still remember the sessions
 * behind it; rare enough that a year of training is a few dozen transactions
 * rather than a few hundred.
 */
export const SESSIONS_PER_EVOLVE = 10

/**
 * A coach with less than this behind it is a guess, and evolving it says
 * nothing. Matches the threshold the card uses to warn before minting.
 */
export const MIN_SESSIONS_TO_RECORD = 3

/**
 * Should the coach record now?
 *
 * @param {object} coach   `{ tokenId, sessionsAtLastEvolve }`
 * @param {number} sessions Completed workouts this coach can see.
 * @param {boolean} learned Whether the profile actually changed — checked by
 *   the caller, because a version recording no change is a fee charged for
 *   nothing and empties the version count of the only meaning it has.
 */
export function shouldEvolve(coach, sessions, learned) {
  if (!coach?.tokenId) return false
  if (!learned) return false
  if (sessions < MIN_SESSIONS_TO_RECORD) return false

  const since = sessions - (coach.sessionsAtLastEvolve ?? 0)
  return since >= SESSIONS_PER_EVOLVE
}

/**
 * How many more sessions until the next recording.
 *
 * Shown on the card, because a number that moves is the difference between a
 * feature somebody notices and a background task nobody knows exists.
 */
export function sessionsUntilNextEvolve(coach, sessions) {
  if (!coach?.tokenId) return null

  const since = sessions - (coach.sessionsAtLastEvolve ?? 0)
  return Math.max(0, SESSIONS_PER_EVOLVE - since)
}
