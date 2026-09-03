import { describe, it, expect, vi, afterEach } from 'vitest'

import { resolveTheme } from './theme.js'

/**
 * Which theme the app actually paints.
 *
 * The setting was a hard binary and the app ignored the one preference the
 * person had already expressed: somebody whose phone goes dark at sunset opened
 * this at 6am to a white screen and had to go and find a switch for a thing
 * their device had known about for years.
 *
 * "auto" is now the default, so the resolution below runs for almost everybody
 * and is worth pinning: an explicit choice always wins, and anything else means
 * ask the system.
 */

const systemSays = (dark) =>
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: dark, addEventListener() {}, removeEventListener() {} })))

afterEach(() => vi.unstubAllGlobals())

describe('resolving the theme', () => {
  it('an explicit choice wins over the system', () => {
    systemSays(true)
    expect(resolveTheme('light')).toBe('light')

    systemSays(false)
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('auto follows the system, both ways', () => {
    systemSays(true)
    expect(resolveTheme('auto')).toBe('dark')

    systemSays(false)
    expect(resolveTheme('auto')).toBe('light')
  })

  it('anything unrecognised is treated as auto, not as dark', () => {
    /*
     * Stored settings outlive the code that wrote them. A value this version
     * does not know — an older build's, or a corrupted one — must fall through
     * to the system rather than to a fixed guess, which is how somebody ends up
     * with a white screen their phone did not ask for.
     */
    systemSays(true)
    for (const v of [undefined, null, '', 'system', 'Dark', 42]) {
      expect(resolveTheme(v)).toBe('dark')
    }
  })

  it('works where matchMedia does not exist', () => {
    // Older webviews, and the Capacitor shell on some Android versions.
    vi.stubGlobal('matchMedia', undefined)
    expect(resolveTheme('auto')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
  })
})
