import { describe, it, expect, vi, afterEach } from 'vitest'
import { ethers } from 'ethers'

import { uploadTo0GVault, downloadFrom0GVault } from './ogVault.js'

/**
 * Backing a training history up to 0G Storage, and getting it back.
 *
 * This ran from the page and could not have worked on the live site, for two
 * reasons that no configuration reaches:
 *
 *   1. The 0G indexer answers with storage nodes at `http://34.x.x.x:5678`, and
 *      a page on HTTPS may not call plain HTTP. The browser blocked the upload
 *      as mixed content before a byte moved. Every backup on liftwithog.vercel
 *      .app failed with "Network Error"; the console named the exact URL.
 *   2. The storage fee was paid by the device key, which by design holds
 *      nothing. Over HTTP it would still have failed, for gas.
 *
 * Neither is visible from a unit test that stubs the SDK, which is why the old
 * tests passed. So these assert the property that actually matters now: the
 * bytes leaving this device are ciphertext, the server is the one that talks to
 * 0G, and a backup made by another device does not silently open.
 */

const SIGNER = ethers.Wallet.createRandom()
const STATE = { workouts: [{ id: 'w1', volume: 4200 }], weight: [{ kg: 70 }] }

afterEach(() => vi.unstubAllGlobals())

/** A server that stores what it is given and hands the same bytes back. */
function fakeServer() {
  const stored = new Map()
  let lastBody = null

  const fetchMock = vi.fn(async (url, init) => {
    const body = JSON.parse(init.body)
    lastBody = body

    if (String(url).endsWith('/api/vault/store')) {
      const root = '0x' + 'ab'.repeat(32)
      stored.set(root, body.ciphertext)
      return { ok: true, status: 200, json: async () => ({ rootHash: root }) }
    }

    const ciphertext = stored.get(body.rootHash)
    if (!ciphertext) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ message: '0G Storage does not have anything under that code.' }),
      }
    }
    return { ok: true, status: 200, json: async () => ({ ciphertext }) }
  })

  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, stored, body: () => lastBody }
}

describe('the 0G Storage vault', () => {
  it('backs up and restores the same history', async () => {
    fakeServer()

    const { success, rootHash } = await uploadTo0GVault(STATE, SIGNER)
    expect(success).toBe(true)
    expect(rootHash).toMatch(/^0x[0-9a-f]{64}$/)

    expect(await downloadFrom0GVault(rootHash, SIGNER)).toEqual(STATE)
  })

  it('sends ciphertext, never the training history', async () => {
    /*
     * The load-bearing one. The server pays the fee and does the talking, and
     * the whole product rests on it not being able to read what it stores.
     */
    const server = fakeServer()
    await uploadTo0GVault(STATE, SIGNER)

    const sent = server.body().ciphertext
    expect(typeof sent).toBe('string')
    expect(sent).not.toContain('workouts')
    expect(atob(sent)).not.toContain('4200')
  })

  it('does not talk to a storage node itself', async () => {
    // The mixed-content failure, asserted as an absence: every request this
    // makes goes to our own origin, never to an http:// node the indexer named.
    const server = fakeServer()
    await uploadTo0GVault(STATE, SIGNER)

    for (const [url] of server.fetchMock.mock.calls) {
      expect(String(url)).toMatch(/^\/api\//)
    }
  })

  it('refuses a backup another device made, rather than returning nonsense', async () => {
    fakeServer()
    const { rootHash } = await uploadTo0GVault(STATE, SIGNER)

    await expect(downloadFrom0GVault(rootHash, ethers.Wallet.createRandom())).rejects.toThrow(
      /different device/i,
    )
  })

  it('fails loudly when 0G has nothing under that code', async () => {
    /*
     * This once invented a root hash out of getRandomValues and reported
     * success, so somebody could be told their history was safe when nothing
     * had been stored.
     */
    fakeServer()
    await expect(downloadFrom0GVault('0x' + '11'.repeat(32), SIGNER)).rejects.toThrow(
      /does not have anything under that code/i,
    )
  })

  it('reports an upload failure instead of returning a hash that points nowhere', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ message: 'The relayer wallet has no funds.' }),
      })),
    )

    await expect(uploadTo0GVault(STATE, SIGNER)).rejects.toThrow(/no funds/i)
  })

  it('rejects a success response that carries no root hash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })))

    await expect(uploadTo0GVault(STATE, SIGNER)).rejects.toThrow(/no root hash/i)
  })
})
