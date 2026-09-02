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
/**
 * Encrypt here, store on 0G, and let the server do the talking.
 *
 * The bytes are sealed on this device with a key derived from the device
 * signature, so what leaves is ciphertext and the server cannot read it — the
 * same division as a coach's method.
 *
 * The relay is not a preference. Uploading from the page failed two ways at
 * once, and neither is configurable:
 *
 *   1. The 0G indexer answers with storage nodes at `http://34.x.x.x:5678`.
 *      A page on HTTPS may not call plain HTTP, so the browser blocked the
 *      upload as mixed content before a byte moved. Every backup on the live
 *      site failed with "Network Error", and the console said why.
 *   2. Storage costs a fee and the signer was the device key, which by design
 *      holds nothing. Over HTTP it would still have failed, for gas.
 *
 * So the SDK stays out of the bundle here and the server, which has neither
 * problem, does the upload.
 */
export async function uploadTo0GVault(state, signer) {
  const key = await getDerivedKey(signer)
  const encrypted = await encryptState(state, key)

  const res = await fetch('/api/vault/store', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ciphertext: toBase64(encrypted) }),
  })

  const out = await res.json().catch(() => ({}))

  /*
   * A failed upload has to fail.
   *
   * This once logged the error as a "notice", carried on, and invented a root
   * hash out of `getRandomValues` when the indexer returned none — telling the
   * person their history was backed up when nothing had been stored. A backup
   * that lies about succeeding is worse than no backup, because it is the
   * reason somebody stops keeping the other copy.
   */
  if (!res.ok) {
    throw new Error(out.message || `0G Storage upload failed (${res.status}).`)
  }

  if (!out.rootHash) {
    throw new Error('0G Storage returned no root hash, so nothing can be restored from this.')
  }

  return { success: true, rootHash: out.rootHash, timestamp: Date.now(), network: OG_NETWORK.name }
}

/**
 * The backup back, decrypted here and nowhere else.
 *
 * The server fetches the ciphertext — see `uploadTo0GVault` for why it has to —
 * and the key that opens it never left this device.
 */
export async function downloadFrom0GVault(rootHash, signer) {
  const res = await fetch('/api/vault/read', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rootHash }),
  })

  const out = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new Error(out.message || '0G Storage has nothing stored under that code.')
  }

  const bytes = fromBase64(String(out.ciphertext || ''))
  if (!bytes.length) throw new Error('0G Storage returned an empty backup.')

  const key = await getDerivedKey(signer)

  /*
   * Decryption failing is the honest answer to "this backup is not yours",
   * because a root hash is public and anybody may ask for any of them. Said
   * plainly rather than as a generic failure.
   */
  try {
    return await decryptState(bytes, key)
  } catch {
    throw new Error('That backup was made by a different device, so this one cannot open it.')
  }
}

/** base64 without a data URL round-trip, for bytes that can be megabytes. */
function toBase64(bytes) {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(s)
}

function fromBase64(text) {
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
