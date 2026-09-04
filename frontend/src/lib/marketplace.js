/**
 * Coaches somebody can rent, read from the chain.
 *
 * The listing is the trust story, and it is made of facts rather than a profile
 * a trainer wrote about themselves. A coach carries the moment it was created,
 * how many versions it has recorded, and when it last learned something —
 * every one of those written by the contract, none of them editable after.
 *
 * Which gives the marketplace the one guarantee it needs: **you cannot fake
 * time.** A coach claiming a year of history has a year of history, because the
 * chain has been watching. Somebody who spun one up last night is standing next
 * to that, saying so, whether they like it or not.
 */

import { ethers } from 'ethers'
import { COACH_ADDRESS, coachContract } from './ogCoach.js'
import { OG_NETWORK } from './ogVault.js'
/*
 * The same builder the API uses, so a browser and the server degrade the same
 * way when an RPC is slow. Imported from `server/` for the reason the coach
 * envelope is: one implementation cannot disagree with itself.
 */
import { ogProvider } from '../../../server/ogProvider.js'

/**
 * A read-only view of the chain. No wallet, no permission prompt.
 *
 * Every read in the app comes through here — the market, the proof page, the
 * verify page, the coach's version. That is deliberate: it is the one place to
 * add a fallback endpoint, and a page that builds its own provider is a page
 * that keeps failing after the others have been fixed.
 */
export function readProvider() {
  return ogProvider(OG_NETWORK.rpcUrl, OG_NETWORK.chainId, {
    fallbacks: import.meta.env?.VITE_OG_RPC_FALLBACK_URLS,
  })
}

/**
 * How old a coach is, in days, from when it was first recorded.
 *
 * `updatedAt` moves every time it learns, so it cannot answer this on its own —
 * the creation moment comes from the mint, which the caller supplies.
 */
export function ageInDays(createdAtMs, now = Date.now()) {
  if (!createdAtMs) return 0
  return Math.max(0, Math.floor((now - createdAtMs) / 86_400_000))
}

/**
 * What a coach's history says about it, in a sentence.
 *
 * Deliberately plain. "Version 14 · 8 months" is a fact somebody can check on
 * an explorer; "elite programming" is a thing anybody can type.
 */
export function historyLine(coach, now = Date.now()) {
  const versions = coach.version ?? 1
  const learned = versions > 1 ? `learned ${versions - 1} times` : 'has not learned yet'

  /*
   * Unknown is not zero.
   *
   * The creation time comes from the mint log over a bounded block window, so
   * a coach minted before that window has no known age. `ageInDays(null)` is 0,
   * and 0 rendered as "Created today" — which put a false sentence on every
   * coach in the market older than the window, on the one screen whose whole
   * argument is that you cannot fake time. Say nothing about age instead.
   */
  if (coach.createdAt == null) return learned[0].toUpperCase() + learned.slice(1)

  const days = ageInDays(coach.createdAt, now)

  const age =
    days >= 60
      ? `${Math.floor(days / 30)} months`
      : days >= 1
        ? `${days} ${days === 1 ? 'day' : 'days'}`
        : 'today'

  return days === 0 ? `Created today · ${learned}` : `${age} old · ${learned}`
}

/** Price for a number of days, in wei. */
export function costFor(pricePerDay, days) {
  if (!pricePerDay || days <= 0) return 0n
  return BigInt(pricePerDay) * BigInt(Math.floor(days))
}

/** A price a person can read. */
export function formatPrice(pricePerDay) {
  if (!pricePerDay || BigInt(pricePerDay) === 0n) return null
  return `${ethers.formatEther(pricePerDay)} 0G / day`
}

/**
 * The newest coaches to look at, and how many at a time.
 *
 * `mint` is permissionless, so the id space is whatever anybody has made of it.
 * Reading every id from 1 upwards meant one round trip per token before the
 * page could render anything — so somebody minting five hundred empty coaches
 * made the marketplace unusable for everyone, at almost no cost to themselves.
 *
 * Newest-first bounds that: the work is a function of what is shown, not of
 * what exists. It is also the better ordering for a marketplace, which is a
 * happy accident rather than the reason.
 */
const SCAN_DEPTH = 300
const BATCH = 25

/**
 * How far back mint events are looked for.
 *
 * Public RPCs refuse unbounded `eth_getLogs` ranges, and the limit varies by
 * provider, so this is chosen to be comfortably inside the smallest one rather
 * than tuned to any particular endpoint. At 0G's block time this is a wide
 * window in wall-clock terms.
 */
const MINT_LOG_WINDOW = 45_000

/**
 * Every coach currently for rent.
 *
 * Walks the token ids rather than an index, because the contract keeps no list
 * of listings — and a list it did keep would be one more thing to fall out of
 * step with the truth. When this stops being enough, it is where a subgraph
 * goes; until then it must at least not be a way to take the page down.
 */
