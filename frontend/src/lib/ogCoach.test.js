import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The parts of coach ownership that do not need a chain to be wrong.
 *
 * Reading the token id from a receipt, refusing to evolve when nothing was
 * learned, and refusing to anchor a hash for a blob that was never stored.
 * Each of those fails quietly in a way somebody only discovers much later —
 * the last one produces a coach that looks valid on chain forever and can
 * never be loaded by anyone.
 */

const uploadMock = vi.fn()
const mintMock = vi.fn()
const evolveMock = vi.fn()
const grantMock = vi.fn()

vi.mock('@0gfoundation/0g-storage-ts-sdk', () => ({
  Indexer: class {
    upload(...args) {
      return uploadMock(...args)
    }
  },
  /*
   * Stands in for the SDK's in-memory file wrapper, and keeps the shape the
   * indexer actually calls. Passing a plain browser Blob here is the bug this
   * whole path had: `size` is a property on a Blob and a method on everything
   * the indexer accepts, so it threw before sending a byte.
   */
  MemData: class {
    constructor(bytes) {
      this.bytes = bytes
    }
    size() {
      return this.bytes.length
    }
    numChunks() {
      return 1
    }
    numSegments() {
      return 1
    }
  },
}))

vi.mock('./ogVault.js', () => ({
  OG_NETWORK: { rpcUrl: 'http://rpc', storageIndexer: 'http://indexer' },
  encryptJson: async () => new Uint8Array([1, 2, 3, 4]),
}))

let parseLogResult = null

vi.mock('ethers', async () => {
  const actual = await vi.importActual('ethers')
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      Contract: class {
        constructor() {
          this.interface = { parseLog: () => parseLogResult }
          this.mint = mintMock
          this.evolve = evolveMock
          this.grantAccess = grantMock
        }
      },
      keccak256: actual.ethers.keccak256,
      toUtf8Bytes: actual.ethers.toUtf8Bytes,
    },
  }
})

const SIGNER = {}
const STATE = {
  workouts: [{ d: '2026-01-01', entries: [{ id: 'squat', sets: [{ w: 60, r: 5, done: true }] }] }],
}

beforeEach(() => {
  vi.stubEnv('VITE_COACH_ADDRESS', '0x' + '11'.repeat(20))
  uploadMock.mockReset()
  mintMock.mockReset()
  evolveMock.mockReset()
  grantMock.mockReset()
  parseLogResult = null
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function load() {
  return import('./ogCoach.js')
}

describe('minting a coach', () => {
  it('reads the id from the event rather than guessing it', async () => {
    /*
     * `mint` returns a value to another contract; to a wallet it returns a
     * transaction. Assuming "the newest id" is a race against anybody else
     * minting in the same block — and the prize for losing it is operating on
     * a stranger's coach.
     */
    uploadMock.mockResolvedValue([{ rootHash: '0xroot' }, null])
    parseLogResult = { name: 'CoachMinted', args: { tokenId: 42n } }
    mintMock.mockResolvedValue({ wait: async () => ({ logs: [{}] }) })

    const { mintCoach } = await load()
    const result = await mintCoach(SIGNER, STATE, { now: 1000 })

    expect(result.tokenId).toBe('42')
    expect(result.version).toBe(1)
  })

  it('fails loudly when the id cannot be read', async () => {
    uploadMock.mockResolvedValue([{ rootHash: '0xroot' }, null])
    parseLogResult = null
    mintMock.mockResolvedValue({ wait: async () => ({ logs: [] }) })

    const { mintCoach } = await load()
    await expect(mintCoach(SIGNER, STATE)).rejects.toThrow(/id could not be read/i)
  })

  it('never anchors a hash when storage refused the upload', async () => {
    /*
     * The worst outcome available here. A hash on chain for a blob that was
     * never written is a coach that validates perfectly and can never be
     * loaded — permanent, and only discovered when it is the last copy left.
     */
    uploadMock.mockResolvedValue([null, new Error('indexer unreachable')])

    const { mintCoach } = await load()
    await expect(mintCoach(SIGNER, STATE)).rejects.toThrow(/upload failed/i)
    expect(mintMock).not.toHaveBeenCalled()
  })

  it('treats a missing root hash as a failure, not a success', async () => {
    uploadMock.mockResolvedValue([{}, null])

    const { mintCoach } = await load()
    await expect(mintCoach(SIGNER, STATE)).rejects.toThrow(/no root hash/i)
    expect(mintMock).not.toHaveBeenCalled()
  })
})

describe('evolving a coach', () => {
  it('does nothing when the coach has not learned anything', async () => {
    /*
     * Every evolve costs a fee, and a version that records no change also
     * hollows out the version count — the only evidence that this coach has
     * any history behind it.
     */
    const { buildCoachProfile } = await import('./coachProfile.js')
    const previous = buildCoachProfile(STATE, { now: 1 })

    const { evolveCoach } = await load()
    const result = await evolveCoach(SIGNER, '1', STATE, previous, { now: 999_999 })

    expect(result.evolved).toBe(false)
    expect(uploadMock).not.toHaveBeenCalled()
    expect(evolveMock).not.toHaveBeenCalled()
  })

  it('records a version when the training has actually moved', async () => {
    const { buildCoachProfile } = await import('./coachProfile.js')
    const previous = buildCoachProfile(STATE, { now: 1 })

    uploadMock.mockResolvedValue([{ rootHash: '0xroot2' }, null])
    evolveMock.mockResolvedValue({ wait: async () => ({}) })

    const heavier = {
      workouts: [
        ...STATE.workouts,
        { d: '2026-01-05', entries: [{ id: 'squat', sets: [{ w: 90, r: 5, done: true }] }] },
      ],
    }

    const { evolveCoach } = await load()
    const result = await evolveCoach(SIGNER, '1', heavier, previous)

    expect(result.evolved).toBe(true)
    expect(evolveMock).toHaveBeenCalled()
  })
})

describe('renting a coach out', () => {
  it('turns days into an expiry the contract understands', async () => {
    grantMock.mockResolvedValue({ wait: async () => ({}) })

    const { rentOut } = await load()
    const now = 1_700_000_000_000
    const { expiresAt } = await rentOut(SIGNER, '1', '0xabc', 30, { now })

    expect(expiresAt).toBe(Math.floor(now / 1000) + 30 * 86_400)
    // Seconds, as a BigInt — milliseconds here would grant access until the
    // year 55,000, which no revoke would ever be issued for.
    expect(grantMock.mock.calls[0][2]).toBe(BigInt(expiresAt))
  })

  it('refuses a rental with no length', async () => {
    const { rentOut } = await load()
    await expect(rentOut(SIGNER, '1', '0xabc', 0)).rejects.toThrow(/length in days/i)
    expect(grantMock).not.toHaveBeenCalled()
  })
})

describe('configuration', () => {
  it('says what is missing rather than failing deep inside ethers', async () => {
    vi.stubEnv('VITE_COACH_ADDRESS', '')
    vi.resetModules()

    const { coachContract, CoachNotConfigured } = await import('./ogCoach.js')
    expect(() => coachContract(SIGNER)).toThrow(CoachNotConfigured)
  })
})
