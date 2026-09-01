/**
 * The key this device signs with, which nobody is ever asked to install.
 *
 * A coach is owned by an address. Demanding a browser extension and a funded
 * wallet before somebody can have one ends the conversation for all but a
 * handful of people — and this app is for people who lift, not people who hold
 * coins.
 *
 * So the app generates a key here, on the device, once. It signs; a relayer
 * pays the fee; the coach belongs to this address and to nothing else. The
 * person never learns the word "wallet" unless they go looking.
 *
 * The phrase is real BIP-39 on the standard path, so the same twelve words open
 * the same account in any wallet. That matters: what somebody is given has to be
 * worth something outside this app, or "you own it" is only our word again.
 *
 * ethers is loaded on demand. It is a large dependency and the gym half of this
 * app has no use for it — making everybody download it to open a workout
 * tracker would be the wrong trade.
 */

import { OG_NETWORK } from './ogNetwork.js'
import { readScoped, writeScoped } from './profileScope.js'

const PHRASE_KEY = 'og_device_phrase_v1'

let ethersModule = null

async function ethers() {
  ethersModule ??= await import('ethers')
  return ethersModule
}

/**
 * Read the phrase this profile already has, or null.
 *
 * Scoped per profile. Stored globally, it meant the next person to sign in on
 * this browser signed as the previous one.
 */
export function storedPhrase() {
  return readScoped(PHRASE_KEY)
}

function rememberPhrase(phrase) {
  try {
    if (!writeScoped(PHRASE_KEY, phrase)) throw new Error('storage refused')
    return true
  } catch {
    /*
     * Storage refused. The key still works for this session, and the caller is
     * told so it can avoid promising permanence it cannot deliver.
     */
    return false
  }
}

/**
 * The signer for this device, creating one the first time.
 *
 * @returns {{signer: object, address: string, phrase: string, persisted: boolean}}
 */
export async function deviceSigner() {
  const e = await ethers()

  const existing = storedPhrase()
  if (existing) {
    const wallet = e.HDNodeWallet.fromPhrase(existing)
    return { signer: wallet, address: wallet.address, phrase: existing, persisted: true }
  }

  /*
   * The platform CSPRNG directly rather than the library's wrapper.
   *
   * Same randomness in a browser, and unambiguously a Uint8Array from this
   * realm — the wrapper can return a Buffer from another realm, which
   * `fromEntropy` rejects outright, and the failure reads like a broken device
   * rather than a type mismatch.
   */
  const entropy = new Uint8Array(16)
  crypto.getRandomValues(entropy)

  const mnemonic = e.Mnemonic.fromEntropy(entropy)
  const wallet = e.HDNodeWallet.fromPhrase(mnemonic.phrase)
  const persisted = rememberPhrase(mnemonic.phrase)

  return { signer: wallet, address: wallet.address, phrase: mnemonic.phrase, persisted }
}

/** This device's address without creating one, or null if it has none yet. */
export async function deviceAddressIfAny() {
  const phrase = storedPhrase()
  if (!phrase) return null

  const e = await ethers()
  return e.HDNodeWallet.fromPhrase(phrase).address
}

/**
 * Adopt a phrase from elsewhere — restoring onto a new device.
 *
 * Refuses anything that is not a valid mnemonic rather than storing it and
 * failing later with a signature nobody can explain.
 */
export async function adoptPhrase(input) {
  const e = await ethers()
  const normalised = input.trim().toLowerCase().split(/\s+/).join(' ')

  if (!e.Mnemonic.isValidMnemonic(normalised)) {
    throw new Error('That recovery phrase is not valid. It should be twelve words, as given.')
  }

  rememberPhrase(normalised)
  const wallet = e.HDNodeWallet.fromPhrase(normalised)
  return { address: wallet.address, phrase: normalised }
}

/** Fifteen minutes. Long enough for a slow relayer, short enough to matter. */
export const SIGNATURE_TTL_SECONDS = 15 * 60

/**
 * The EIP-712 domain the contract verifies against.
 *
 * Every field has to match `EIP712("LIFTWITHOG Coach", "1")` and the deployed
 * address exactly. A mismatch does not fail loudly — it produces a signature
 * that recovers to a different address, which the contract rejects as a
 * forgery, and the cause is invisible from either side.
 */
export function coachDomain(contractAddress, chainId = OG_NETWORK.chainId) {
  return {
    // Must match the deployed contract's EIP-712 domain exactly. The v2
    // contract was born "LIFTWITHOG Coach"; this string and COACH_ADDRESS
    // always change in the same commit, so they cannot disagree.
    name: 'LIFTWITHOG Coach',
    version: '1',
    chainId,
    verifyingContract: contractAddress,
  }
}

export const MINT_TYPES = {
  MintCoach: [
    { name: 'owner', type: 'address' },
    { name: 'configHash', type: 'bytes32' },
    { name: 'configURIHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}

export const EVOLVE_TYPES = {
  EvolveCoach: [
    { name: 'owner', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'configHash', type: 'bytes32' },
    { name: 'configURIHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}

/**
 * Listing a coach for rent, signed by the device that owns it.
 *
 * The action a trainer needs to earn, made possible without a wallet: the
 * owner of a phone-minted coach has never held gas, so `setRentalPrice` —
 * owner-only and on-chain — was unreachable to exactly the person it exists
 * for.
 */
export const PRICE_TYPES = {
  SetRentalPrice: [
    { name: 'owner', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'pricePerDay', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}

/** A deadline for a signature about to be handed to a relayer. */
export function deadlineFromNow(now = Date.now()) {
  return BigInt(Math.floor(now / 1000) + SIGNATURE_TTL_SECONDS)
}
