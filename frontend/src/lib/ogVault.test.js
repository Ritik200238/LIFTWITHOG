import { describe, it, expect } from 'vitest'
import { ethers } from 'ethers'
import { decryptJson, encryptJson } from './ogVault.js'

/**
 * Whether a backup can actually be restored.
 *
 * The app tells people their history is backed up to 0G Storage under a key
 * that never leaves their device. Nobody had ever restored one. A backup that
 * has not been opened is not a backup — it is a claim, and the moment it
 * matters is the moment somebody has already lost the original.
 *
 * The upload itself needs a funded wallet and a live network. This is the half
 * that decides whether the data comes back and whether anyone else can read
 * it, and it needs neither.
 */

const wallet = (seed) => new ethers.Wallet('0x' + String(seed).repeat(64).slice(0, 64))

const state = {
  unit: 'kg',
  workouts: [{ id: 'w1', d: '2026-08-01', entries: [{ id: 'squat', sets: [{ w: 100, r: 5, done: true }] }] }],
  bodyweight: [{ d: '2026-08-01', w: 80, t: 1 }],
  nutrition: { ageYears: 30, heightCm: 180, goal: 'lose' },
}

describe('a backup and the wallet that made it', () => {
  it('comes back exactly as it went in', async () => {
    const me = wallet(1)
    const restored = await decryptJson(await encryptJson(state, me), me)

    expect(restored).toEqual(state)
  })

  it('survives a round trip of the things people actually lose', async () => {
    // Not a toy object: the workout log, the weigh-ins and the profile are the
    // three things somebody would be devastated to find missing.
    const me = wallet(2)
    const restored = await decryptJson(await encryptJson(state, me), me)

    expect(restored.workouts[0].entries[0].sets[0].w).toBe(100)
    expect(restored.bodyweight[0].w).toBe(80)
    expect(restored.nutrition.goal).toBe('lose')
  })

  it('can be restored on a different device with the same key', async () => {
    /*
     * The actual promise. "Your history, under a key that never leaves your
     * device" is only worth anything if the same key, on a new phone, opens
     * the same blob — so this seals with one instance and opens with another.
     */
    const phone = wallet(3)
    const newPhone = new ethers.Wallet(phone.privateKey)

    const restored = await decryptJson(await encryptJson(state, phone), newPhone)
    expect(restored).toEqual(state)
  })
})

describe('somebody else’s backup', () => {
  it('cannot be opened', async () => {
    // The other half of the promise, and the one that matters if the storage
    // network is public — which 0G Storage is.
    const mine = await encryptJson(state, wallet(4))

    await expect(decryptJson(mine, wallet(5))).rejects.toThrow()
  })

  it('cannot be opened after a single byte is altered', async () => {
    // AES-GCM authenticates as well as encrypts, so a tampered blob must fail
    // rather than decrypt to something plausible.
    const me = wallet(6)
    const sealed = await encryptJson(state, me)
    sealed[sealed.length - 1] ^= 0xff

    await expect(decryptJson(sealed, me)).rejects.toThrow()
  })
})

describe('the sealed blob itself', () => {
  it('carries a fresh initialisation vector every time', async () => {
    /*
     * Reusing an IV with AES-GCM leaks the relationship between two backups
     * and, with the same key, is a genuine break rather than an untidiness.
     */
    const me = wallet(7)
    const a = await encryptJson(state, me)
    const b = await encryptJson(state, me)

    expect(a.slice(0, 12)).not.toEqual(b.slice(0, 12))
    expect(a).not.toEqual(b)
  })

  it('does not contain the training in the clear', async () => {
    const sealed = await encryptJson(state, wallet(8))
    const asText = new TextDecoder().decode(sealed)

    expect(asText).not.toContain('squat')
    expect(asText).not.toContain('bodyweight')
  })
})

describe('backups made by an older build', () => {
  it('still open', async () => {
    /*
     * The guarantee a round-trip test cannot give.
     *
     * Encrypting and decrypting in the same run passes no matter how the key
     * is derived, because both halves change together. Change the salt, the
     * signed message or the iteration count and every backup anybody already
     * holds becomes unreadable — silently, and only discovered by the person
     * who has already lost the original.
     *
     * This blob was sealed by the scheme as it shipped. If it stops opening,
     * the change that did it is not shippable without a migration.
     */
    const sealed = Uint8Array.from(atob('I41kZYYHCU8jX8yxoj9mq+B/4G19yXyYOxuWHgCOR0SmVa8PddzwHoZusF/XQAHs63TuoW6+qVzFupnCvHmkFRUWMC+DS20tf+VDVkY9P3NekhPD8NLH+xW0BgnoCHX5yaq073iEC1AIagrmwAOuJHTniFGyF/itrf4f8A=='), (c) => c.charCodeAt(0))
    const owner = new ethers.Wallet('0x' + '1'.repeat(64))

    const restored = await decryptJson(sealed, owner)

    expect(restored.unit).toBe('kg')
    expect(restored.workouts[0].id).toBe('w1')
    expect(restored.bodyweight[0].w).toBe(80)
  })
})
