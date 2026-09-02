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
  const days = ageInDays(coach.createdAt, now)
  const versions = coach.version ?? 1

  const age =
    days >= 60
      ? `${Math.floor(days / 30)} months`
      : days >= 1
        ? `${days} ${days === 1 ? 'day' : 'days'}`
        : 'today'

  const learned = versions > 1 ? `learned ${versions - 1} times` : 'has not learned yet'

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
 * Every coach currently for rent.
 *
 * Walks the token ids rather than an index, because the contract keeps no list
 * of listings — and a list it did keep would be one more thing to fall out of
 * step with the truth. There are few enough coaches for this to be honest work;
 * when there are not, this is where a subgraph goes.
 */
export async function listRentableCoaches(opts = {}) {
  if (!COACH_ADDRESS) return []

  const provider = opts.provider ?? readProvider()
  const contract = coachContract(provider)
  const limit = opts.limit ?? 50

  const total = Number(await contract.totalMinted())
  const found = []

  for (let id = 1; id <= total && found.length < limit; id += 1) {
    try {
      const price = await contract.rentalPrice(id)
      if (price === 0n) continue

      const [, configURI, version, updatedAt] = await contract.coachOf(id)
      const owner = await contract.ownerOf(id)

      found.push({
        tokenId: String(id),
        owner,
        version: Number(version),
        updatedAt: Number(updatedAt) * 1000,
        configURI,
        pricePerDay: price.toString(),
      })
    } catch {
      /*
       * A token that cannot be read is skipped rather than failing the page.
       * One bad row must not empty a marketplace.
       */
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
  const contract = coachContract(provider)

  const wanted = new Set(tokenIds.map(String))
  const times = {}

  const events = await contract.queryFilter(contract.filters.CoachMinted(), 0, 'latest')

  for (const event of events) {
    const id = String(event.args?.tokenId)
    if (!wanted.has(id)) continue

    const block = await event.getBlock()
    times[id] = Number(block.timestamp) * 1000
  }

  return times
}
