const clone = (o) => JSON.parse(JSON.stringify(o))

/**
 * A stored state, filled in with anything the defaults have gained since.
 *
 * This was `Object.assign(clone(DEF), state)`, which is shallow: a stored
 * `nutrition` or `reminder` replaced the default object entirely, so any key
 * added to one of them later never reached a profile that already existed. The
 * value comes back `undefined` at whatever screen reads it, long after the
 * change that caused it.
 *
 * Only plain objects are filled in. Arrays and the user's own maps — `week`,
 * `dayPlan`, `exWeights` — are theirs to be empty, and merging defaults into
 * them would put back things they deliberately cleared.
 */
export function withDefaults(state, defaults) {
  const out = clone(defaults)
  if (!state || typeof state !== 'object') return out

  for (const [key, value] of Object.entries(state)) {
    const fallback = out[key]
    const bothPlain =
      fallback && typeof fallback === 'object' && !Array.isArray(fallback) &&
      value && typeof value === 'object' && !Array.isArray(value)

    out[key] = bothPlain ? withDefaults(value, fallback) : value
  }

  return out
}
