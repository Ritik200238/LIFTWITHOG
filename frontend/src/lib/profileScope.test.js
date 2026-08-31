import { describe, it, expect, beforeEach } from 'vitest'
import { clearScoped, currentProfileId, readScoped, scopedKey, writeScoped } from './profileScope.js'

/**
 * Whether one person's data can reach the next person to use this browser.
 *
 * The device key signs as you and the coach cache holds a copy of your training
 * profile — bodyweight, calorie targets, lifts. Both were stored globally while
 * the app has supported several profiles per browser all along, so signing out
 * and signing in as somebody else handed over both.
 *
 * A leak with no error and nothing on screen to notice: the app simply shows
 * the previous person's coach, and signs requests as their device.
 */

const store = new Map()

beforeEach(() => {
  store.clear()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
})

const signIn = (id) => store.set('gym_user', JSON.stringify({ id }))
const signOut = () => store.delete('gym_user')

describe('whose data is this', () => {
  it('is the signed-in profile', () => {
    signIn('alice')
    expect(currentProfileId()).toBe('alice')
  })

  it('is guest when nobody is signed in', () => {
    signOut()
    expect(currentProfileId()).toBe('guest')
  })

  it('is guest rather than a crash when the stored user is corrupt', () => {
    store.set('gym_user', '{ not json')
    expect(currentProfileId()).toBe('guest')
  })

  it('is guest when the stored user has no id', () => {
    store.set('gym_user', JSON.stringify({ name: 'no id here' }))
    expect(currentProfileId()).toBe('guest')
  })
})

describe('one browser, two people', () => {
  it('does not hand the second person the first person’s key', () => {
    /*
     * The bug, stated as the scenario. Alice creates a device key, signs out,
     * Bob signs in — and used to inherit the key that signs as Alice.
     */
    signIn('alice')
    writeScoped('og_device_phrase_v1', 'alice twelve words')

    signIn('bob')
    expect(readScoped('og_device_phrase_v1')).toBe(null)
  })

  it('does not hand the second person the first person’s coach', () => {
    // The coach cache carries bodyweight and calorie targets with it.
    signIn('alice')
    writeScoped('gym_coach_v1', JSON.stringify({ tokenId: '7', profile: { bodyweight: 82 } }))

    signIn('bob')
    expect(readScoped('gym_coach_v1')).toBe(null)
  })

  it('gives each person their own back when they return', () => {
    signIn('alice')
    writeScoped('og_device_phrase_v1', 'alice words')
    signIn('bob')
    writeScoped('og_device_phrase_v1', 'bob words')

    signIn('alice')
    expect(readScoped('og_device_phrase_v1')).toBe('alice words')
    signIn('bob')
    expect(readScoped('og_device_phrase_v1')).toBe('bob words')
  })

  it('keeps guest data out of a signed-in profile', () => {
    signOut()
    writeScoped('gym_coach_v1', 'guest coach')

    signIn('alice')
    expect(readScoped('gym_coach_v1')).toBe(null)
  })

  it('files each profile under its own key', () => {
    expect(scopedKey('og_device_phrase_v1', 'alice')).not.toBe(
      scopedKey('og_device_phrase_v1', 'bob'),
    )
  })
})

describe('people who already had a coach before this existed', () => {
  it('adopts the key that was stored before scoping', () => {
    /*
     * Without this, shipping the fix looks exactly like the bug it fixes: every
     * existing user opens the app to find their coach gone, because it is filed
     * under a name nothing reads any more. And the device key owns a coach on
     * chain, so "gone" can mean gone for good.
     */
    store.set('og_device_phrase_v1', 'the words from before')
    signIn('alice')

    expect(readScoped('og_device_phrase_v1')).toBe('the words from before')
    expect(store.get(scopedKey('og_device_phrase_v1', 'alice'))).toBe('the words from before')
  })

  it('removes the old copy once adopted, so nobody else inherits it', () => {
    // The adoption must not leave the leak in place for the next profile.
    store.set('og_device_phrase_v1', 'the words from before')
    signIn('alice')
    readScoped('og_device_phrase_v1')

    expect(store.has('og_device_phrase_v1')).toBe(false)

    signIn('bob')
    expect(readScoped('og_device_phrase_v1')).toBe(null)
  })

  it('prefers what this profile already has over the old copy', () => {
    signIn('alice')
    writeScoped('og_device_phrase_v1', 'alice current')
    store.set('og_device_phrase_v1', 'stale global')

    expect(readScoped('og_device_phrase_v1')).toBe('alice current')
  })
})

describe('storage that refuses to work', () => {
  it('reads as empty rather than throwing', () => {
    // Private windows and browsers with site data blocked.
    globalThis.localStorage = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    }

    expect(readScoped('og_device_phrase_v1')).toBe(null)
    expect(writeScoped('og_device_phrase_v1', 'x')).toBe(false)
    expect(() => clearScoped('og_device_phrase_v1')).not.toThrow()
    expect(currentProfileId()).toBe('guest')
  })
})
