import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ethers } from 'ethers'

/*
 * Imported by the same path `ogCoach.js` uses, and that is half the point of
 * this file: the seal lives in `server/` so that the code writing a coach and
 * the code opening it cannot drift apart, and an import reaching out of the
 * Vite root is exactly the kind of thing that resolves in one runtime and not
 * another. If this import ever stops working, the app stops being able to
 * create a coach — so it is asserted here rather than discovered in a browser.
 */
import { openAsService, sealForService, servicePublicKeyFrom } from '../../../server/coachEnvelope.js'

import { servicePublicKey, __resetServiceKeyCache } from './ogCoach.js'

/**
 * The device half of the round trip.
 *
 * The server suite proves that bytes sealed by this module open on the server.
 * This proves the browser can produce them at all — that the shared module
 * resolves here, that WebCrypto is reached the same way, and that the key the
 * device seals to is fetched rather than assumed.
 */

const SERVICE = '0x' + '7c'.repeat(32)
const SERVICE_PUB = servicePublicKeyFrom(SERVICE)

describe('sealing a coach in the browser', () => {
  it('produces bytes the service key opens, with the memory intact', async () => {
    const record = {
      unit: 'kg',
      sessions: 22,
      lifts: [{ id: 'deadlift', bestWeight: 140, bestReps: 3, sessions: 7 }],
      memoryDigest: 'v6:\n  - Deadlift: 130 kg → 140 kg.',
    }

    const sealed = await sealForService(record, SERVICE_PUB)

    expect(await openAsService(sealed, SERVICE)).toEqual(record)
  })

  it('hashes to something stable, because the chain anchors these exact bytes', async () => {
    /*
     * `configHash` is `keccak256` of the sealed bytes, and it is what the
     * contract stores. If sealing returned anything other than a plain byte
     * array the hash would be of the wrong thing, and every coach would fail
     * its own integrity check on the way back out of storage.
     */
    const sealed = await sealForService({ sessions: 1 }, SERVICE_PUB)

    expect(sealed).toBeInstanceOf(Uint8Array)
    expect(ethers.keccak256(sealed)).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('refuses to seal when there is no key to seal to', async () => {
    // Better than sealing to nothing and discovering it when the coach is asked
    // its first question, which is how the previous version of this failed.
    await expect(sealForService({ sessions: 1 }, null)).rejects.toThrow(/no service public key/i)
  })
})

describe('fetching the key a coach is sealed to', () => {
  beforeEach(() => {
    __resetServiceKeyCache()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    __resetServiceKeyCache()
  })

  it('asks the server once, however many coaches are sealed', async () => {
    /*
     * Every mint and every evolve needs it. Fetching per call would put a
     * request in front of an action somebody is waiting on, for a value that
     * cannot change while the tab is open.
     */
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ publicKey: SERVICE_PUB }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const [a, b] = await Promise.all([servicePublicKey(), servicePublicKey()])

    expect(a).toBe(SERVICE_PUB)
    expect(b).toBe(SERVICE_PUB)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/coach/pubkey')
  })

  it('retries after a failure instead of replaying it forever', async () => {
    /*
     * A cached rejected promise is a tab that can never create a coach again
     * until it is reloaded — the server coming back up would change nothing.
     */
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ publicKey: SERVICE_PUB }) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(servicePublicKey()).rejects.toThrow(/not reachable/i)
    await expect(servicePublicKey()).resolves.toBe(SERVICE_PUB)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats a reply with no key as a failure', async () => {
    // A 200 carrying nothing would otherwise seal every coach to `undefined`.
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({}) }))

    await expect(servicePublicKey()).rejects.toThrow(/did not return a key/i)
  })

  it('says the service is unreachable when the network is down', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })

    await expect(servicePublicKey()).rejects.toThrow(/not reachable/i)
  })
})
