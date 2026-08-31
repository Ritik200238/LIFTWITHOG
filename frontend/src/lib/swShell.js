/**
 * What the service worker precaches, worked out from the built index.html.
 *
 * Kept as a pure function away from the Vite config so it can be tested: the
 * failure mode here is silent. If the scan stops matching — a different quoting
 * style in the emitted HTML, a change in how Vite writes modulepreloads — the
 * worker gets an empty shell list, decides it is not a real build, and simply
 * stops precaching. Nothing errors, the site still works online, and offline
 * quietly dies. A test is the only thing that notices.
 */

/** `src="./assets/x.js"`, `href="assets/y.css"` — the app's own entry graph. */
const ASSET = /(?:src|href)="\.?\/?(assets\/[^"]+)"/g

/** Files that are always part of the shell, whatever the build emits. */
export const STATIC_SHELL = ['index.html', 'manifest.json', 'icon-180.png', 'icon-512.png']

/**
 * The shell for a built index.html: the static files plus every asset the
 * document itself loads, in document order, without duplicates.
 *
 * Language packs and lazily-imported route chunks are not referenced by
 * index.html, so they fall out of this naturally — which is the intent. There
 * are 6.8 MB of translations across a dozen locales, and precaching all of them
 * would spend most of an install's data on files that person will never open.
 */
export function shellFrom(html) {
  const assets = [...String(html ?? '').matchAll(ASSET)].map(m => m[1])
  return [...STATIC_SHELL, ...new Set(assets)]
}

/**
 * A name for this build's cache.
 *
 * Derived from the shell's own filenames, which already carry content hashes,
 * so it changes exactly when the app does. Rebuilding unchanged code keeps the
 * name — and therefore the cache — rather than evicting something already
 * correct and making every user download the app again.
 */
export function buildHash(shell, hashHex) {
  return hashHex(shell.join('|')).slice(0, 12)
}
