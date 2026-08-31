import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { STATIC_SHELL, buildHash, shellFrom } from './swShell.js'

const sha = text => createHash('sha256').update(text).digest('hex')

/**
 * What the app precaches for offline.
 *
 * Everything here fails silently in production: a shell that comes out empty
 * does not throw, it just leaves the worker with nothing to install, and the
 * app works perfectly until the moment somebody loses signal.
 */

// A trimmed copy of what Vite actually emitted, quoting and all.
const INDEX_HTML = `<!doctype html><html><head>
<script type="module" crossorigin src="./assets/index-C2LLBnis.js"></script>
<link rel="modulepreload" crossorigin href="./assets/rolldown-runtime-BgaNhQyE.js">
<link rel="modulepreload" crossorigin href="./assets/i18n-DitmmRiS.js">
<link rel="stylesheet" crossorigin href="./assets/index-BFlCRPUJ.css">
<link rel="manifest" href="./manifest.json">
</head><body><div id="root"></div></body></html>`

describe('working out the app shell', () => {
  it('finds the entry script, its preloads and the stylesheet', () => {
    const shell = shellFrom(INDEX_HTML)

    expect(shell).toContain('assets/index-C2LLBnis.js')
    expect(shell).toContain('assets/rolldown-runtime-BgaNhQyE.js')
    expect(shell).toContain('assets/i18n-DitmmRiS.js')
    expect(shell).toContain('assets/index-BFlCRPUJ.css')
  })

  it('always includes the files the document does not link to', () => {
    // index.html is the offline fallback for every navigation, and the icons
    // and manifest are what an installed app opens with. None appear as an
    // `assets/` reference, so none would be found by scanning alone.
    expect(shellFrom(INDEX_HTML).slice(0, 4)).toEqual(STATIC_SHELL)
  })

  it('takes assets whether the path is relative, rooted or bare', () => {
    // `base` decides which of these Vite writes, and a shell that only handles
    // one of them breaks offline for the other two builds.
    const html = `<script src="./assets/a.js"></script><script src="/assets/b.js"></script><script src="assets/c.js"></script>`

    expect(shellFrom(html)).toEqual([...STATIC_SHELL, 'assets/a.js', 'assets/b.js', 'assets/c.js'])
  })

  it('lists an asset once even when the document references it twice', () => {
    // A duplicate would be fetched twice by cache.addAll, and one failed entry
    // rejects the whole precache.
    const html = `<script src="./assets/a.js"></script><link href="./assets/a.js">`

    expect(shellFrom(html).filter(f => f === 'assets/a.js')).toHaveLength(1)
  })

  it('leaves out the images and the language packs', () => {
    /*
     * The exercise media is 1,300 files and the translations are 6.8 MB across
     * a dozen locales. Neither is referenced by index.html — they are fetched
     * on demand — and precaching them would spend an install's data on files
     * that particular person will never open.
     */
    const html = `<script src="./assets/index-a.js"></script><img src="img/0001-x.jpg">`

    expect(shellFrom(html)).not.toContain('img/0001-x.jpg')
  })

  it('comes back empty-handed rather than inventing a shell', () => {
    // The build fails on this, which is the point: a worker that precaches
    // nothing must not ship quietly.
    expect(shellFrom('<html><body>nothing here</body></html>')).toEqual(STATIC_SHELL)
    expect(shellFrom('')).toEqual(STATIC_SHELL)
    expect(shellFrom(null)).toEqual(STATIC_SHELL)
  })
})

describe('naming the build', () => {
  it('changes when any asset changes', () => {
    // Otherwise a deploy serves yesterday's files out of a cache that still
    // answers to today's name.
    const before = buildHash(shellFrom(INDEX_HTML), sha)
    const after = buildHash(shellFrom(INDEX_HTML.replace('index-C2LLBnis', 'index-ZZZZZZZZ')), sha)

    expect(after).not.toBe(before)
  })

  it('stays the same when nothing changed', () => {
    // A rebuild of unchanged code must not evict a cache that is already
    // correct and make every user download the app again.
    expect(buildHash(shellFrom(INDEX_HTML), sha)).toBe(buildHash(shellFrom(INDEX_HTML), sha))
  })

  it('is short enough to read in a cache name', () => {
    expect(buildHash(shellFrom(INDEX_HTML), sha)).toHaveLength(12)
  })

  it('distinguishes a reordering, since load order is part of the build', () => {
    const swapped = ['index.html', 'assets/b.js', 'assets/a.js']
    const straight = ['index.html', 'assets/a.js', 'assets/b.js']

    expect(buildHash(swapped, sha)).not.toBe(buildHash(straight, sha))
  })
})
