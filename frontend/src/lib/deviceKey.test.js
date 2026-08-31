import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ethers } from 'ethers'
import {
  MINT_TYPES,
  adoptPhrase,
  coachDomain,
  deadlineFromNow,
  deviceAddressIfAny,
  deviceSigner,
  storedPhrase,
} from './deviceKey.js'

/**
 * The key that means nobody has to install a wallet.
 *
 * Everything here is about the two ways this fails invisibly: a device that
 * quietly changes identity between sessions, losing the coach it owns; and a
 * signature built against the wrong domain, which does not error — it recovers
 * to a different address and the contract rejects it as a forgery, with no
 * clue on either side.
 */

function memoryStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

describe('the device key', () => {
  it('is created once and then stays the same', async () => {
    /*
     * The failure that would matter most. A device whose address changes
     * between sessions loses the coach it owns — the coach is still on chain,
     * owned by an address nobody can sign for any more.
     */
    const first = await deviceSigner()
    const second = await deviceSigner()

    expect(second.address).toBe(first.address)
    expect(second.phrase).toBe(first.phrase)
    expect(storedPhrase()).toBe(first.phrase)
  })

  it('produces a real address, from a real phrase', async () => {
    const { address, phrase } = await deviceSigner()

    expect(ethers.isAddress(address)).toBe(true)
    expect(phrase.split(' ')).toHaveLength(12)
    expect(ethers.Mnemonic.isValidMnemonic(phrase)).toBe(true)
  })

  it('opens the same account in any wallet', async () => {
    // The point of using BIP-39 on the standard path. What somebody is given
    // has to be worth something outside this app, or "you own it" is our word.
    const { address, phrase } = await deviceSigner()
    expect(ethers.HDNodeWallet.fromPhrase(phrase).address).toBe(address)
  })

  it('says so when it could not be saved', async () => {
    // Private windows and blocked site data. The key works this session and the
    // app must not promise permanence it cannot deliver.
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked')
      },
    })

    const { persisted, address } = await deviceSigner()
    expect(persisted).toBe(false)
    expect(ethers.isAddress(address)).toBe(true)
  })

  it('reports no address before one exists', async () => {
    expect(await deviceAddressIfAny()).toBeNull()

    const { address } = await deviceSigner()
    expect(await deviceAddressIfAny()).toBe(address)
  })
})

describe('restoring onto another device', () => {
  it('adopts a valid phrase and lands on the same address', async () => {
    const original = await deviceSigner()

    vi.stubGlobal('localStorage', memoryStorage())
    const restored = await adoptPhrase(original.phrase)

    expect(restored.address).toBe(original.address)
  })

  it('is not fussy about spacing or case', async () => {
    const original = await deviceSigner()
    vi.stubGlobal('localStorage', memoryStorage())

    const messy = `  ${original.phrase.toUpperCase().split(' ').join('   ')}  `
    expect((await adoptPhrase(messy)).address).toBe(original.address)
  })

  it('refuses nonsense rather than storing it', async () => {
    /*
     * Storing an invalid phrase fails much later, as a signature nobody can
     * explain, on a device somebody has already trusted with their history.
     */
    await expect(adoptPhrase('not actually a mnemonic at all')).rejects.toThrow(/not valid/i)
    expect(storedPhrase()).toBeNull()
  })
})

describe('what gets signed', () => {
  const CONTRACT = '0xE6CAcDcf1D370E64041Ac9e42D0550A78014259A'

  it('recovers to the device address, which is what the contract checks', async () => {
    /*
     * The whole relayed scheme in one assertion: the contract recovers a signer
     * from this signature and refuses it unless it equals the named owner.
     */
    const { signer, address } = await deviceSigner()

    const value = {
      owner: address,
      configHash: ethers.keccak256(ethers.toUtf8Bytes('profile')),
      configURIHash: ethers.keccak256(ethers.toUtf8Bytes('og://storage/root/x')),
      nonce: 0n,
      deadline: deadlineFromNow(1_700_000_000_000),
    }

    const signature = await signer.signTypedData(coachDomain(CONTRACT), MINT_TYPES, value)
    const recovered = ethers.verifyTypedData(coachDomain(CONTRACT), MINT_TYPES, value, signature)

    expect(recovered).toBe(address)
  })

  it('a signature for one contract does not work against another', async () => {
    // The domain binds a signature to the deployment. Without that, a signature
    // gathered by a copy of this app would be valid against the real one.
    const { signer, address } = await deviceSigner()

    const value = {
      owner: address,
      configHash: ethers.ZeroHash.replace(/0$/, '1'),
      configURIHash: ethers.ZeroHash.replace(/0$/, '2'),
      nonce: 0n,
      deadline: deadlineFromNow(1_700_000_000_000),
    }

    const signature = await signer.signTypedData(coachDomain(CONTRACT), MINT_TYPES, value)
    const elsewhere = ethers.verifyTypedData(
      coachDomain('0x1111111111111111111111111111111111111111'),
      MINT_TYPES,
      value,
      signature,
    )

    expect(elsewhere).not.toBe(address)
  })

  it('the domain matches what the contract was deployed with', () => {
    /*
     * Pinned, because a mismatch here is silent: the signature recovers to a
     * different address and the contract calls it a forgery, with nothing on
     * either side saying why. These strings are `EIP712("OG_FITNESS Coach", "1")`
     * in CoachAgent.sol.
     */
    const domain = coachDomain(CONTRACT)

    expect(domain.name).toBe('OG_FITNESS Coach')
    expect(domain.version).toBe('1')
    expect(domain.chainId).toBe(16602)
    expect(domain.verifyingContract).toBe(CONTRACT)
  })

  it('a deadline is a near future in seconds, not milliseconds', async () => {
    // Milliseconds here would be a signature valid until the year 55,000.
    const now = 1_700_000_000_000
    const deadline = deadlineFromNow(now)

    expect(deadline).toBeGreaterThan(BigInt(Math.floor(now / 1000)))
    expect(deadline).toBeLessThan(BigInt(Math.floor(now / 1000) + 3600))
  })
})

describe('the chain the signature is for', () => {
  it('is the chain the app reads and writes on', async () => {
    /*
     * These were two separate literals: 16602 in the signing domain and 16602
     * in the network config. Agreeing today is not the same as being one fact.
     * Moving the app to another chain and missing one of them produces
     * signatures for a chain nobody is on — which fails as a revert deep in a
     * relayed transaction, not as anything a person could act on.
     */
    const { OG_NETWORK } = await import('./ogVault.js')
    expect(coachDomain('0xE6CAcDcf1D370E64041Ac9e42D0550A78014259A').chainId).toBe(OG_NETWORK.chainId)
  })
})
