import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { COACH_ABI } from './ogCoach.js'

/**
 * The ABI must name every function the app calls through it.
 *
 * The server has had this test since `setRentalPriceFor` was missing from the
 * relayer's ABI and every listing 502'd in production while all 66 tests passed
 * — they passed because each one injects a fake contract, and a fake answers to
 * anything. The frontend's ABI had no such test, and the same thing happened
 * again the moment /verify started calling `supportsInterface` and
 * `transferVerifier`: both absent, both silent until a real chain refused.
 *
 * ethers throws `contract.x is not a function` for a missing entry, so the
 * failure is a blank screen on the one page whose job is proving things.
 */

/** Every file that builds a contract from COACH_ABI and calls methods on it. */
const CALLERS = [
  'src/lib/ogCoach.js',
  'src/lib/marketplace.js',
  'src/views/Verify.jsx',
  'src/views/Proof.jsx',
  'src/views/Market.jsx',
  'src/store/useCoach.js',
]

const declares = (name) => COACH_ABI.some((entry) => entry.includes(`function ${name}(`))

/*
 * Names reached on an ethers Contract that are not contract functions. Kept
 * short and explicit: a long allowlist here would let a genuinely missing entry
 * hide behind a plausible-looking name.
 */
const NOT_CONTRACT_METHODS = new Set([
  'interface',
  'filters',
  'queryFilter',
  'getAddress',
  'connect',
  'on',
  'off',
  'target',
  'runner',
])

describe('the coach ABI', () => {
  it('declares every function the app calls on the contract', () => {
    const missing = []
    let found = 0

    for (const file of CALLERS) {
      const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')

      // `contract.foo(`, and the `coach.foo(` / `c.foo(` shorthands the views use.
      for (const [, name] of source.matchAll(/\b(?:contract|coach|c)\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) {
        if (NOT_CONTRACT_METHODS.has(name)) continue
        found += 1
        if (!declares(name)) missing.push(`${file} calls .${name}()`)
      }
    }

    expect(found, 'found no contract calls at all — the pattern must have drifted').toBeGreaterThan(0)
    expect(missing).toEqual([])
  })

  it('covers the reads the proof page depends on', () => {
    /*
     * Named individually as well as swept, because /verify is the page a
     * sceptical reader opens first: if these two are missing it renders an
     * empty card, which is worse than no page at all.
     */
    expect(declares('supportsInterface')).toBe(true)
    expect(declares('transferVerifier')).toBe(true)
    expect(declares('totalMinted')).toBe(true)
  })
})
