import { describe, it, expect } from 'vitest'

import { passkeyMessage, wasCancelled } from './passkeyError.js'

/**
 * What a person is told when a passkey does not work.
 *
 * Three call sites passed `e.message` to a toast, so the browser's own wording
 * reached the screen. Tapping "Sign in with passkey" on a desktop Chrome showed:
 *
 *   Resident credentials or empty 'allowCredentials' lists are not supported
 *   at this time.
 *
 * It is the top button on the welcome screen, so that sentence is a plausible
 * first impression of the whole product.
 */

const domError = (name, message = '') => Object.assign(new Error(message), { name })

describe('passkey failures, said in words', () => {
  it('never shows the browser sentence that shipped', () => {
    const message = passkeyMessage(
      domError('NotSupportedError', "Resident credentials or empty 'allowCredentials' lists are not supported at this time."),
    )

    expect(message).not.toMatch(/allowCredentials|Resident credentials/)
    expect(message).toMatch(/fingerprint, face or PIN/i)
    // The part that keeps somebody in the product rather than stuck on it.
    expect(message).toMatch(/without an account/i)
  })

  it('tells someone with no passkey here what to do instead', () => {
    expect(passkeyMessage(domError('InvalidStateError'), { signingIn: true })).toMatch(/Create a profile first/i)
  })

  it('tells someone who already has one to sign in rather than register', () => {
    expect(passkeyMessage(domError('InvalidStateError'), { signingIn: false })).toMatch(/already has a passkey/i)
  })

  it('names the hostname binding, which is what a wrong origin looks like', () => {
    expect(passkeyMessage(domError('SecurityError'))).toMatch(/tied to one web address/i)
  })

  it('separates a dropped connection from a refused passkey', () => {
    expect(passkeyMessage(new Error('Failed to fetch'))).toMatch(/connection/i)
  })

  it('passes a message the server wrote through, since that one is for a person', () => {
    expect(passkeyMessage(new Error('That invite code has already been used.'))).toBe(
      'That invite code has already been used.',
    )
  })

  it('falls back to the plain line rather than an unfamiliar browser one', () => {
    const message = passkeyMessage(domError('WeirdNewError', 'CTAP2_ERR_0x31 pin_auth invalid'))

    expect(message).toBe('Sign-in failed')
    expect(message).not.toMatch(/CTAP2/)
  })

  it('treats a closed prompt as a dismissal, not a failure to report', () => {
    /*
     * Somebody who changes their mind and dismisses the system prompt has not
     * hit an error, and toasting at them would say otherwise.
     */
    expect(wasCancelled(domError('NotAllowedError'))).toBe(true)
    expect(wasCancelled(domError('AbortError'))).toBe(true)
    expect(wasCancelled(domError('NotSupportedError'))).toBe(false)
  })
})
