import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defineConfig } from 'vite'
import { buildHash, shellFrom, STATIC_SHELL } from './src/lib/swShell.js'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

/**
 * Tell the service worker what the app shell is, and what build it belongs to.
 *
 * The worker shipped with an empty install step and a cache name hardcoded to
 * `workout-rt-v1`. Two consequences: install then lose signal before visiting
 * anything and the app would not open at all, since only already-fetched URLs
 * were ever cached; and every deploy for the life of the app reused one cache
 * name, so there was no moment at which last week's files were dropped.
 *
 * The shell is read back out of the emitted index.html rather than from
 * rollup's bundle graph, because that file is the definition of what the
 * browser loads to start the app — and it cannot drift from it.
 *
 * Language packs (6.8 MB across a dozen locales) and the lazy route chunks are
 * deliberately left out: they are cached on first use instead. Precaching them
 * would spend most of an installer's data on files that particular person will
 * never open.
 */
function serviceWorkerShell() {
  return {
    name: 'sw-shell',
    apply: 'build',
    closeBundle() {
      const out = path.resolve(__dirname, 'dist')
      const swPath = path.join(out, 'sw.js')

      let html, sw
      try {
        html = readFileSync(path.join(out, 'index.html'), 'utf8')
        sw = readFileSync(swPath, 'utf8')
      } catch {
        return   // no service worker in this build target
      }

      const shell = shellFrom(html)
      const build = buildHash(shell, text => createHash('sha256').update(text).digest('hex'))

      /*
       * An empty asset list means the scan stopped matching what Vite emits.
       * Writing the file anyway would ship a worker that silently precaches
       * nothing, so fail the build instead — a broken offline mode that nobody
       * finds out about is worse than a build that stops.
       */
      if (shell.length <= STATIC_SHELL.length) {
        this.error('sw-shell: found no assets in index.html — the service worker would precache nothing')
      }

      writeFileSync(swPath, sw
        .replace("'__BUILD__'", JSON.stringify(build))
        .replace('[/*__SHELL__*/]', JSON.stringify(shell)))

      this.info?.(`service worker: ${shell.length} shell files, build ${build}`)
    },
  }
}

const backend = process.env.API_TARGET || 'http://127.0.0.1:3000'
const media = process.env.MEDIA_TARGET || 'http://127.0.0.1:8888'

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['crypto', 'stream', 'util', 'buffer', 'process'],
      globals: { Buffer: true, global: true, process: true },
    }),
    serviceWorkerShell(),
  ],
  base: './',
  resolve: {
    alias: {
      // The polyfill plugin maps `stream` to stream-browserify, which has no
      // `/promises` subpath — and the 0G compute SDK imports that specifier
      // from its file-reading paths. Unaliased, the app does not build at all.
      'stream/promises': fileURLToPath(
        new URL('./src/shims/stream-promises.js', import.meta.url),
      ),
    },
  },
  server: {
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/img': { target: media, changeOrigin: true },
      '/gif': { target: media, changeOrigin: true }
    }
  },
  build: { chunkSizeWarningLimit: 1500 }
})
