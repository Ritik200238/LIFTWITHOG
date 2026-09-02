/**
 * The coach, on 0G Chain.
 *
 * A workout app that keeps everything locally cannot make the coach worth
 * anything outside itself. Reinstall and it is gone; switch apps and it never
 * existed; tell somebody it has trained with you for two years and there is
 * nothing behind the sentence.
 *
 * This gives it somewhere to exist. The encrypted profile lives on 0G Storage,
 * its hash and version live on 0G Chain, and both are held against an address
 * rather than a browser database. That is what makes it ownable — and what
 * makes it rentable, which is the part with a business behind it.
 *
 * On confidentiality, plainly: the chain enforces *who may use* a coach and
 * until when, and that is not bypassable. Whether a renter can read the method
 * itself depends on where decryption happens. Inside a 0G Compute TEE they see
 * output and never the method; decrypted in their own browser, there is nothing
 * protecting it. The rental path must run the first way.
 */

import { ethers } from 'ethers'
import { OG_NETWORK } from './ogVault.js'
/*
 * The one implementation of the seal, shared with the server that opens it.
 * Imported from `server/` on purpose — see the header of that file: a second
 * copy living here is exactly how the device and the server came to disagree.
 */
import { sealForService } from '../../../server/coachEnvelope.js'
import { buildCoachProfile, canonicalise, hasLearned } from './coachProfile.js'
import { memoryEntry, memoryForPrompt, rememberVersion } from './coachMemory.js'
import { EXIDX } from './exercises.js'
import {
  EVOLVE_TYPES,
  MINT_TYPES,
  PRICE_TYPES,
  coachDomain,
  deadlineFromNow,
  deviceSigner,
} from './deviceKey.js'

/** Deployed CoachAgent. Set at build time; see contracts/script/Deploy.s.sol. */
export { COACH_ADDRESS } from './coachConfig.js'
import { COACH_ADDRESS } from './coachConfig.js'

/** Only what this app calls. A narrower ABI is a smaller thing to get wrong. */
export const COACH_ABI = [
  'function mint(bytes32 configHash, string configURI) returns (uint256)',
  'function mintFor(address owner, bytes32 configHash, string configURI, uint256 deadline, bytes signature) returns (uint256)',
  'function evolveFor(address owner, uint256 tokenId, bytes32 configHash, string configURI, uint256 deadline, bytes signature)',
  'function rent(uint256 tokenId, uint256 dayCount) payable',
  'function setRentalPrice(uint256 tokenId, uint256 pricePerDay)',
  'function setRentalPriceFor(address owner, uint256 tokenId, uint256 pricePerDay, uint256 deadline, bytes signature)',
  'function rentalPrice(uint256 tokenId) view returns (uint256)',
  'function nonceOf(address signer) view returns (uint256)',
  'function evolve(uint256 tokenId, bytes32 configHash, string configURI)',
  'function grantAccess(uint256 tokenId, address user, uint64 expiresAt)',
  'function revokeAccess(uint256 tokenId, address user)',
  'function hasAccess(uint256 tokenId, address user) view returns (bool)',
  'function accessExpiry(uint256 tokenId, address user) view returns (uint64)',
  'function coachOf(uint256 tokenId) view returns (bytes32, string, uint64, uint64)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function totalMinted() view returns (uint256)',
  // Read by /verify, which asks the deployed bytecode what it implements rather
  // than telling the reader. The control id has to be asked through this too.
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  // Also /verify: which contract guards transfers, according to the contract
  // doing the guarding rather than according to us.
  'function transferVerifier() view returns (address)',
  'event CoachMinted(uint256 indexed tokenId, address indexed owner, bytes32 configHash)',
]

export class CoachNotConfigured extends Error {
  constructor() {
    super('No coach contract address is configured. Set VITE_COACH_ADDRESS.')
    this.name = 'CoachNotConfigured'
  }
}

export function coachContract(runner) {
  if (!COACH_ADDRESS) throw new CoachNotConfigured()
  return new ethers.Contract(COACH_ADDRESS, COACH_ABI, runner)
}

/**
 * Encrypt a profile here, have the server put it on 0G Storage.
 *
 * The device key holds no funds and writing to 0G Storage costs gas, so the
 * upload has to be paid for by somebody. It leaves here already encrypted with
 * a key that never leaves this device, so what the server carries it cannot
 * read: we pay the fee, the device keeps the secret.
 *
 * The hash covers the ciphertext, so it answers "is this the blob that was
 * written" — the question that matters when something comes back years later
 * from a network nobody here controls.
 */
/**
 * What gets encrypted and stored: the profile, and what the coach remembers.
 *
 * They travel together on purpose. The hash on chain covers this whole record,
 * so a version's memory is as fixed as its numbers — and the server hands the
 * same object to the model, which is what makes advice at version 12 aware of
 * what versions 1 to 11 noticed.
 */
