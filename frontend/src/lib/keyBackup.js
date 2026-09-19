/**
 * Whether the person has actually saved the twelve words that own their coach.
 *
 * The contract has no admin. That is the point of it — nobody can take a coach
 * away — and it is also the reason nobody can hand one back. The words are the
 * only way in from another device, so "backed up" is worth checking rather than
 * assuming: a person who tapped "show my words" and closed the sheet has not
 * saved anything.
 *
 * So backing up ends in a short check — pick two of your words, by position,
 * from a few choices — the way wallets that take this seriously do it. It is
 * not a test of memory; the words are meant to be on paper. It is a check that
 * the paper exists.
 *
 * The state is kept against the address, not as a bare flag. Restoring a
 * different phrase onto this device is a different key, and a tick earned by
 * the old one must not carry over to it.
 */

import { readScoped, writeScoped } from './profileScope.js'

const KEY = 'og_key_backed_up_v1'

/** How many words the check asks for. Two is the usual trade: enough to show the list was written down, few enough that nobody gives up. */
export const CHECK_COUNT = 2

/** Choices offered per word — the right one and three from elsewhere in the phrase. */
export const CHOICES = 4

/**
 * A deterministic generator for tests; `Math.random` in the app. Returns
 * floats in [0, 1), like `Math.random`.
 */
export function seededRandom(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle(list, random) {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Pick which words to ask for, and the choices for each.
 *
 * Positions are distinct and returned in order, so the questions read "word
 * 3, then word 9" rather than jumping backwards. Choices are distinct by
 * *value*: a BIP-39 phrase can repeat a word, and offering "river" twice —
 * one right, one wrong — would be a trick question.
 *
 * @returns {Array<{ position: number, answer: string, choices: string[] }>}
 *          `position` is 1-based, as the words are numbered on screen.
 */
export function pickChallenge(phrase, random = Math.random, count = CHECK_COUNT) {
  const words = String(phrase ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length < CHOICES) return []

  const positions = shuffle(words.map((_, i) => i), random).slice(0, count).sort((a, b) => a - b)

  return positions.map((i) => {
    const answer = words[i]
    const others = [...new Set(words.filter((w) => w !== answer))]
    const decoys = shuffle(others, random).slice(0, CHOICES - 1)
    return { position: i + 1, answer, choices: shuffle([answer, ...decoys], random) }
  })
}

/** Every question answered, and every answer right. */
export function passesChallenge(challenge, answers) {
  if (!Array.isArray(challenge) || challenge.length === 0) return false
  return challenge.every((q, i) => answers?.[i] === q.answer)
}

/** Whether the key at `address` has been backed up on this profile. */
export function isBackedUp(address) {
  if (!address) return false
  try {
    const saved = JSON.parse(readScoped(KEY) ?? 'null')
    return Boolean(saved && String(saved.address).toLowerCase() === String(address).toLowerCase())
  } catch {
    return false
  }
}

/**
 * Record that the key at `address` is backed up.
 *
 * Called after the check passes, and after a restore — somebody who just typed
 * all twelve words onto a new phone has demonstrably got them.
 */
export function markBackedUp(address, now = Date.now()) {
  if (!address) return false
  return writeScoped(KEY, JSON.stringify({ address, at: now }))
}
