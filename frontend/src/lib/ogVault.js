import { Indexer, MemData } from '@0gfoundation/0g-storage-ts-sdk'
import { ethers } from 'ethers'

// Declared in its own dependency-free module so that reading the chain id does
// not pull this file — and the storage SDK with it — into a bundle.
export { OG_NETWORK } from './ogNetwork.js'
import { OG_NETWORK } from './ogNetwork.js'

/**
 * Derives a deterministic AES key from a wallet signature for client-side encryption.
 */
async function getDerivedKey(signer) {
  const address = await signer.getAddress()
  const message = `0G-Gym Encryption Key for Vault Address: ${address.toLowerCase()}`
  const signature = await signer.signMessage(message)
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signature),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('0g-gym-salt-2026'),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * Encrypts client state JSON with user's derived key before storage
 */
/**
 * Encrypt any JSON under the wallet-derived key.
 *
 * Exported so the coach can use the same scheme rather than growing a second
 * one. Two encryption paths in one app is how a backup ends up written with a
 * key the restore does not know about.
 */
export async function encryptJson(data, signer) {
  return encryptState(data, await getDerivedKey(signer))
}

async function encryptState(state, key) {
  const jsonStr = JSON.stringify(state)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(jsonStr)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)

  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), iv.length)
  return combined
}

/**
 * Open a vault blob with the wallet that sealed it.
 *
 * Exported because a backup nobody has ever restored is a claim, not a
 * feature. The upload needs a funded wallet and a live network; this half —
 * the half that decides whether the data comes back at all, and whether
 * anybody else can read it — needs neither, so there is no excuse for it
 * being untested.
 */
export async function decryptJson(bytes, signer) {
  return decryptState(bytes, await getDerivedKey(signer))
}

/**
 * Decrypts state buffer using derived key
 */
async function decryptState(encryptedData, key) {
  const iv = encryptedData.slice(0, 12)
  const ciphertext = encryptedData.slice(12)
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return JSON.parse(new TextDecoder().decode(decrypted))
}

/**
 * Uploads user state to 0G Decentralized Storage Vault
 */
export async function uploadTo0GVault(state, signer) {
  try {
    const key = await getDerivedKey(signer)
    const encryptedData = await encryptState(state, key)

    /*
     * `MemData`, not a browser Blob.
     *
     * The indexer calls `file.size()`, `file.numChunks()` and
     * `file.numSegments()` on whatever it is handed. A browser Blob has `size`
     * as a property, so passing one threw `size is not a function` before a
     * single byte left the machine — which means this backup had never once
     * worked, on any build, for anybody. `MemData` is the SDK's wrapper for
     * bytes already in memory and implements that interface.
     */
    const payload = new MemData(encryptedData)

    const indexer = new Indexer(OG_NETWORK.storageIndexer)
    
    // Upload options for 0G Storage Indexer
    const uploadOptions = {
      taskSize: 10,
      expectedReplica: 1,
      finalityRequired: true,
      tags: '0x',
      skipTx: false,
      fee: BigInt(0)
    }

    const [txResult, uploadErr] = await indexer.upload(payload, OG_NETWORK.rpcUrl, signer, uploadOptions)

    /*
     * A failed upload has to fail.
     *
     * This used to log the error as a "notice", carry on, and — when the
     * indexer returned no root hash — invent one out of `getRandomValues` and
     * return `success: true`. The person was told their training history was
     * backed up. Nothing had been stored, and the hash they were given pointed
     * at nothing, so the restore would fail years later when it was the only
     * copy left.
     *
     * A backup that lies about succeeding is worse than having no backup, since
     * it is the reason somebody stops keeping the other copy.
     */
    if (uploadErr) {
      throw new Error(`0G Storage upload failed: ${uploadErr.message || uploadErr}`)
    }

    const rootHash = txResult?.rootHash
    if (!rootHash) {
      throw new Error('0G Storage returned no root hash, so nothing can be restored from this.')
    }

    return {
      success: true,
      rootHash,
      timestamp: Date.now(),
      network: OG_NETWORK.name
    }
  } catch (error) {
    console.error('[0G Vault Error]', error)
    throw new Error(error.message || 'Failed to upload state to 0G Storage')
  }
}

/**
 * Downloads and decrypts user state from 0G Storage
 */
export async function downloadFrom0GVault(rootHash, signer) {
  try {
    const indexer = new Indexer(OG_NETWORK.storageIndexer)
    const key = await getDerivedKey(signer)

    /*
     * `downloadToBlob`, not `download`.
     *
     * `download(rootHash, filePath)` writes to a path on disk and returns an
     * Error or null — it is not a tuple and there is no path in a browser. This
     * used to call it with one argument and destructure the result, so `err`
     * was always undefined and the "buffer" was too: restoring a backup could
     * never have worked, on any build, for anybody.
     */
    const [blob, err] = await indexer.downloadToBlob(rootHash)
    if (err) throw err
    if (!blob) throw new Error('0G Storage has nothing stored under that hash.')

    const state = await decryptState(new Uint8Array(await blob.arrayBuffer()), key)
    return state
  } catch (error) {
    console.error('[0G Vault Download Error]', error)
    throw new Error('Failed to retrieve or decrypt state from 0G Storage')
  }
}
