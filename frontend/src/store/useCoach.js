/**
 * The coach, as app state.
 *
 * Kept next to the training data rather than behind a settings screen, because
 * the coach is supposed to be the thing this app is about: it watches what you
 * lift, and every time it learns something that gets recorded where it cannot
 * be quietly rewritten.
 *
 * What lives here locally is only ever a cache. The chain holds the truth about
 * ownership and version; this remembers which token is yours and what the coach
 * knew last time, so the app can tell — without asking anybody to pay for a
 * transaction — whether there is anything new worth recording.
 */

import { create } from 'zustand'
import { buildCoachProfile, hasLearned } from '../lib/coachProfile.js'
/*
 * `ogCoach` reaches ethers and the 0G storage SDK, and this store is imported
 * by the app store itself — so a static import here put roughly a megabyte of
 * chain library in front of every first paint, including a Home screen for
 * somebody who has no coach. The three functions that touch the chain are
 * loaded when they are called.
 */
import { COACH_ADDRESS } from '../lib/coachConfig.js'

const chain = () => import('../lib/ogCoach.js')
import { deviceAddressIfAny } from '../lib/deviceKey.js'
import { shouldEvolve } from '../lib/flywheel.js'
import { readScoped, writeScoped } from '../lib/profileScope.js'

const KEY = 'gym_coach_v1'

