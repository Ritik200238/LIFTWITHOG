import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Creating and evolving a coach — on the path the product actually uses.
 *
 * These tests used to cover `mintCoach` and `evolveCoach`, which took a wallet
 * signer. Nobody reached them: the app has no wallet, which is its whole claim,
 * and the relayed path is what every screen calls. So the suite was carefully
 * exercising four functions that could not run in the product while
 * `mintCoachRelayed` — the one that does — had no frontend test at all.
 *
 * The dead ones are gone. These are the same properties, asserted against the
 * live path: the token id is read rather than guessed, an evolve that learned
 * nothing costs nobody a fee, and a hash is never anchored for a blob that was
 * not stored.
 */

const postMock = vi.fn()
const signMock = vi.fn()

vi.mock('./ogVault.js', () => ({
  OG_NETWORK: { rpcUrl: 'http://rpc', storageIndexer: 'http://indexer', chainId: 16602 },
  encryptJson: async () => new Uint8Array([1, 2, 3, 4]),
}))

/*
 * The device key, stubbed. The real one is tested in deviceKey.test.js; here it
 * only has to produce a signature and an address so the relayed request has a
 * shape, and be observable so the test can assert what was signed.
 */
vi.mock('./deviceKey.js', async () => {
  const actual = await vi.importActual('./deviceKey.js')
  return {
    ...actual,
    deviceSigner: async () => ({
      signer: { signTypedData: signMock, getAddress: async () => '0x' + 'ab'.repeat(20) },
      address: '0x' + 'ab'.repeat(20),
    }),
  }
})

let parseLogResult = null
const nonceMock = vi.fn()

vi.mock('ethers', async () => {
  const actual = await vi.importActual('ethers')
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      Contract: class {
        constructor() {
          this.interface = { parseLog: () => parseLogResult }
          this.nonceOf = nonceMock
        }
      },
      keccak256: actual.ethers.keccak256,
      toUtf8Bytes: actual.ethers.toUtf8Bytes,
    },
  }
})

/*
 * `marketplace.js` is where the read provider lives, and `currentNonce` reaches
 * it. Stubbed so no test touches a network.
 */
vi.mock('./marketplace.js', () => ({ readProvider: () => ({}) }))

const STATE = {
  workouts: [{ d: '2026-01-01', entries: [{ id: 'squat', sets: [{ w: 60, r: 5, done: true }] }] }],
}

