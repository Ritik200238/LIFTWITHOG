import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The two actions that spend somebody else's money.
 *
 * Minting and evolving are relayed: this app pays the gas. Both set a `busy`
 * flag and neither read it, so both could run twice at once — two taps on
 * "Create my coach" produced two coaches and two transactions, and the
 * flywheel firing while the evolve button is on screen ran two evolves that
 * read the same nonce.
 */

const mintCoachRelayed = vi.fn()
const evolveCoachRelayed = vi.fn()

vi.mock('../lib/ogCoach.js', () => ({
  COACH_ADDRESS: '0xE6CAcDcf1D370E64041Ac9e42D0550A78014259A',
  mintCoachRelayed: (...a) => mintCoachRelayed(...a),
  evolveCoachRelayed: (...a) => evolveCoachRelayed(...a),
  readCoach: vi.fn(),
}))
vi.mock('../lib/deviceKey.js', () => ({ deviceAddressIfAny: vi.fn(async () => null) }))
// Mocked so the 0G storage SDK never loads: importing it for real costs seconds
// under a full suite run and the tests here time out waiting for it.
vi.mock('../lib/ogVault.js', () => ({
  OG_NETWORK: { rpcUrl: 'http://localhost:0', chainId: 16602, name: 'test' },
}))

const { useCoach } = await import('./useCoach.js')

const never = () => new Promise(() => {})

/*
 * The chain module is loaded with a dynamic `import()` so it stays off the
 * first-paint path, which means a call reaches it one microtask later than it
 * used to. The guard still runs synchronously — that is the whole point — but
 * asserting the underlying call has happened has to let the import settle
 * first. Without this the tests read 0 calls and look like a broken lock.
 */
const settle = () => new Promise((r) => setTimeout(r, 0))
const S = { workouts: [] }

beforeEach(() => {
  mintCoachRelayed.mockReset()
  evolveCoachRelayed.mockReset()
  useCoach.setState({ tokenId: null, version: 0, profile: null, sessionsAtLastEvolve: 0, busy: false, error: null })
})

describe('minting', () => {
  it('does not mint twice when tapped twice', async () => {
    // Each of these is a real transaction paid for by the relayer, and a coach
    // the person did not ask for.
    mintCoachRelayed.mockImplementation(never)

    void useCoach.getState().mint(S)
    const second = await useCoach.getState().mint(S)
    await settle()

    expect(mintCoachRelayed).toHaveBeenCalledTimes(1)
    expect(second.alreadyRunning).toBe(true)
  })

  it('can mint again once the first attempt finished', async () => {
    // The guard must be a lock, not a permanent refusal.
    mintCoachRelayed.mockRejectedValueOnce(new Error('network'))
    await expect(useCoach.getState().mint(S)).rejects.toThrow()
    await settle()

    expect(useCoach.getState().busy).toBe(false)

    mintCoachRelayed.mockResolvedValueOnce({ tokenId: '1', version: 1, profile: {}, address: '0xabc' })
    await useCoach.getState().mint(S)

    expect(mintCoachRelayed).toHaveBeenCalledTimes(2)
  })
})

describe('evolving', () => {
  beforeEach(() => useCoach.setState({ tokenId: '7', version: 3 }))

  it('does not evolve twice at once', async () => {
    /*
     * Reachable without trying: the flywheel fires when a workout finishes and
     * the button is on the same screen. Both reads take the same nonce, so one
     * transaction is rejected — and both add one to the version from the same
     * starting number, so the count here stops matching the chain.
     */
    evolveCoachRelayed.mockImplementation(never)

    void useCoach.getState().evolve(S)
    const second = await useCoach.getState().evolve(S)
    await settle()

    expect(evolveCoachRelayed).toHaveBeenCalledTimes(1)
    expect(second.alreadyRunning).toBe(true)
    expect(second.evolved).toBe(false)
  })

  it('leaves the version alone when the second attempt is refused', async () => {
    evolveCoachRelayed.mockImplementation(never)

    void useCoach.getState().evolve(S)
    await useCoach.getState().evolve(S)

    expect(useCoach.getState().version).toBe(3)
  })

  it('still refuses when there is no coach yet', async () => {
    useCoach.setState({ tokenId: null })
    await expect(useCoach.getState().evolve(S)).rejects.toThrow()
  })
})
