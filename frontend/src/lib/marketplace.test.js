import { describe, it, expect } from 'vitest'
import { ageInDays, costFor, formatPrice, historyLine } from './marketplace.js'

/**
 * What a listing says about a coach.
 *
 * The marketplace's only real defence against a fake trainer is that a coach
 * carries a history nobody can write after the fact. So the line describing it
 * has to be made of chain facts and has to stay honest about a coach with no
 * history at all — the temptation, in every marketplace ever built, is to make
 * the empty case look better than it is.
 */

const DAY = 86_400_000
const NOW = 1_700_000_000_000

describe('how old a coach is', () => {
  it('counts from when it was created', () => {
    expect(ageInDays(NOW - 30 * DAY, NOW)).toBe(30)
    expect(ageInDays(NOW - 1 * DAY, NOW)).toBe(1)
    expect(ageInDays(NOW, NOW)).toBe(0)
  })

  it('never reports a coach from the future as old', () => {
    expect(ageInDays(NOW + 10 * DAY, NOW)).toBe(0)
  })

  it('is zero when nothing is known', () => {
    expect(ageInDays(null, NOW)).toBe(0)
    expect(ageInDays(0, NOW)).toBe(0)
  })
})

describe('the history line', () => {
  it('says what a long-lived coach actually has behind it', () => {
    const line = historyLine({ createdAt: NOW - 240 * DAY, version: 14 }, NOW)

    expect(line).toMatch(/8 months/)
    expect(line).toMatch(/learned 13 times/)
  })

  it('does not dress up a coach made this morning', () => {
    /*
     * The whole point. Somebody who spun a coach up last night stands next to
     * one with a year behind it and says so — every marketplace's temptation is
     * to make this case look better than it is.
     */
    const line = historyLine({ createdAt: NOW, version: 1 }, NOW)

    expect(line).toMatch(/today/i)
    expect(line).toMatch(/has not learned yet/i)
    expect(line).not.toMatch(/month|year/i)
  })

  it('counts versions as learnings, not off by one', () => {
    // Version 1 is the coach existing, not the coach learning.
    expect(historyLine({ createdAt: NOW - 5 * DAY, version: 1 }, NOW)).toMatch(/has not learned/)
    expect(historyLine({ createdAt: NOW - 5 * DAY, version: 2 }, NOW)).toMatch(/learned 1 times?/)
  })

  it('reads sensibly for a coach a few days old', () => {
    expect(historyLine({ createdAt: NOW - DAY, version: 2 }, NOW)).toMatch(/1 day old/)
    expect(historyLine({ createdAt: NOW - 3 * DAY, version: 2 }, NOW)).toMatch(/3 days old/)
  })
})

describe('what it costs', () => {
  it('multiplies price by days, in wei, without floating point', () => {
    /*
     * Money in a browser and floating point are a bad pair. The number that
     * reaches the contract has to be exactly what was shown, or a rental is
     * refused for underpayment nobody can explain.
     */
    const perDay = 1_000_000_000_000_000n // 0.001 0G

    expect(costFor(perDay.toString(), 30)).toBe(perDay * 30n)
    expect(costFor(perDay.toString(), 1)).toBe(perDay)

    /*
     * A price past 2^53, where a double stops being able to hold the answer.
     * The values above are small enough that floating point happens to be
     * exact, so on their own they prove nothing about the arithmetic — a
     * version of this using Number passed them all.
     */
    const expensive = 1_234_567_890_123_456_789n
    expect(costFor(expensive.toString(), 30)).toBe(expensive * 30n)
    expect(costFor(expensive.toString(), 7)).toBe(8_641_975_230_864_197_523n)
  })

  it('is nothing for a nonsense duration', () => {
    expect(costFor('1000', 0)).toBe(0n)
    expect(costFor('1000', -5)).toBe(0n)
    expect(costFor(null, 30)).toBe(0n)
  })

  it('shows a price a person can read, and nothing when not for rent', () => {
    expect(formatPrice('1000000000000000')).toBe('0.001 0G / day')
    expect(formatPrice('0')).toBeNull()
    expect(formatPrice(null)).toBeNull()
  })
})
