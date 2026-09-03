/**
 * Which theme the app paints, given what the person chose.
 *
 * The setting used to be a hard binary, and the app ignored the one preference
 * the person had already expressed: somebody whose phone goes dark at sunset
 * opened this at 6am to a white screen and had to go and find a switch for a
 * thing their device had known about for years.
 *
 * So "auto" is a real value and the default. An explicit choice is an override.
 *
 * It lives here rather than in the app shell because it is arithmetic over one
 * media query — no DOM, no store — and a pure function kept next to the code
 * that mounts React cannot be tested without a browser.
 */

const SYSTEM_DARK = '(prefers-color-scheme: dark)'

export function prefersDark() {
  return typeof matchMedia === 'function' && matchMedia(SYSTEM_DARK).matches
}

export function resolveTheme(theme) {
  /*
   * Only the two explicit values win. Anything else — a value an older build
   * wrote, a corrupted one, nothing at all — falls through to the system rather
   * than to a fixed guess, which is how somebody ends up with a white screen
   * their phone did not ask for.
   */
  if (theme === 'light' || theme === 'dark') return theme
  return prefersDark() ? 'dark' : 'light'
}

/** Watch the system setting, for as long as the app is following it. */
export function watchSystemTheme(onChange) {
  if (typeof matchMedia !== 'function') return () => {}

  const mq = matchMedia(SYSTEM_DARK)
  mq.addEventListener?.('change', onChange)
  return () => mq.removeEventListener?.('change', onChange)
}
