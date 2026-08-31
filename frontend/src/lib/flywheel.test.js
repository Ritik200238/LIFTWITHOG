import { describe, it, expect } from 'vitest'
import {
  MIN_SESSIONS_TO_RECORD,
  SESSIONS_PER_EVOLVE,
  sessionsUntilNextEvolve,
  shouldEvolve,
} from './flywheel.js'

/**
 * When the coach records what it learned.
 *
 * This runs in the background, pays a fee every time it fires, and never
 * complains — which is exactly the shape of a thing that goes wrong for months
 * without anybody noticing. Either it fires constantly and quietly spends, or
 * it never fires and the version count that is supposed to prove the coach has
 * history stays at one forever.
 */

const coach = (over = {}) => ({ tokenId: '5', sessionsAtLastEvolve: 0, ...over })

describe('shouldEvolve', () => {
  it('waits for a real block of training', () => {
    expect(shouldEvolve(coach(), SESSIONS_PER_EVOLVE - 1, true)).toBe(false)
    expect(shouldEvolve(coach(), SESSIONS_PER_EVOLVE, true)).toBe(true)
  })

  it('does nothing when the coach learned nothing', () => {
    /*
     * Every recording is a transaction somebody pays for. One that records no
     * change also empties the version count of the only meaning it has: that
     * this coach has history behind it.
     */
    expect(shouldEvolve(coach(), 50, false)).toBe(false)
  })

  it('does not fire before there is anything worth recording', () => {
    // A coach built on two workouts is a guess, and saying so on chain adds
    // nothing but a fee.
    expect(shouldEvolve(coach(), MIN_SESSIONS_TO_RECORD - 1, true)).toBe(false)
  })

  it('counts from the last recording, not from zero', () => {
    /*
     * The one that would spend without limit. Measuring against the total means
     * that once a coach passes the threshold it is over it forever, and every
     * finished workout pays for another transaction.
     */
    const settled = coach({ sessionsAtLastEvolve: 40 })

    expect(shouldEvolve(settled, 41, true)).toBe(false)
    expect(shouldEvolve(settled, 45, true)).toBe(false)
    expect(shouldEvolve(settled, 40 + SESSIONS_PER_EVOLVE, true)).toBe(true)
  })

  it('does nothing without a coach to teach', () => {
    expect(shouldEvolve({ tokenId: null }, 100, true)).toBe(false)
    expect(shouldEvolve(null, 100, true)).toBe(false)
  })

  it('keeps firing as training continues', () => {
    // Across a year: it should record steadily, not once and never again.
    let fired = 0
    let lastAt = 0

    for (let sessions = 1; sessions <= 150; sessions += 1) {
      if (shouldEvolve(coach({ sessionsAtLastEvolve: lastAt }), sessions, true)) {
        fired += 1
        lastAt = sessions
      }
    }

    expect(fired).toBe(15)
  })
})

describe('sessionsUntilNextEvolve', () => {
  it('counts down, so the card can show something moving', () => {
    expect(sessionsUntilNextEvolve(coach(), 0)).toBe(SESSIONS_PER_EVOLVE)
    expect(sessionsUntilNextEvolve(coach(), 7)).toBe(SESSIONS_PER_EVOLVE - 7)
    expect(sessionsUntilNextEvolve(coach(), SESSIONS_PER_EVOLVE)).toBe(0)
  })

  it('never goes negative', () => {
    expect(sessionsUntilNextEvolve(coach(), 999)).toBe(0)
  })

  it('is nothing at all when there is no coach', () => {
    expect(sessionsUntilNextEvolve({ tokenId: null }, 5)).toBeNull()
  })
})