export async function listRentableCoaches(opts = {}) {
  if (!COACH_ADDRESS) return []

  const provider = opts.provider ?? readProvider()
  /*
   * Injectable for the same reason the loader on the server is: the two things
   * worth asserting here — that this does not read every id that exists, and
   * that it does not ask for every block that exists — are invisible against a
   * real chain and trivial against a contract that counts what it was asked.
   */
  const contract = opts.contract ?? coachContract(provider)
  const limit = opts.limit ?? 50
  const depth = opts.scanDepth ?? SCAN_DEPTH

  const total = Number(await contract.totalMinted())
  const oldest = Math.max(1, total - depth + 1)
  const found = []

  /*
   * In batches, and in parallel within a batch. Sequentially this was one
   * round trip per id against a public RPC, which is both slow for a real
   * marketplace and the thing that made the griefing cheap.
   */
  for (let top = total; top >= oldest && found.length < limit; top -= BATCH) {
    const ids = []
    for (let id = top; id > top - BATCH && id >= oldest; id -= 1) ids.push(id)

    const rows = await Promise.all(
      ids.map(async (id) => {
        try {
          const price = await contract.rentalPrice(id)
          if (price === 0n) return null

          // Only for coaches that are actually listed: the other reads are the
          // expensive part, and most ids are not for rent.
          const [[, configURI, version, updatedAt], owner] = await Promise.all([
            contract.coachOf(id),
            contract.ownerOf(id),
          ])

          return {
            tokenId: String(id),
            owner,
            version: Number(version),
            updatedAt: Number(updatedAt) * 1000,
            configURI,
            pricePerDay: price.toString(),
          }
        } catch {
          /*
           * A token that cannot be read is skipped rather than failing the page.
           * One bad row must not empty a marketplace.
           */
          return null
        }
      }),
    )

    for (const row of rows) {
      if (row && found.length < limit) found.push(row)
    }
  }

  return found
}

/**
 * When each of these coaches was created, from the chain's own log.
 *
 * The contract does not store a creation time — `updatedAt` moves whenever a
 * coach learns — so it comes from the mint event, which cannot be rewritten.
 * Without this, "how old is this coach" would be a number the seller supplies.
 */
export async function creationTimes(tokenIds, opts = {}) {
  if (tokenIds.length === 0) return {}

  const provider = opts.provider ?? readProvider()
  const contract = opts.contract ?? coachContract(provider)

  const wanted = new Set(tokenIds.map(String))
  const times = {}

  /*
   * A bounded window, not the whole chain.
   *
   * This asked for every CoachMinted event from block 0 to latest, on every
   * load of the market page. Public RPCs cap how many blocks a log query may
   * span, and Galileo only gets longer — so this was a page that worked in
   * testing and would start returning nothing, with the failure landing on the
   * caller as an empty marketplace rather than as an error about log ranges.
   *
   * Ages are decoration next to price and version, so a coach older than the
   * window simply has no age shown. Losing a subtitle is the right failure;
   * losing the page is not.
   */
  const latest = await provider.getBlockNumber().catch(() => null)
  if (latest === null) return times

  const from = Math.max(0, latest - (opts.blockWindow ?? MINT_LOG_WINDOW))

  let events = []
  try {
    events = await contract.queryFilter(contract.filters.CoachMinted(), from, latest)
  } catch {
    return times
  }

  /*
   * One block fetch per distinct block, not per event — a batch of coaches
   * minted together shares a timestamp, and the seed script mints them that way.
   */
  const blocks = new Map()

  await Promise.all(
    events
      .filter((event) => wanted.has(String(event.args?.tokenId)))
      .map(async (event) => {
        if (!blocks.has(event.blockNumber)) {
          blocks.set(event.blockNumber, event.getBlock().catch(() => null))
        }
        const block = await blocks.get(event.blockNumber)
        if (block) times[String(event.args.tokenId)] = Number(block.timestamp) * 1000
      }),
  )

  return times
}

/**
 * The coach an address still owns, for a device that has just been given its key.
 *
 * Restoring onto a new phone hands the app twelve words and nothing else. The
 * key alone is not the coach: every later call — evolve, list, ask — is
 * addressed by token id, and a device that does not know its id owns something
 * it can never name.
 *
 * Found from the mint log rather than by scanning ids, because `owner` is an
 * indexed topic there and the node does the filtering. Ownership is then
 * re-read from the chain: the log says who minted, and a coach that has since
 * been sold must not come back to the person who made it.
 *
 * Bounded to the same window as `creationTimes`, and for the same reason — a
 * public RPC caps how many blocks one log query may span. A coach minted before
 * the window is not found, which is honest and recoverable (the id can be typed
 * in); a query that is refused outright finds nothing at all.
 *
 * @returns {Promise<string|null>} the newest token id this address still owns.
 */
export async function coachOwnedBy(address, opts = {}) {
  if (!COACH_ADDRESS || !address) return null

  const provider = opts.provider ?? readProvider()
  const contract = opts.contract ?? coachContract(provider)

  const latest = await provider.getBlockNumber().catch(() => null)
  if (latest === null) return null
  const from = Math.max(0, latest - (opts.blockWindow ?? MINT_LOG_WINDOW))

  let events = []
  try {
    events = await contract.queryFilter(contract.filters.CoachMinted(null, address), from, latest)
  } catch {
    return null
  }

  // Newest first: somebody who minted twice wants the coach they have been
  // training, which is the later one.
  const ids = events
    .map((event) => event.args?.tokenId)
    .filter((id) => id !== undefined && id !== null)
    .map(String)
    .sort((a, b) => Number(b) - Number(a))

  for (const id of ids) {
    try {
      const owner = await contract.ownerOf(id)
      if (String(owner).toLowerCase() === String(address).toLowerCase()) return id
    } catch {
      // Burned, or an id this node cannot read. Try the next one rather than
      // failing a restore over one bad row.
    }
  }

  return null
}
