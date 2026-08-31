/**
 * Whether a client's copy of the state may replace the stored one.
 *
 * The rule lives here rather than inline in the route so it can be tested
 * without standing up an HTTP server, which is the only reason it has tests.
 *
 * The route accepted every write. A phone that had been offline for a week came
 * back, pushed its week-old copy, and everything logged elsewhere in between
 * was overwritten — silently, because nothing told the client its write had
 * done any harm, and nothing told the other device its training was gone.
 */

/**
 * How far ahead of this server a client's clock may claim to be.
 *
 * Ordering by a timestamp the client chooses means trusting every client's
 * clock, and phones with a badly wrong one are not rare — a fresh device before
 * it syncs time, a dual-boot machine, a deliberately shifted clock.
 *
 * Left unchecked that is not a small error. A device claiming next year wins
 * every comparison from then on, so its copy can never be replaced by a device
 * telling the truth, and whatever it happened to be holding becomes permanent.
 * A day of slack absorbs timezone confusion and ordinary drift; anything past
 * that is treated as "now", which costs a wrong-clock device nothing except
 * the ability to outrank everybody forever.
 */
export const MAX_CLOCK_LEAD_MS = 24 * 60 * 60 * 1000

/** The moment to record for a write, with a runaway clock brought back to earth. */
export function stampFor(state, now = Date.now()) {
  const claimed = Number(state?._ts) || 0
  return claimed > now + MAX_CLOCK_LEAD_MS ? now : claimed
}

/**
 * @returns {boolean} true when the incoming state is older than what is stored
 *   and must be refused.
 */
export function isStaleWrite(incoming, existing, now = Date.now()) {
  // Nothing stored yet: anything is an improvement on nothing.
  if (!existing) return false

  /*
   * Both sides are clamped, so a stored state that was written before this
   * check existed — and may already be claiming the future — cannot keep
   * refusing honest writes forever.
   */
  const incomingTs = stampFor(incoming, now)
  const existingTs = stampFor(existing, now)

  /*
   * Equal timestamps are allowed through. A client re-sending the state it
   * already sent is a retry, not a conflict, and refusing it would leave the
   * device permanently dirty and retrying forever.
   */
  return incomingTs < existingTs
}
