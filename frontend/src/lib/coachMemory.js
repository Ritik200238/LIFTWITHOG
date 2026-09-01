/**
 * What the coach actually remembers, in sentences a person can read.
 *
 * The version counter on chain says a coach has learned twelve times. It does
 * not say what it learned, and "it learns from your training" is a claim
 * nobody can check — including the person who owns it. That is the gap this
 * closes: every evolve writes down what changed and why, in plain language,
 * and those notes are part of the payload that gets encrypted, stored on 0G
 * and hashed into the version. `version 12` stops being a number and becomes
 * twelve things the coach can tell you about yourself.
 *
 * Deliberately a pure function of two profiles. No clock of its own, no
 * network, no state — so the sentences are reproducible, and a memory can be
 * regenerated from two stored profiles and checked against what was recorded.
 * That is what makes it evidence rather than decoration.
 *
 * The writing rules, because they are product decisions and not style:
 *
 *   - Only what changed. A memory that repeats last version's facts teaches
 *     nobody anything and makes the log worthless to scroll.
 *   - Numbers, never adjectives. "Bench 60 → 70 kg" survives translation and
 *     argument; "great progress on bench" does not.
 *   - A stall is worth saying out loud. Coaching is mostly noticing what
 *     stopped moving, and a coach that only reports wins is a cheerleader.
 */

/** Memories per evolve. Enough to be a story, few enough to read. */
export const MAX_NOTES = 5

/** Sessions at the same best before a lift counts as stalled. */
export const STALL_SESSIONS = 3

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)

/** Weight as somebody would say it: 70, not 70.0; 72.5 kept. */
const weight = (value, unit) => `${Math.round(num(value) * 10) / 10} ${unit}`

const liftsById = (profile) => {
  const map = new Map()
  for (const lift of profile?.lifts ?? []) if (lift?.id) map.set(String(lift.id), lift)
  return map
}

/**
 * What changed between two profiles, as notes.
 *
 * `nameOf` turns an exercise id into something readable; it is injected rather
 * than imported so this module stays free of the exercise database and can be
 * tested against a handful of made-up lifts.
 */
