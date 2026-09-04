import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

/*
 * The contract address, stubbed rather than inherited — for every block in this
 * file, not for one of them.
 *
 * Everything reading the chain here returns nothing when no contract is
 * configured, which is right for a fork somebody just cloned and useless as a
 * test: it asserts the behaviour it was written for on a machine where the
 * variable happens to be set, and asserts nothing at all on a clean checkout.
 *
 * It was scoped to a single describe, and the very next block added to this
 * file forgot it and went red in CI having been green locally — the same
 * failure, in the same file, caught by the same CI run, a second time. At file
 * level a new block cannot forget.
 */
beforeEach(() => {
  vi.stubEnv('VITE_COACH_ADDRESS', '0x' + '11'.repeat(20))
  // Reset before, not only after. The static import at the top of this file
  // already loaded the module — and its address — before any stub existed, so
  // without this the first test reads the cached copy.
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

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
  it('says nothing about age when the mint is outside the log window', () => {
    /*
     * The market read the creation time from a bounded range of blocks, so a
     * coach minted before it had none — and `ageInDays(null)` is 0, which
     * rendered as "Created today" on every older coach. The market's argument
     * is that time cannot be faked; the market was faking it.
     */
    expect(historyLine({ createdAt: null, version: 3 }, NOW)).toBe('Learned 2 times')
    expect(historyLine({ createdAt: undefined, version: 1 }, NOW)).toBe('Has not learned yet')
    expect(historyLine({ createdAt: null, version: 3 }, NOW)).not.toMatch(/today|old/)
  })

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

describe('reading the market off the chain', () => {

  /**
   * `mint` is permissionless, so the id space is whatever anybody has made of
   * it. The two reads behind this page each grew without bound with it: one
   * round trip per id from 1 upwards, and an `eth_getLogs` from block 0 on every
   * load. Both are cheap to attack and neither fails loudly — the page just
   * stops working, for everybody, for as long as the ids exist.
   */

  /** A contract that counts what it was asked, and complains like a real RPC. */
  const fakeContract = ({ total, listed, logWindowLimit = Infinity }) => {
    const seen = { prices: [], logRanges: [] }

    return {
      seen,
      contract: {
        totalMinted: async () => BigInt(total),
        rentalPrice: async (id) => {
          seen.prices.push(Number(id))
          return listed.has(Number(id)) ? 1000n : 0n
        },
        coachOf: async () => [0n, 'og://root', 3n, 1_700_000_000n],
        ownerOf: async () => '0xowner',
        filters: { CoachMinted: () => ({}) },
        queryFilter: async (_f, from, to) => {
          seen.logRanges.push([from, to])
          if (to - from > logWindowLimit) throw new Error('query returned more than 10000 results')
          return []
        },
      },
    }
  }

  it('does not read every id that has ever been minted', async () => {
    /*
     * The griefing case: five hundred empty coaches cost the attacker one
     * transaction each and cost every visitor a round trip each, before the
     * page renders anything at all.
     */
    const { listRentableCoaches } = await import('./marketplace.js')
    const { seen, contract } = fakeContract({ total: 5000, listed: new Set([4999, 4998]) })

    const rows = await listRentableCoaches({ provider: {}, contract, scanDepth: 300 })

    expect(rows).toHaveLength(2)
    expect(seen.prices.length).toBeLessThanOrEqual(300)
    // Newest first: the work is a function of what is shown, not what exists.
    expect(Math.max(...seen.prices)).toBe(5000)
  })

  it('stops as soon as it has enough to show', async () => {
    const { listRentableCoaches } = await import('./marketplace.js')
    const listed = new Set(Array.from({ length: 200 }, (_, i) => 1000 - i))
    const { seen, contract } = fakeContract({ total: 1000, listed })

    const rows = await listRentableCoaches({ provider: {}, contract, limit: 10 })

    expect(rows).toHaveLength(10)
    expect(seen.prices.length).toBeLessThan(100)
  })

  it('asks for a bounded range of blocks, not the whole chain', async () => {
    /*
     * Public RPCs cap how many blocks a log query may span. From block 0 this
     * worked in testing and would begin returning errors as the chain grew —
     * and the failure surfaced as an empty marketplace rather than as anything
     * mentioning log ranges.
     */
    const { creationTimes } = await import('./marketplace.js')
    const { seen, contract } = fakeContract({ total: 1, listed: new Set() })
    const provider = { getBlockNumber: async () => 900_000 }

    await creationTimes(['1'], { provider, contract })

    expect(seen.logRanges).toHaveLength(1)
    const [from, to] = seen.logRanges[0]
    expect(from).toBeGreaterThan(0)
    expect(to - from).toBeLessThanOrEqual(45_000)
  })

  it('loses an age rather than the page when the log query is refused', async () => {
    // Ages are decoration beside price and version. Losing a subtitle is the
    // right failure; losing the marketplace is not.
    const { creationTimes } = await import('./marketplace.js')
    const { contract } = fakeContract({ total: 1, listed: new Set(), logWindowLimit: 10 })
    const provider = { getBlockNumber: async () => 900_000 }

    await expect(creationTimes(['1'], { provider, contract })).resolves.toEqual({})
  })
})

/*
 * Restoring onto a second device.
 *
 * The key alone is not the coach: every later call is addressed by token id, so
 * a device holding the right twelve words and no id owns something it can never
 * name. These pin the two things that make the lookup trustworthy rather than
 * convenient — that it asks the node to do the filtering, and that it believes
 * the chain about who owns the coach now rather than the log about who made it.
 */
describe('finding the coach an address still owns', () => {
  const ME = '0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa'

  const fakeChain = ({ minted = [], owners = {}, throwOnQuery = false } = {}) => {
    const seen = { filters: [], ranges: [], ownerOf: [] }
    return {
      seen,
      contract: {
        filters: {
          CoachMinted: (tokenId, owner) => { seen.filters.push([tokenId, owner]); return { tokenId, owner } },
        },
        queryFilter: async (filter, from, to) => {
          seen.ranges.push([from, to])
          if (throwOnQuery) throw new Error('query returned more than 10000 results')
          // The node filters by the indexed owner topic; the fake honours that,
          // otherwise the test would pass on an implementation that pulls every
          // mint on the chain and sifts them in the browser.
          return minted
            .filter((m) => !filter.owner || m.owner.toLowerCase() === String(filter.owner).toLowerCase())
            .map((m) => ({ args: { tokenId: BigInt(m.tokenId) } }))
        },
        ownerOf: async (id) => {
          seen.ownerOf.push(String(id))
          const owner = owners[String(id)]
          if (!owner) throw new Error('nonexistent token')
          return owner
        },
      },
    }
  }

  const provider = { getBlockNumber: async () => 900_000 }

  it('finds the coach this key minted', async () => {
    const { coachOwnedBy } = await import('./marketplace.js')
    const { contract, seen } = fakeChain({
      minted: [{ tokenId: 23, owner: ME }],
      owners: { 23: ME },
    })

    await expect(coachOwnedBy(ME, { provider, contract })).resolves.toBe('23')
    // Filtered by the node, on the indexed topic.
    expect(seen.filters[0][1]).toBe(ME)
  })

  it('does not hand back a coach that has since been sold', async () => {
    // The log is a record of who minted, permanently. Ownership is not.
    const { coachOwnedBy } = await import('./marketplace.js')
    const { contract } = fakeChain({
      minted: [{ tokenId: 23, owner: ME }],
      owners: { 23: '0xBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbb' },
    })

    await expect(coachOwnedBy(ME, { provider, contract })).resolves.toBeNull()
  })

  it('returns the one being trained when a key minted twice', async () => {
    const { coachOwnedBy } = await import('./marketplace.js')
    const { contract } = fakeChain({
      minted: [{ tokenId: 7, owner: ME }, { tokenId: 41, owner: ME }],
      owners: { 7: ME, 41: ME },
    })

    await expect(coachOwnedBy(ME, { provider, contract })).resolves.toBe('41')
  })

  it('skips a coach it cannot read rather than failing the restore', async () => {
    const { coachOwnedBy } = await import('./marketplace.js')
    const { contract } = fakeChain({
      minted: [{ tokenId: 7, owner: ME }, { tokenId: 41, owner: ME }],
      owners: { 7: ME }, // 41 reverts
    })

    await expect(coachOwnedBy(ME, { provider, contract })).resolves.toBe('7')
  })

  it('asks for a bounded window of blocks', async () => {
    // Same cap as the market's own log read: a public RPC refuses a query that
    // spans more blocks than it allows, and the chain only gets longer.
    const { coachOwnedBy } = await import('./marketplace.js')
    const { contract, seen } = fakeChain({ minted: [], owners: {} })

    await coachOwnedBy(ME, { provider, contract })

    const [from, to] = seen.ranges[0]
    expect(from).toBeGreaterThan(0)
    expect(to - from).toBeLessThanOrEqual(45_000)
  })

  it('answers null rather than throwing when the node refuses the query', async () => {
    const { coachOwnedBy } = await import('./marketplace.js')
    const { contract } = fakeChain({ throwOnQuery: true })

    await expect(coachOwnedBy(ME, { provider, contract })).resolves.toBeNull()
  })

  it('asks nothing at all without an address', async () => {
    const { coachOwnedBy } = await import('./marketplace.js')
    const { contract, seen } = fakeChain({})

    await expect(coachOwnedBy(null, { provider, contract })).resolves.toBeNull()
    expect(seen.ranges).toHaveLength(0)
  })
})
