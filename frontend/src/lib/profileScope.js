/**
 * Which profile a piece of local storage belongs to.
 *
 * This app supports several profiles in one browser — the sign-in screen says
 * so — but two things were stored globally rather than per profile: the device
 * key that signs as you, and the coach cache, which holds a copy of your
 * training profile including bodyweight and calorie targets.
 *
 * So signing out and signing in as somebody else on the same browser handed
 * over both. The new person saw the previous person's coach and their cached
 * health data, and their requests were signed by the previous person's device
 * address.
 *
 * Clearing those on sign-out would have been worse in a different way: the
 * device key owns a coach on chain, and deleting it destroys access to
 * something real for anybody who never wrote down their twelve words. Scoping
 * them per profile leaks nothing and destroys nothing.
 */

const USER_KEY = 'gym_user'

/**
 * The profile in use, or `guest`.
 *
 * Read from storage rather than passed in, because the two callers are a
 * signing module and a zustand store that both run outside React and neither
 * has the session to hand.
 */
export function currentProfileId() {
  try {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return 'guest'
    const id = JSON.parse(raw)?.id
    return id ? String(id) : 'guest'
  } catch {
    return 'guest'
  }
}

/** A storage key belonging to the profile in use. */
export function scopedKey(base, profileId = currentProfileId()) {
  return `${base}:${profileId}`
}

/**
 * Read a scoped value, adopting a pre-scoping one if that is all there is.
 *
 * Without this, shipping the scoping would look exactly like the bug it fixes:
 * every existing user would open the app to find their coach gone, because it
 * is filed under a key nothing looks at any more.
 *
 * The legacy value is removed once adopted, so it can only ever be inherited by
 * the first profile to open the app — never by the next person to sign in,
 * which is the leak this exists to close.
 */
export function readScoped(base, profileId = currentProfileId()) {
  try {
    const scoped = localStorage.getItem(scopedKey(base, profileId))
    if (scoped !== null) return scoped

    const legacy = localStorage.getItem(base)
    if (legacy === null) return null

    localStorage.setItem(scopedKey(base, profileId), legacy)
    localStorage.removeItem(base)
    return legacy
  } catch {
    // Private windows and blocked site data.
    return null
  }
}

export function writeScoped(base, value, profileId = currentProfileId()) {
  try {
    localStorage.setItem(scopedKey(base, profileId), value)
    return true
  } catch {
    return false
  }
}

export function clearScoped(base, profileId = currentProfileId()) {
  try {
    localStorage.removeItem(scopedKey(base, profileId))
  } catch {
    /* nothing to do */
  }
}