export function diffProfiles(before, after, { nameOf = (id) => id } = {}) {
  const notes = []
  if (!after) return notes

  const unit = after.unit === 'lb' ? 'lb' : 'kg'
  const previous = liftsById(before)
  const current = liftsById(after)

  for (const [id, lift] of current) {
    const was = previous.get(id)
    const name = nameOf(id)

    // A lift the coach had never seen before.
    if (!was) {
      if (num(lift.bestWeight) > 0) {
        notes.push({
          kind: 'new-lift',
          liftId: id,
          text: `Started ${name} — ${weight(lift.bestWeight, unit)} × ${num(lift.bestReps)}.`,
          weight: 3,
        })
      }
      continue
    }

    const gained = num(lift.bestWeight) - num(was.bestWeight)

    if (gained > 0) {
      notes.push({
        kind: 'progress',
        liftId: id,
        text: `${name}: ${weight(was.bestWeight, unit)} → ${weight(lift.bestWeight, unit)}.`,
        // The biggest jump is the most worth reading, so weight by it.
        weight: 10 + gained,
      })
      continue
    }

    /*
     * Reps at the same weight. Real progress that a weight-only view calls a
     * stall — and telling somebody they stalled when they added two reps is
     * how a coach loses their trust.
     */
    if (gained === 0 && num(lift.bestReps) > num(was.bestReps) && num(lift.bestWeight) > 0) {
      notes.push({
        kind: 'reps',
        liftId: id,
        text: `${name}: same ${weight(lift.bestWeight, unit)}, ${num(was.bestReps)} → ${num(lift.bestReps)} reps.`,
        weight: 8,
      })
      continue
    }

    // Trained repeatedly, nothing moved. The thing a coach exists to notice.
    const sessionsSince = num(lift.sessions) - num(was.sessions)
    if (gained === 0 && sessionsSince >= STALL_SESSIONS && num(lift.bestWeight) > 0) {
      notes.push({
        kind: 'stall',
        liftId: id,
        text: `${name} has not moved in ${sessionsSince} sessions at ${weight(lift.bestWeight, unit)}.`,
        weight: 9,
      })
      continue
    }

    if (gained < 0) {
      notes.push({
        kind: 'regression',
        liftId: id,
        text: `${name} came down: ${weight(was.bestWeight, unit)} → ${weight(lift.bestWeight, unit)}.`,
        weight: 7,
      })
    }
  }

  // Bodyweight, only when it actually moved.
  const bwWas = num(before?.bodyweight)
  const bwNow = num(after?.bodyweight)
  if (bwWas > 0 && bwNow > 0 && Math.abs(bwNow - bwWas) >= 0.5) {
    const direction = bwNow > bwWas ? 'up' : 'down'
    notes.push({
      kind: 'bodyweight',
      text: `Bodyweight ${direction}: ${weight(bwWas, unit)} → ${weight(bwNow, unit)}.`,
      weight: 6,
    })
  }

  // A changed goal changes what every other number means.
  const goalWas = before?.nutrition?.goal ?? null
  const goalNow = after?.nutrition?.goal ?? null
  if (goalNow && goalWas !== goalNow) {
    notes.push({
      kind: 'goal',
      text: goalWas ? `Goal changed: ${goalWas} → ${goalNow}.` : `Training goal: ${goalNow}.`,
      weight: 5,
    })
  }

  // The coach's first memory: what it knew when it was made.
  if (!before && (after.lifts ?? []).length > 0) {
    notes.push({
      kind: 'origin',
      text: `Created knowing ${num(after.sessions)} sessions across ${(after.lifts ?? []).length} lifts.`,
      weight: 1,
    })
  }

  return notes
    .sort((a, b) => b.weight - a.weight || String(a.text).localeCompare(String(b.text)))
    .slice(0, MAX_NOTES)
    .map(({ weight: _rank, ...note }) => note)
}

/**
 * One version's memory, ready to be stored and hashed.
 *
 * `version` and `at` are recorded so a memory can be lined up with the
 * on-chain event that carries its hash — the join between what the app says
 * the coach learned and what the chain says happened.
 */
export function memoryEntry({ version, at, before, after, nameOf }) {
  return {
    version: num(version),
    at: num(at),
    sessions: num(after?.sessions),
    notes: diffProfiles(before, after, { nameOf }),
  }
}

/**
 * The running record, newest first, bounded.
 *
 * Bounded because it rides inside the payload uploaded to 0G Storage on every
 * evolve: unbounded, a coach trained for two years would pay to re-upload its
 * entire biography every session. Forty versions is a long memory and a small
 * blob.
 */
export const MAX_MEMORY = 40

export function rememberVersion(memory, entry) {
  const existing = Array.isArray(memory) ? memory : []

  // Re-recording a version replaces it rather than duplicating: an evolve that
  // was retried after a failed upload must not appear twice.
  const without = existing.filter((m) => num(m?.version) !== num(entry?.version))

  return [entry, ...without].sort((a, b) => num(b.version) - num(a.version)).slice(0, MAX_MEMORY)
}

/**
 * The memory as a coach would say it, for the model's prompt.
 *
 * This is the half that makes the feature more than a log: the same sentences
 * shown to the person are given to the model, so advice at version 12 is
 * informed by what versions 1–11 noticed. Newest first, because recent
 * training is what a question is usually about.
 */
export function memoryForPrompt(memory, { versions = 6 } = {}) {
  const entries = (Array.isArray(memory) ? memory : []).slice(0, versions)
  if (entries.length === 0) return ''

  return entries
    .map((entry) => {
      const lines = (entry.notes ?? []).map((note) => `  - ${note.text}`).join('\n')
      return `v${num(entry.version)}:\n${lines}`
    })
    .join('\n')
}
