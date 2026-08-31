/**
 * What a coach actually knows about you.
 *
 * This turns a training history into the compact thing a coach is: which lifts
 * you do, where they sit now, how fast they have moved, and when you train.
 * It is the payload that gets encrypted, stored on 0G, and hashed on chain.
 *
 * Kept as a pure function on purpose — no wallet, no network, no clock of its
 * own. It is the one part of coach ownership that can be tested properly, and
 * it is also the part most likely to be quietly wrong, since nobody looks
 * inside an encrypted blob.
 */

import { computeTargets } from './nutrition.js'
import { nutritionState } from './nutritionProfile.js'

/** How many recent sessions inform the profile. Enough to see a trend. */
export const HISTORY_WINDOW = 40

/** Coaches below this many sessions are guesses, and say so. */
export const MIN_SESSIONS_FOR_CONFIDENCE = 8

/**
 * Best working set for an exercise, as kg × reps.
 *
 * Volume rather than raw weight: three sets of five at 60 says more about where
 * somebody is than one heavy single they never repeated.
 */
function bestSet(sets = []) {
  let best = null
  for (const set of sets) {
    /*
     * Only completed sets. An unticked set is one somebody planned and did not
     * do, and a coach built from intentions would keep prescribing weights
     * nobody has ever actually lifted.
     */
    if (!set?.done) continue

    const weight = Number(set.w ?? 0)
    const reps = Number(set.r ?? 0)
    if (!Number.isFinite(weight) || !Number.isFinite(reps) || reps <= 0) continue

    const score = weight * reps
    if (!best || score > best.score) best = { weight, reps, score }
  }
  return best
}

/**
 * What the coach needs to know about how somebody is eating.
 *
 * A coach that does not know whether you are in a deficit is guessing at half
 * the question. The same lifter, the same lifts, the same week reads completely
 * differently at 1800 calories than at 2800 — a stalled bench during a cut is
 * the plan working, and during a bulk it is the plan failing.
 *
 * Only the targets travel, never the meal plan. The plan is regenerated from
 * these numbers whenever it is wanted, so storing it would put a hundred lines
 * of food into an encrypted blob to say what six numbers already say.
 *
 * Returns null when there is nothing to say — an incomplete profile, or one the
 * app has refused to plan for. A partial object here would reach the model as a
 * set of half-known facts, which is worse than an admitted absence.
 */
export function nutritionFor(state = {}) {
  const status = nutritionState(state)
  if (status.status !== 'ready') return null

  const targets = computeTargets(status.profile)

  return {
    goal: status.profile.goal,
    diet: status.profile.diet,
    activity: status.profile.activity,
    calories: targets.calories,
    proteinG: targets.proteinG,
    fatG: targets.fatG,
    carbG: targets.carbG,
    /*
     * Whether they chose this or the app suggested it. A coach should not
     * argue with a goal somebody committed to, and should feel free to
     * question one that was merely defaulted.
     */
    chosen: status.chosen,
  }
}

/**
 * Distil a training history into a coach profile.
 *
 * @param {object} state  The app's stored state (`workouts`, `bodyweight`, `unit`).
 * @param {object} [opts] `now` in ms, so the caller owns the clock.
 */
export function buildCoachProfile(state = {}, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : 0
  const workouts = Array.isArray(state.workouts) ? state.workouts : []

  // Newest last in storage; the window is the tail.
  const recent = workouts.slice(-HISTORY_WINDOW)

  /** exerciseId -> { sessions, best, first, last } */
  const lifts = {}

  for (const session of recent) {
    // `d` is the ISO day the session was logged against.
    const when = session?.d ?? null
    const entries = Array.isArray(session?.entries) ? session.entries : []

    for (const entry of entries) {
      const id = entry?.id
      if (!id) continue

      const best = bestSet(entry.sets)
      if (!best) continue

      const lift = (lifts[id] ??= { sessions: 0, best: null, last: when })
      lift.sessions += 1
      // ISO days compare correctly as strings, so the latest is the greatest.
      if (when && (!lift.last || when > lift.last)) lift.last = when
      if (!lift.best || best.score > lift.best.score) lift.best = best
    }
  }

  const bodyweight = Array.isArray(state.bodyweight) ? state.bodyweight : []
  const latestWeight = bodyweight.length ? bodyweight[bodyweight.length - 1] : null

  const sessionCount = recent.length

  return {
    /*
     * Versioned from the start. A coach is meant to outlive the app that made
     * it, so something reading this in two years has to know what it is holding.
     */
    schema: 1,
    generatedAt: now,
    unit: state.unit === 'lb' ? 'lb' : 'kg',
    sessions: sessionCount,
    /*
     * Said plainly rather than left for the reader to work out. A coach built on
     * three sessions is a guess, and a guess that presents itself with the same
     * authority as two years of history is how somebody gets hurt following it.
     */
    confident: sessionCount >= MIN_SESSIONS_FOR_CONFIDENCE,
    bodyweight: latestWeight ? Number(latestWeight.w ?? latestWeight.kg ?? 0) || null : null,
    nutrition: nutritionFor(state),
    lifts: Object.entries(lifts)
      .map(([id, lift]) => ({
        id,
        sessions: lift.sessions,
        bestWeight: lift.best?.weight ?? 0,
        bestReps: lift.best?.reps ?? 0,
        lastTrained: lift.last ?? null,
      }))
      // Most-trained first: what somebody actually does defines them more than
      // the thing they tried once.
      .sort((a, b) => b.sessions - a.sessions || String(a.id).localeCompare(String(b.id))),
  }
}

/**
 * A stable string for a profile, for hashing.
 *
 * Key order has to be fixed or the same profile hashes two ways, and the chain
 * would record a change every time nothing changed. `generatedAt` is left out
 * for the same reason: a coach that learned nothing must not look like it did.
 */
export function canonicalise(profile) {
  const stable = {
    schema: profile.schema,
    unit: profile.unit,
    sessions: profile.sessions,
    confident: profile.confident,
    bodyweight: profile.bodyweight,
    /*
     * Included deliberately. Switching from a bulk to a cut changes what this
     * coach is for, and leaving it out would mean the app knew something new
     * about somebody and recorded no version — the on-chain count is supposed
     * to be the evidence that a coach has history, so it has to move when the
     * history does. Written out key by key rather than spread, because key
     * order decides the hash.
     */
    nutrition: profile.nutrition
      ? {
          goal: profile.nutrition.goal,
          diet: profile.nutrition.diet,
          activity: profile.nutrition.activity,
          calories: profile.nutrition.calories,
          proteinG: profile.nutrition.proteinG,
          fatG: profile.nutrition.fatG,
          carbG: profile.nutrition.carbG,
          chosen: profile.nutrition.chosen,
        }
      : null,
    lifts: (profile.lifts ?? []).map((lift) => ({
      id: lift.id,
      sessions: lift.sessions,
      bestWeight: lift.bestWeight,
      bestReps: lift.bestReps,
      lastTrained: lift.lastTrained,
    })),
  }
  return JSON.stringify(stable)
}

/**
 * Has the coach actually learned anything since the last version?
 *
 * Every evolve is a transaction somebody pays for, so a version that records no
 * change is a fee charged for nothing — and it makes the on-chain version count,
 * which is the evidence that this coach has history, meaningless.
 */
export function hasLearned(previousProfile, nextProfile) {
  if (!previousProfile) return true
  return canonicalise(previousProfile) !== canonicalise(nextProfile)
}