function load() {
  try {
    // Scoped per profile: this caches the training profile — bodyweight,
    // calorie targets, lifts — and stored globally it followed the browser
    // rather than the person, straight into the next account to sign in.
    const raw = readScoped(KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // A corrupted cache is not a reason to lose the app. The chain still knows
    // who owns what; this rebuilds itself from the next read.
  }
  return { tokenId: null, version: 0, profile: null, sessionsAtLastEvolve: 0 }
}

function save(coach) {
  try {
    writeScoped(KEY, JSON.stringify(coach))
  } catch {
    // Private windows and full disks. The coach still works this session.
  }
}

/*
 * There is no `getSigner` here any more, and that is the point.
 *
 * This used to demand a browser wallet before anybody could have a coach, which
 * ends the conversation for almost everybody who lifts. The device signs with a
 * key it generated itself and the server pays the fee; the coach still belongs
 * to that address and to nothing else.
 */

export const useCoach = create((set, get) => ({
  ...load(),
  busy: false,
  error: null,
  /** This device's address, once it has one. Shown on the proof screen. */
  address: null,

  /** Look up the device address without creating one. */
  loadAddress: async () => {
    const address = await deviceAddressIfAny()
    if (address) set({ address })
  },

  /** Whether the coach contract is deployed and wired up at all. */
  available: () => Boolean(COACH_ADDRESS),

  /**
   * Has the training moved since the coach last recorded what it knew?
   *
   * Pure and free — no wallet, no network. It runs on every render of the home
   * screen, so it must never cost anything.
   */
  hasSomethingToLearn: (S) => {
    const { tokenId, profile } = get()
    if (!tokenId) return false
    return hasLearned(profile, buildCoachProfile(S, { now: 0 }))
  },

  /** Create this person's coach from the training they already have. */
  mint: async (S) => {
    /*
     * `busy` was set here and read nowhere. Two taps on "Create my coach" ran
     * two mints: two relayer-funded transactions and two coaches, one of which
     * the person never asked for and cannot easily be rid of.
     */
    if (get().busy) return { alreadyRunning: true }

    set({ busy: true, error: null })
    try {
      const { tokenId, version, profile, memory, address } = await (await chain()).mintCoachRelayed(S)

      const next = {
        tokenId,
        version,
        profile,
        memory,
        address,
        // Minting records everything known so far, so the count starts here
        // rather than at zero — otherwise the first workout after signing up
        // would trip the flywheel immediately.
        sessionsAtLastEvolve: (S.workouts ?? []).length,
      }
      save(next)
      set({ ...next, busy: false })
      return next
    } catch (error) {
      set({ busy: false, error: error.message || String(error) })
      throw error
    }
  },

  /**
   * Put this coach on the market, or take it off with a price of zero.
   *
   * The trainer half of the product, and the reason `setRentalPriceFor` exists
   * on chain: a coach minted from a phone is owned by a key with no gas, so
   * listing it had to be relayed like everything else the device signs.
   */
  setPrice: async (pricePerDayWei) => {
    const { tokenId, busy } = get()
    if (!tokenId) throw new Error('There is no coach to list yet.')
    if (busy) return { alreadyRunning: true }

    set({ busy: true, error: null })
    try {
      await (await chain()).setRentalPriceRelayed(tokenId, pricePerDayWei)
      const listedFor = BigInt(pricePerDayWei).toString()
      save({ ...get(), listedFor })
      set({ listedFor, busy: false })
      return { listedFor }
    } catch (error) {
      set({ busy: false, error: error.message || String(error) })
      throw error
    }
  },

  /**
   * Record what the coach has learned.
   *
   * Quietly does nothing when there is nothing new. Every version costs a fee,
   * and a version that records no change also empties the version count of the
   * only meaning it has.
   */
  evolve: async (S) => {
    const { tokenId, profile, busy } = get()
    if (!tokenId) throw new Error('There is no coach to teach yet.')

    /*
     * Two evolves at once read the same nonce, so one of them is rejected —
     * and both add one to the version count from the same starting number, so
     * the count on this device stops matching the chain. Reachable without
     * trying: the flywheel fires when a workout finishes, and the button is
     * on screen at the same time.
     */
    if (busy) return { evolved: false, alreadyRunning: true }

    set({ busy: true, error: null })
    try {
      // The current version and memory go in, so the new entry is numbered to
      // match the version the chain is about to record.
      const result = await (await chain()).evolveCoachRelayed(tokenId, S, profile, {
        version: get().version,
        memory: get().memory,
      })

      if (!result.evolved) {
        set({ busy: false })
        return { evolved: false }
      }

      const next = {
        tokenId,
        version: get().version + 1,
        profile: result.profile,
        memory: result.memory ?? get().memory,
        sessionsAtLastEvolve: (S.workouts ?? []).length,
        address: get().address,
      }
      save(next)
      set({ ...next, busy: false })
      return { evolved: true }
    } catch (error) {
      set({ busy: false, error: error.message || String(error) })
      throw error
    }
  },

  /** Re-read the chain, which is the authority on version and existence. */
  refresh: async () => {
    const { tokenId } = get()
    if (!tokenId) return

    try {
      // A plain RPC read: no wallet, no permission prompt, nothing to install.
      // From the network config, not typed again here: a second copy of the
      // RPC and chain id is a second thing to forget when the network moves.
      // Loaded at the moment a coach is actually read, so the home screen does
      // not pay for the chain library before anybody has one.
      const { ethers } = await import('ethers')
      const { OG_NETWORK } = await import('../lib/ogVault.js')
      const provider = new ethers.JsonRpcProvider(
        OG_NETWORK.rpcUrl,
        OG_NETWORK.chainId,
        { staticNetwork: true },
      )
      const onChain = await (await chain()).readCoach(provider, tokenId)
      set({ version: onChain.version })
      save({ ...get(), version: onChain.version })
    } catch {
      // Offline, or a wallet on the wrong network. The cached view stands; it
      // is a version number, not something anybody acts on blindly.
    }
  },

  /**
   * Record what the coach learned, if a block of training has gone by.
   *
   * Called when a workout finishes. Deliberately quiet: it returns rather than
   * throwing, and never shows an error, because a chain that is slow or a
   * relayer that is out of funds must not intrude on somebody who has just
   * finished training. The next workout tries again.
   */
  maybeEvolve: async (S) => {
    const state = get()
    const sessions = (S.workouts ?? []).length
    const learned = state.hasSomethingToLearn(S)

    if (!shouldEvolve(state, sessions, learned)) return { evolved: false }

    try {
      return await state.evolve(S)
    } catch {
      // Left for next time. Nothing about a finished workout should depend on
      // a network somebody else runs.
      set({ error: null })
      return { evolved: false }
    }
  },

  /** Forget the local cache. Ownership is unaffected — that lives on chain. */
  forget: () => {
    const cleared = { tokenId: null, version: 0, profile: null, sessionsAtLastEvolve: 0 }
    save(cleared)
    set({ ...cleared, error: null })
  },
}))