async function publishProfileRelayed(profile, signer, memory) {
  /*
   * Two shapes of the same thing, for two readers.
   *
   * `memory` is the record: every version, structured, what the app renders
   * and what the chain's hash covers. `memoryDigest` is the newest handful as
   * prose, and it exists because the model reads this config as text — forty
   * versions of JSON is kilobytes of punctuation competing with the question
   * somebody actually asked.
   */
  const record = memory?.length
    ? { ...profile, memory, memoryDigest: memoryForPrompt(memory) }
    : profile

  /*
   * Sealed for the service, not for this device.
   *
   * The coach has to be answerable, and answering means running the profile
   * through a model inside a TEE on the server — so a blob only this browser
   * could open would be a blob no coach could ever use. That was the bug: the
   * device sealed with its own key, the server tried its own, and every coach
   * a real person made replied "This coach cannot be opened by this server."
   *
   * The device still decides. It mints the content key here and wraps it for
   * the key it fetched from `/api/coach/pubkey`; the storage network and anyone
   * reading by root hash get ciphertext. What is given up is honest and worth
   * stating: this server can read the profile it is asked to reason over.
   */
  const ciphertext = await sealForService(record, await servicePublicKey())
  const configHash = ethers.keccak256(ciphertext)

  // Base64 rather than raw bytes: this rides a JSON body, and a byte array in
  // JSON is three times the size for no gain.
  let binary = ''
  for (const byte of ciphertext) binary += String.fromCharCode(byte)
  const encoded = btoa(binary)

  const { rootHash } = await post('/api/coach/store', { ciphertext: encoded })
  if (!rootHash) throw new Error('0G Storage returned nothing to point at.')

  return { configHash, configURI: rootHash }
}

/**
 * Create this person's coach, with no wallet anywhere in sight.
 *
 * The device signs; the server pays the fee; the coach belongs to the device's
 * address. Nobody installs an extension, nobody funds anything, and nobody is
 * asked to understand what any of that means.
 *
 * @returns {{tokenId: string, version: number, profile: object, address: string}}
 */
export async function mintCoachRelayed(state, opts = {}) {
  const now = opts.now ?? Date.now()
  const profile = buildCoachProfile(state, { now })
  const { signer, address } = await deviceSigner()

  // A coach's first memory: what it knew the day it was made.
  const memory = rememberVersion([], memoryEntry({ version: 1, at: now, before: null, after: profile, nameOf: liftName }))

  const { configHash, configURI } = await publishProfileRelayed(profile, signer, memory)

  const deadline = deadlineFromNow(opts.now ?? Date.now())
  const nonce = await currentNonce(address)

  const signature = await signer.signTypedData(coachDomain(COACH_ADDRESS), MINT_TYPES, {
    owner: address,
    configHash,
    configURIHash: ethers.keccak256(ethers.toUtf8Bytes(configURI)),
    nonce,
    deadline,
  })

  const result = await post('/api/coach/mint', {
    owner: address,
    configHash,
    configURI,
    deadline: deadline.toString(),
    signature,
  })

  /*
   * A mint with no id is a failure, and it used to be returned as a success.
   *
   * The direct-wallet path this replaced read the id out of the receipt and
   * threw when it could not — this one took whatever the relayer said and
   * handed `undefined` onward, which the store then saved as the coach's id.
   * The result is a device that believes it owns a coach it can never name:
   * every later evolve, listing and question addresses `undefined`, and the
   * real token — which was minted, and paid for — belongs to somebody who
   * cannot reach it.
   */
  const tokenId = result?.tokenId
  if (tokenId === undefined || tokenId === null || String(tokenId) === '') {
    throw new Error('The coach was created but the relayer did not say which one. Nothing was saved.')
  }

  return { tokenId: String(tokenId), version: 1, profile, memory, address }
}

/** Readable lift names for the memory. Falls back to the id for a custom lift. */
const liftName = (id) => EXIDX[id]?.n ?? String(id)

/**
 * List a coach for rent, or take it off, from a device holding no gas.
 *
 * A price of zero delists. Same relayed shape as mint and evolve: the device
 * signs, the app pays the fee, and the signature names the owner — so the
 * relayer can spend on a trainer's behalf and can never price a coach that is
 * not theirs.
 */
export async function setRentalPriceRelayed(tokenId, pricePerDayWei, opts = {}) {
  const { signer, address } = await deviceSigner()

  const deadline = deadlineFromNow(opts.now ?? Date.now())
  const nonce = await currentNonce(address)
  const price = BigInt(pricePerDayWei)

  const signature = await signer.signTypedData(coachDomain(COACH_ADDRESS), PRICE_TYPES, {
    owner: address,
    tokenId,
    pricePerDay: price,
    nonce,
    deadline,
  })

  await post('/api/coach/price', {
    owner: address,
    tokenId: String(tokenId),
    pricePerDay: price.toString(),
    deadline: deadline.toString(),
    signature,
  })

  return { tokenId, pricePerDay: price }
}

/**
 * Record what the coach learned — the flywheel, in the background.
 *
 * Does nothing when nothing was learned. Every version is a fee somebody pays,
 * and a version recording no change also empties the version count of the only
 * meaning it has.
 */
