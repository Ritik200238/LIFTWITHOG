import { describe, it, expect, beforeEach, vi } from 'vitest'
import { pickChallenge, passesChallenge, isBackedUp, markBackedUp, seededRandom, CHECK_COUNT, CHOICES } from './keyBackup.js'

// Anvil's well-known test phrase: public, holds nothing, and repeats a word
// eleven times — the case most likely to produce a trick question.
const REPEATING = 'test test test test test test test test test test test junk'
const PHRASE = 'river orbit plastic salad sunset velvet carbon lunar ignite fabric hollow meadow'

describe('asking for words back', () => {
  it('asks for the configured number of distinct positions, in order', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const c = pickChallenge(PHRASE, seededRandom(seed))
      expect(c).toHaveLength(CHECK_COUNT)
      const positions = c.map((q) => q.position)
      expect(new Set(positions).size).toBe(CHECK_COUNT)
      expect(positions).toEqual([...positions].sort((a, b) => a - b))
      for (const p of positions) expect(p >= 1 && p <= 12).toBe(true)
    }
  })

  it('always offers the right word, at the position it is on screen', () => {
    const words = PHRASE.split(' ')
    for (let seed = 1; seed <= 50; seed += 1) {
      for (const q of pickChallenge(PHRASE, seededRandom(seed))) {
        expect(q.answer).toBe(words[q.position - 1])
        expect(q.choices).toContain(q.answer)
        expect(q.choices).toHaveLength(CHOICES)
      }
    }
  })

  it('never offers the same word twice, even when the phrase repeats one', () => {
    // "test" is right for positions 1–11 here. Offering it twice, once right
    // and once wrong, would be unanswerable — so choices are unique by value.
    for (let seed = 1; seed <= 50; seed += 1) {
      for (const q of pickChallenge(REPEATING, seededRandom(seed))) {
        expect(new Set(q.choices).size).toBe(q.choices.length)
      }
    }
  })

  it('does not always put the right answer in the same place', () => {
    const slots = new Set()
    for (let seed = 1; seed <= 40; seed += 1) {
      for (const q of pickChallenge(PHRASE, seededRandom(seed))) slots.add(q.choices.indexOf(q.answer))
    }
    expect(slots.size).toBeGreaterThan(1)
  })

  it('asks nothing of a phrase too short to have decoys', () => {
    expect(pickChallenge('one two', seededRandom(1))).toEqual([])
    expect(pickChallenge('', seededRandom(1))).toEqual([])
    expect(pickChallenge(null, seededRandom(1))).toEqual([])
  })
})

describe('checking the answers', () => {
  const c = pickChallenge(PHRASE, seededRandom(7))

  it('passes only when every answer is right', () => {
    expect(passesChallenge(c, c.map((q) => q.answer))).toBe(true)
  })

  it('fails on one wrong answer', () => {
    const wrong = c.map((q) => q.answer)
    wrong[1] = c[1].choices.find((w) => w !== c[1].answer)
    expect(passesChallenge(c, wrong)).toBe(false)
  })

  it('fails when an answer is missing', () => {
    expect(passesChallenge(c, [c[0].answer])).toBe(false)
    expect(passesChallenge(c, [])).toBe(false)
  })

  it('an empty challenge is never passed', () => {
    // Otherwise a phrase that produced no questions would count as backed up.
    expect(passesChallenge([], [])).toBe(false)
  })
})

describe('remembering that it was done', () => {
  const A = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa'
  const B = '0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb'
  // The same in-memory stand-in deviceKey.test.js uses: these tests run in
  // node, where there is no localStorage to clear.
  beforeEach(() => {
    const map = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
      clear: () => map.clear(),
    })
  })

  it('is not backed up until marked', () => {
    expect(isBackedUp(A)).toBe(false)
    markBackedUp(A)
    expect(isBackedUp(A)).toBe(true)
  })

  it('is tied to the key, so a restored different key starts un-backed-up', () => {
    markBackedUp(A)
    expect(isBackedUp(B)).toBe(false)
  })

  it('ignores address case', () => {
    markBackedUp(A)
    expect(isBackedUp(A.toLowerCase())).toBe(true)
  })

  it('an empty address is never backed up', () => {
    expect(isBackedUp('')).toBe(false)
    expect(markBackedUp('')).toBe(false)
  })
})