beforeEach(() => {
  vi.stubEnv('VITE_COACH_ADDRESS', '0x' + '11'.repeat(20))
  postMock.mockReset()
  signMock.mockReset().mockResolvedValue('0x' + 'cd'.repeat(65))
  nonceMock.mockReset().mockResolvedValue(0n)
  parseLogResult = null

  // The service public key the device seals to, and the relayed endpoints.
  vi.stubGlobal('fetch', async (url, init) => {
    if (String(url).endsWith('/api/coach/pubkey')) {
      const { ethers } = await vi.importActual('ethers')
      const key = new ethers.SigningKey('0x' + '7c'.repeat(32)).compressedPublicKey
      return { ok: true, json: async () => ({ publicKey: key }) }
    }
    return postMock(String(url), JSON.parse(init.body))
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

const load = () => import('./ogCoach.js')

/** A relayed endpoint answering the way the server does. */
const ok = (body) => ({ ok: true, json: async () => body })

describe('minting a coach through the relayer', () => {
  it('seals the profile before it leaves, and anchors the hash of what was stored', async () => {
    /*
     * The bytes uploaded and the hash anchored must be the same bytes. That is
     * the entire purpose of `configHash`: it is what makes a blob coming back
     * from a network nobody controls provably the one that was written.
     */
    postMock.mockImplementation(async (url) => {
      if (url.endsWith('/store')) return ok({ rootHash: '0xroot' })
      if (url.endsWith('/mint')) return ok({ tokenId: '42' })
      throw new Error(`unexpected ${url}`)
    })

    const { mintCoachRelayed } = await load()
    const result = await mintCoachRelayed(STATE, { now: 1000 })

    expect(result.tokenId).toBe('42')
    expect(result.version).toBe(1)

    const [, stored] = postMock.mock.calls.find(([u]) => u.endsWith('/store'))
    const [, minted] = postMock.mock.calls.find(([u]) => u.endsWith('/mint'))

    // What was stored is base64 of the sealed bytes; what was anchored is their
    // keccak256. Neither is the plaintext.
    const bytes = Uint8Array.from(atob(stored.ciphertext), (c) => c.charCodeAt(0))
    const { ethers } = await vi.importActual('ethers')
    expect(minted.configHash).toBe(ethers.keccak256(bytes))
    expect(minted.configURI).toBe('0xroot')

    // Sealed, not plaintext: the magic this app's envelope writes.
    expect(Array.from(bytes.subarray(0, 5))).toEqual([0x4c, 0x57, 0x4f, 0x47, 0x31])
  })

  it('says what it is doing, in the order it does it', async () => {
    /*
     * A mint is four round trips and took 26 s on the deployment this was
     * measured against, behind a button that said "Creating…" for all of it.
     * That is indistinguishable from a hang, and the reflex when a button looks
     * hung is to press it again.
     *
     * The order is asserted, not just the set: the point of the caption is that
     * it tells somebody how far along they are, and steps that arrive in the
     * wrong order say the storage upload finished before it started.
     */
    postMock.mockImplementation(async (url) => {
      if (url.endsWith('/store')) return ok({ rootHash: '0xroot' })
      if (url.endsWith('/mint')) return ok({ tokenId: '42' })
      throw new Error(`unexpected ${url}`)
    })

    const seen = []
    const { mintCoachRelayed } = await load()
    await mintCoachRelayed(STATE, { now: 1000, onStep: (s) => seen.push(s) })

    expect(seen).toEqual(['key', 'storage', 'sign', 'chain'])
  })

  it('mints for a caller that does not want to be told', async () => {
    // Every other caller of this — the seed script, the tests above — passes no
    // callback, and a mint that throws because nobody is watching is worse than
    // a silent one.
    postMock.mockImplementation(async (url) => {
      if (url.endsWith('/store')) return ok({ rootHash: '0xroot' })
      if (url.endsWith('/mint')) return ok({ tokenId: '42' })
      throw new Error(`unexpected ${url}`)
    })

    const { mintCoachRelayed } = await load()
    await expect(mintCoachRelayed(STATE, { now: 1000 })).resolves.toMatchObject({ tokenId: '42' })
    await expect(mintCoachRelayed(STATE, { now: 1000, onStep: 'not a function' }))
      .resolves.toMatchObject({ tokenId: '42' })
  })

  it('names the owner inside the signed message, so the relayer cannot redirect', async () => {
    /*
     * The one property the whole gasless design rests on. A relayer that wanted
     * the coach for itself would have to submit a signature that does not say
     * so, and the contract refuses it.
     */
    postMock.mockImplementation(async (url) =>
      url.endsWith('/store') ? ok({ rootHash: '0xroot' }) : ok({ tokenId: '7' }),
    )

    const { mintCoachRelayed } = await load()
    await mintCoachRelayed(STATE)

    const [, , message] = signMock.mock.calls[0]
    expect(message.owner.toLowerCase()).toBe('0x' + 'ab'.repeat(20))

    const [, minted] = postMock.mock.calls.find(([u]) => u.endsWith('/mint'))
    expect(minted.owner.toLowerCase()).toBe('0x' + 'ab'.repeat(20))
  })

  it('never anchors a hash when storage refused the upload', async () => {
    /*
     * The worst outcome available here. A hash on chain for a blob that was
     * never written is a coach that validates perfectly and can never be
     * loaded — permanent, and discovered only when it is the last copy left.
     */
    postMock.mockImplementation(async (url) =>
      url.endsWith('/store') ? ok({}) : ok({ tokenId: '1' }),
    )

    const { mintCoachRelayed } = await load()
    await expect(mintCoachRelayed(STATE)).rejects.toThrow(/returned nothing to point at/i)

    expect(postMock.mock.calls.some(([u]) => u.endsWith('/mint'))).toBe(false)
  })

  it('fails loudly when the relayer returns no token id', async () => {
    /*
     * This found a real one. The relayed path took whatever the relayer said and
     * returned `undefined` as the token id, which the store then saved as the
     * coach's — leaving a device that believes it owns a coach it can never
     * name, while the real token, minted and paid for, belongs to somebody who
     * cannot reach it. The direct-wallet path it replaced had this guard; the
     * live one did not, and nothing exercised the live one.
     */
    postMock.mockImplementation(async (url) =>
      url.endsWith('/store') ? ok({ rootHash: '0xroot' }) : ok({}),
    )

    const { mintCoachRelayed } = await load()
    await expect(mintCoachRelayed(STATE)).rejects.toThrow(/did not say which one/i)
  })
})

describe('evolving a coach through the relayer', () => {
  it('does nothing when the coach has not learned anything', async () => {
    /*
     * Every evolve costs a fee, and a version that records no change also
     * hollows out the version count — the only evidence that this coach has
     * any history behind it.
     */
    const { buildCoachProfile } = await import('./coachProfile.js')
    const previous = buildCoachProfile(STATE, { now: 1 })

    const { evolveCoachRelayed } = await load()
    const result = await evolveCoachRelayed('1', STATE, previous, { now: 999_999 })

    expect(result.evolved).toBe(false)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('records a version when the training has actually moved', async () => {
    const { buildCoachProfile } = await import('./coachProfile.js')
    const previous = buildCoachProfile(STATE, { now: 1 })

    postMock.mockImplementation(async (url) =>
      url.endsWith('/store') ? ok({ rootHash: '0xroot2' }) : ok({}),
    )

    const heavier = {
      workouts: [
        ...STATE.workouts,
        { d: '2026-01-05', entries: [{ id: 'squat', sets: [{ w: 90, r: 5, done: true }] }] },
      ],
    }

    const { evolveCoachRelayed } = await load()
    const result = await evolveCoachRelayed('1', heavier, previous)

    expect(result.evolved).toBe(true)
    expect(postMock.mock.calls.some(([u]) => u.endsWith('/evolve'))).toBe(true)
  })

  it('carries the memory into the sealed payload, which is what the chain hashes', async () => {
    /*
     * The record and the numbers travel together on purpose: the hash on chain
     * covers the whole thing, so a version's memory is as fixed as its weights.
     */
    const { buildCoachProfile } = await import('./coachProfile.js')
    const previous = buildCoachProfile(STATE, { now: 1 })

    postMock.mockImplementation(async (url) =>
      url.endsWith('/store') ? ok({ rootHash: '0xroot3' }) : ok({}),
    )

    const heavier = {
      workouts: [
        ...STATE.workouts,
        { d: '2026-01-05', entries: [{ id: 'squat', sets: [{ w: 90, r: 5, done: true }] }] },
      ],
    }

    const { evolveCoachRelayed } = await load()
    const result = await evolveCoachRelayed('1', heavier, previous, { memory: [] })

    // A note per version, written when it happened.
    expect(result.memory.length).toBeGreaterThan(0)
    expect(result.memory[0].notes.length).toBeGreaterThan(0)
  })
})

describe('configuration', () => {
  it('says what is missing rather than failing deep inside ethers', async () => {
    vi.stubEnv('VITE_COACH_ADDRESS', '')
    vi.resetModules()

    const { coachContract, CoachNotConfigured } = await import('./ogCoach.js')
    expect(() => coachContract({})).toThrow(CoachNotConfigured)
  })
})