export async function evolveCoachRelayed(tokenId, state, previousProfile, opts = {}) {
  const now = opts.now ?? Date.now()
  const profile = buildCoachProfile(state, { now })
  if (!hasLearned(previousProfile, profile)) return { evolved: false, profile }

  const { signer, address } = await deviceSigner()

  /*
   * Written before the transaction rather than after: the memory describes the
   * change this version records, so it has to be inside the payload the hash
   * covers. Recorded afterwards it would be a caption on the chain, not part
   * of it.
   */
  const version = Number(opts.version ?? 0) + 1
  const memory = rememberVersion(
    opts.memory,
    memoryEntry({ version, at: now, before: previousProfile, after: profile, nameOf: liftName }),
  )

  const { configHash, configURI } = await publishProfileRelayed(profile, signer, memory)

  const deadline = deadlineFromNow(opts.now ?? Date.now())
  const nonce = await currentNonce(address)

  const signature = await signer.signTypedData(coachDomain(COACH_ADDRESS), EVOLVE_TYPES, {
    owner: address,
    tokenId,
    configHash,
    configURIHash: ethers.keccak256(ethers.toUtf8Bytes(configURI)),
    nonce,
    deadline,
  })

  await post('/api/coach/evolve', {
    owner: address,
    tokenId: String(tokenId),
    configHash,
    configURI,
    deadline: deadline.toString(),
    signature,
  })

  return { evolved: true, profile, memory }
}

/**
 * The nonce the contract expects next from this address.
 *
 * Read from the chain rather than counted locally: a signature built on a stale
 * nonce is rejected as a forgery, and the same device used from two tabs would
 * produce exactly that.
 */
async function currentNonce(address) {
  /*
   * Loaded here rather than imported at the top: `marketplace.js` imports this
   * module, so a static import back the other way is a cycle — and the read
   * provider is only needed on the paths that are about to talk to a chain.
   */
  const { readProvider } = await import('./marketplace.js')
  return coachContract(readProvider()).nonceOf(address)
}

/**
 * What to say when the coach service is not answering.
 *
 * "That could not be submitted (502)" is what somebody saw every time they
 * tapped "Create my coach" while the backend was not running — which, on a
 * fresh clone, is the normal state. A status code is not a sentence, and a
 * person reading it has no idea whether they did something wrong, whether the
 * app is broken, or whether to try again.
 *
 * This is the single reason the headline feature of this app looked dead to
 * the person using it, so the message now names the cause and the fix.
 */
function explain(status, payload) {
  if (payload?.message) return payload.message

  // No server at all, or one that is up but has no route: the dev backend is
  // not running. By far the most common cause, and entirely fixable.
  if (status === 502 || status === 503 || status === 504 || status === 404) {
    return 'The coach service is not running. Start the API (npm start in api/) and try again.'
  }

  if (status === 401 || status === 403) {
    return 'This device is not allowed to do that yet.'
  }

  if (status === 429) {
    return 'That is a lot of requests in a short time. Give it a minute.'
  }

  return `The coach service refused that (${status}).`
}

async function post(path, body) {
  let response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    /*
     * fetch throws rather than returning a status when there is nothing
     * listening at all — which used to surface as a raw "Failed to fetch".
     */
    throw new Error('The coach service is not reachable. Start the API (npm start in api/) and try again.')
  }

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(explain(response.status, payload))
  return payload
}

/**
 * The key a coach is sealed to, fetched once per page load.
 *
 * Cached in a module variable because every mint and every evolve needs it and
 * it cannot change underneath a running tab; not cached in storage, because a
 * rotated service key must not be pinned on a device for as long as the browser
 * keeps its data. The promise itself is cached, so two evolves firing together
 * make one request — and a failed fetch clears it so the next attempt retries
 * rather than replaying the rejection forever.
 */
let servicePublicKeyPromise = null

/** Drop the cached key. Exists for the tests, which need a cold start each time. */
export function __resetServiceKeyCache() {
  servicePublicKeyPromise = null
}

export async function servicePublicKey() {
  if (!servicePublicKeyPromise) {
    servicePublicKeyPromise = (async () => {
      const response = await fetch('/api/coach/pubkey').catch(() => null)
      if (!response?.ok) {
        throw new Error(
          'The coach service is not reachable, so there is no key to seal this coach to. Start the API (npm start in api/) and try again.',
        )
      }
      const { publicKey } = await response.json().catch(() => ({}))
      if (!publicKey) throw new Error('The coach service did not return a key to seal to.')
      return publicKey
    })().catch((e) => {
      servicePublicKeyPromise = null
      throw e
    })
  }
  return servicePublicKeyPromise
}

/** What the chain says about a coach right now. */
export async function readCoach(runner, tokenId) {
  const [configHash, configURI, version, updatedAt] = await coachContract(runner).coachOf(tokenId)
  return {
    configHash,
    configURI,
    version: Number(version),
    updatedAt: Number(updatedAt) * 1000,
  }
}

/** A local fingerprint of a profile, for deciding whether to evolve. */
export function fingerprint(profile) {
  return ethers.keccak256(ethers.toUtf8Bytes(canonicalise(profile)))
}
