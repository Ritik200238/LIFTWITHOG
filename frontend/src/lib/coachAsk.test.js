import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ethers } from 'ethers'
import { askCoach, challengeFor, CoachAskError } from './coachAsk.js'

/**
 * Asking a coach, from the browser's side.
 *
 * The message being signed here has to match the one the server rebuilds
 * character for character, or every request fails authentication for a reason
 * neither side can see. That is what the fixed vector below is for.
 */

/*
 * The exact bytes, pinned.
 *
 * `api/coach.test.js` asserts this same string. Two implementations of one
 * format is one more than there should be, and when they drift the failure is
 * "signature invalid" — which looks like a wallet problem, a network problem,
 * or an expired subscription, and is none of them.
 */
const VECTOR = 'LIFTWITHOG coach request\ncoach: 42\nissued: 1700000000000'

describe('the signed challenge', () => {
  it('matches the server byte for byte', () => {
    expect(challengeFor('42', 1_700_000_000_000)).toBe(VECTOR)
  })

  it('names the coach, so one signature cannot open another', () => {
    expect(challengeFor('1', 1)).not.toBe(challengeFor('2', 1))
  })

  it('names the moment, so a captured signature does not last forever', () => {
    expect(challengeFor('1', 1)).not.toBe(challengeFor('1', 2))
  })
})

describe('askCoach', () => {
  const wallet = ethers.Wallet.createRandom()

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends a signature the server can verify back to this address', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ answer: 'squat 80kg' }) })

    const answer = await askCoach(wallet, '42', 'what today?', { now: 1_700_000_000_000 })
    expect(answer).toBe('squat 80kg')

    const body = JSON.parse(fetch.mock.calls[0][1].body)
    const recovered = ethers.verifyMessage(
      challengeFor(body.tokenId, body.issuedAt),
      body.signature,
    )
    expect(recovered).toBe(wallet.address)
  })

  it('never asks the server for the coach configuration', async () => {
    /*
     * The browser's job is to ask a question, not to fetch a method. If this
     * request ever carried something that could return the config, the whole
     * reason inference moved server-side would be undone.
     */
    fetch.mockResolvedValue({ ok: true, json: async () => ({ answer: 'ok' }) })
    await askCoach(wallet, '1', 'hello', { now: 1_700_000_000_000 })

    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(Object.keys(body).sort()).toEqual(['issuedAt', 'question', 'signature', 'tokenId'])
  })

  it("passes on the server's reason rather than inventing one", async () => {
    // "This coach is not available to that address" tells somebody what
    // happened. "Request failed" sends them to support.
    fetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'no_access', message: 'This coach is not available to that address.' }),
    })

    await expect(askCoach(wallet, '1', 'hi', { now: 1 })).rejects.toThrow(/not available to that address/)
  })

  it('treats an empty answer as a failure, not an answer', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    await expect(askCoach(wallet, '1', 'hi', { now: 1 })).rejects.toBeInstanceOf(CoachAskError)
  })

  it('survives a server that did not return JSON at all', async () => {
    // A proxy error page, most often. Without this it fails inside the JSON
    // parser and the person is shown a syntax error.
    fetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json')
      },
    })

    await expect(askCoach(wallet, '1', 'hi', { now: 1 })).rejects.toThrow(/could not answer \(502\)/)
  })
})
