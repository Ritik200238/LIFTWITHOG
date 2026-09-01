import { describe, it, expect } from 'vitest'
import {
  MAX_MEMORY,
  MAX_NOTES,
  STALL_SESSIONS,
  diffProfiles,
  memoryEntry,
  memoryForPrompt,
  rememberVersion,
} from './coachMemory.js'

/**
 * What the coach remembers.
 *
 * The stakes are unusual for a pure function: these sentences are shown to the
 * owner as "what your coach knows about you" *and* handed to the model that
 * gives advice, and their hash is what the chain records as a version. A wrong
 * sentence here is a wrong claim in three places at once — one of them
 * permanent.
 */

const nameOf = (id) => ({ bench: 'Bench press', squat: 'Squat', row: 'Barbell row' })[id] ?? id

const profile = (lifts, extra = {}) => ({
  unit: 'kg',
  sessions: 10,
  bodyweight: 80,
  lifts: Object.entries(lifts).map(([id, [bestWeight, bestReps, sessions]]) => ({
    id,
    bestWeight,
    bestReps,
    sessions,
  })),
  ...extra,
})

describe('noticing what changed', () => {
  it('reports a lift that went up, with both numbers', () => {
    // Adjectives do not survive translation or argument; numbers do.
    const notes = diffProfiles(
      profile({ bench: [60, 5, 4] }),
      profile({ bench: [70, 5, 5] }),
      { nameOf },
    )

    expect(notes).toHaveLength(1)
    expect(notes[0].kind).toBe('progress')
    expect(notes[0].text).toBe('Bench press: 60 kg → 70 kg.')
  })

  it('counts more reps at the same weight as progress, not a stall', () => {
    /*
     * The failure that would cost the most trust: telling somebody who added
     * two reps that they have not moved. A weight-only comparison does exactly
     * that.
     */
    const notes = diffProfiles(
      profile({ bench: [70, 5, 4] }),
      profile({ bench: [70, 8, 5] }),
      { nameOf },
    )

    expect(notes[0].kind).toBe('reps')
    expect(notes[0].text).toContain('5 → 8 reps')
  })

  it('says out loud when a lift stopped moving', () => {
    // The thing a coach exists to notice. A record of only good news is a
    // cheerleader, and nobody deloads on a cheerleader's advice.
    const notes = diffProfiles(
      profile({ squat: [100, 5, 2] }),
      profile({ squat: [100, 5, 2 + STALL_SESSIONS] }),
      { nameOf },
    )

    expect(notes[0].kind).toBe('stall')
    expect(notes[0].text).toContain(`${STALL_SESSIONS} sessions`)
  })

  it('waits before calling it a stall', () => {
    // One flat session is a session, not a plateau.
    const notes = diffProfiles(
      profile({ squat: [100, 5, 2] }),
      profile({ squat: [100, 5, 3] }),
      { nameOf },
    )

    expect(notes).toHaveLength(0)
  })

  it('records a lift the coach had never seen', () => {
    const notes = diffProfiles(profile({ bench: [60, 5, 4] }), profile({ bench: [60, 5, 4], row: [50, 8, 1] }), { nameOf })

    expect(notes).toHaveLength(1)
    expect(notes[0].kind).toBe('new-lift')
    expect(notes[0].text).toContain('Barbell row')
  })

  it('does not hide a lift going backwards', () => {
    const notes = diffProfiles(profile({ bench: [80, 5, 6] }), profile({ bench: [70, 5, 7] }), { nameOf })

    expect(notes[0].kind).toBe('regression')
    expect(notes[0].text).toBe('Bench press came down: 80 kg → 70 kg.')
  })

  it('says nothing when nothing changed', () => {
    /*
     * The property that keeps the whole record worth reading. An evolve that
     * learned nothing must produce an empty memory, not a restatement of last
     * version's facts.
     */
    const same = profile({ bench: [60, 5, 4], squat: [100, 5, 6] })

    expect(diffProfiles(same, structuredClone(same), { nameOf })).toEqual([])
  })

  it('ignores bodyweight noise and reports a real move', () => {
    // Scales wobble. 200 g is not news; a kilo is.
    const flat = diffProfiles(profile({}, { bodyweight: 80 }), profile({}, { bodyweight: 80.2 }), { nameOf })
    expect(flat).toEqual([])

    const moved = diffProfiles(profile({}, { bodyweight: 80 }), profile({}, { bodyweight: 78.5 }), { nameOf })
    expect(moved[0].kind).toBe('bodyweight')
    expect(moved[0].text).toContain('down')
  })

  it('notices a changed goal, because it changes what every number means', () => {
    const notes = diffProfiles(
      profile({}, { nutrition: { goal: 'gain' } }),
      profile({}, { nutrition: { goal: 'lose' } }),
      { nameOf },
    )

    expect(notes[0].kind).toBe('goal')
    expect(notes[0].text).toContain('gain → lose')
  })

  it('gives a brand-new coach an origin memory', () => {
    const notes = diffProfiles(null, profile({ bench: [60, 5, 4] }), { nameOf })

    expect(notes.some((n) => n.kind === 'origin')).toBe(true)
  })

  it('keeps the most useful notes when a lot changed at once', () => {
    const before = profile({ a: [50, 5, 4], b: [50, 5, 4], c: [50, 5, 4], d: [50, 5, 4], e: [50, 5, 4], f: [50, 5, 4] })
    const after = profile({ a: [60, 5, 5], b: [55, 5, 5], c: [90, 5, 5], d: [52, 5, 5], e: [70, 5, 5], f: [51, 5, 5] })

    const notes = diffProfiles(before, after, { nameOf })

    expect(notes).toHaveLength(MAX_NOTES)
    // Biggest jump first: 50 → 90 is the one worth reading.
    expect(notes[0].text).toContain('90 kg')
  })

  it('survives rubbish without inventing a memory', () => {
    expect(diffProfiles(null, null)).toEqual([])
    expect(diffProfiles(undefined, { lifts: null })).toEqual([])
    expect(diffProfiles({ lifts: [{}] }, { lifts: [{}] })).toEqual([])
  })
})

