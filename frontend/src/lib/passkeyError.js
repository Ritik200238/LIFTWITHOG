import { t } from './i18n.js'

/**
 * What to say when a passkey does not work.
 *
 * Three call sites passed `e.message` straight to a toast, so the browser's own
 * wording reached the screen. On a desktop Chrome with no platform
 * authenticator, signing in showed:
 *
 *   Resident credentials or empty 'allowCredentials' lists are not supported
 *   at this time.
 *
 * That is a sentence written for whoever implements WebAuthn. To somebody
 * trying to sign in it says nothing about what happened, and nothing about what
 * to do — and it is the first thing a new person sees if they tap the top
 * button on the welcome screen out of habit.
 *
 * These map the failures that actually happen to sentences that name the cause
 * and the way forward. Anything unrecognised falls back to the plain line
 * rather than to the browser's, because an unfamiliar error is exactly the case
 * where raw text is least likely to help.
 */

/** Dismissals, not failures: the person closed the prompt or it timed out. */
export function wasCancelled(error) {
  return error?.name === 'NotAllowedError' || error?.name === 'AbortError'
}

export function passkeyMessage(error, { signingIn = true } = {}) {
  const name = error?.name ?? ''
  const raw = String(error?.message ?? '')

  /*
   * No authenticator on this machine. Chrome words it as a limitation of
   * "resident credentials", which is true and useless; what the person needs to
   * know is that this device cannot make or hold a passkey, and that the app
   * still works without one.
   */
  if (name === 'NotSupportedError' || /resident credentials|allowCredentials/i.test(raw)) {
    return t('This device has no fingerprint, face or PIN set up for passkeys. You can keep using LIFTWITHOG without an account.')
  }

  if (name === 'InvalidStateError') {
    return signingIn
      ? t('There is no passkey for LIFTWITHOG on this device. Create a profile first, or sign in on the device that made one.')
      : t('This device already has a passkey for LIFTWITHOG. Sign in with it instead.')
  }

  // Passkeys are bound to an exact hostname, so this is what a wrong RP_ID or a
  // preview deployment looks like from the outside.
  if (name === 'SecurityError') {
    return t('Passkeys are tied to one web address, and this one does not match. Open the app from its usual link.')
  }

  if (/network|fetch|failed to fetch/i.test(raw)) {
    return t('Could not reach the server. Check your connection and try again.')
  }

  /*
   * A message the server wrote is meant for a person and can be shown. A
   * message the browser wrote is not, and is the reason this file exists — so
   * anything carrying a DOMException name is replaced rather than passed on.
   *
   * `new Error(...)` reports its name as 'Error', not as an empty string, which
   * is what a plain throw from our own code looks like. Every WebAuthn failure
   * arrives as a DOMException with a specific name, and the ones worth
   * explaining are handled above.
   */
  if (raw && (name === '' || name === 'Error')) return raw

  return signingIn ? t('Sign-in failed') : t('Registration failed')
}