describe('the running record', () => {
  const entry = (version, text = 'something') => ({ version, at: version * 1000, sessions: version, notes: [{ text }] })

  it('keeps newest first', () => {
    const memory = [entry(2), entry(1)].reduce((m, e) => rememberVersion(m, e), [])
    const next = rememberVersion(memory, entry(3))

    expect(next.map((m) => m.version)).toEqual([3, 2, 1])
  })

  it('replaces a version rather than duplicating it', () => {
    /*
     * An evolve retried after a failed upload re-records the same version.
     * Duplicated, the memory would show the same lesson twice and the count
     * would stop matching the chain.
     */
    const memory = rememberVersion([], entry(4, 'first attempt'))
    const next = rememberVersion(memory, entry(4, 'the retry'))

    expect(next).toHaveLength(1)
    expect(next[0].notes[0].text).toBe('the retry')
  })

  it('stays bounded, because it is re-uploaded on every evolve', () => {
    // Unbounded, a coach trained for two years pays to re-upload its whole
    // biography every session.
    let memory = []
    for (let v = 1; v <= MAX_MEMORY + 15; v += 1) memory = rememberVersion(memory, entry(v))

    expect(memory).toHaveLength(MAX_MEMORY)
    expect(memory[0].version).toBe(MAX_MEMORY + 15)
  })

  it('builds an entry tied to its on-chain version', () => {
    // The join between what the app says was learned and what the chain
    // recorded: without the version, a memory cannot be checked against
    // anything.
    const built = memoryEntry({
      version: 7,
      at: 1_700_000_000_000,
      before: profile({ bench: [60, 5, 4] }),
      after: profile({ bench: [70, 5, 5] }),
      nameOf,
    })

    expect(built.version).toBe(7)
    expect(built.at).toBe(1_700_000_000_000)
    expect(built.notes[0].text).toContain('60 kg → 70 kg')
  })
})

describe('what the model is told', () => {
  it('reads as versions with their lessons, newest first', () => {
    const memory = [
      { version: 3, notes: [{ text: 'Squat 100 → 105 kg.' }] },
      { version: 2, notes: [{ text: 'Bench stalled.' }] },
    ]

    const prompt = memoryForPrompt(memory)

    expect(prompt).toContain('v3:')
    expect(prompt.indexOf('v3:')).toBeLessThan(prompt.indexOf('v2:'))
    expect(prompt).toContain('Squat 100 → 105 kg.')
  })

  it('is bounded, so a long history cannot crowd out the question', () => {
    const memory = Array.from({ length: 30 }, (_, i) => ({ version: 30 - i, notes: [{ text: 'x' }] }))

    expect(memoryForPrompt(memory, { versions: 4 }).match(/^v\d+:/gm)).toHaveLength(4)
  })

  it('is dramatically smaller than the record it summarises', () => {
    /*
     * The reason the digest exists. The config is handed to the model as text,
     * so a full forty-version record is kilobytes of JSON punctuation
     * competing with the question somebody actually asked.
     */
    const memory = Array.from({ length: 40 }, (_, i) => ({
      version: 40 - i,
      at: i,
      sessions: i,
      notes: [{ kind: 'progress', text: 'Bench press: 60 kg → 70 kg.' }, { kind: 'stall', text: 'Squat has not moved in 3 sessions at 100 kg.' }],
    }))

    const digest = memoryForPrompt(memory)
    const raw = JSON.stringify(memory)

    expect(digest.length).toBeLessThan(raw.length / 3)
    // And it is the recent end that survives, not an arbitrary slice.
    expect(digest).toContain('v40:')
    expect(digest).not.toContain('v1:')
  })

  it('is empty when there is nothing to say', () => {
    // An empty string, not the word "none": the prompt builder decides how to
    // present having no history, and a stray label would become an instruction.
    expect(memoryForPrompt([])).toBe('')
    expect(memoryForPrompt(null)).toBe('')
  })
})
