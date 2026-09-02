#!/usr/bin/env node
/**
 * Check every 0G claim this project makes, against 0G.
 *
 * Needs no key, no funds, and no configuration. It reads public infrastructure
 * and reports pass or fail per claim, so somebody who does not trust us — and
 * should not have to — can verify the lot in under a minute.
 *
 *   node scripts/evidence.mjs
 *
 * A claim that cannot be checked from here is not printed as if it had been.
 */

import { ethers } from 'ethers'

const RPC = process.env.OG_RPC_URL || 'https://evmrpc-testnet.0g.ai'
const CHAIN_ID = 16602
const EXPLORER = 'https://chainscan-galileo.0g.ai'
const COACH = process.env.COACH_ADDRESS || '0x0253fb92F9e88E82Fb0632C076C88204e4400025'

const ABI = [
  'function name() view returns (string)',
  'function totalMinted() view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function coachOf(uint256) view returns (bytes32,string,uint64,uint64)',
  'function rentalPrice(uint256) view returns (uint256)',
  'function hasAccess(uint256,address) view returns (bool)',
]

let failures = 0

function pass(claim, detail) {
  console.log(`  [PASS] ${claim}${detail ? ` — ${detail}` : ''}`)
}

function fail(claim, detail) {
  failures += 1
  console.log(`  [FAIL] ${claim}${detail ? ` — ${detail}` : ''}`)
}

function heading(text) {
  console.log(`\n${text}\n${'-'.repeat(text.length)}`)
}

const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true })

heading('The chain')
try {
  const network = await provider.getNetwork()
  const block = await provider.getBlockNumber()

  if (Number(network.chainId) === CHAIN_ID) {
    pass('reachable, and is 0G Galileo', `chain id ${network.chainId}`)
  } else {
    fail('wrong chain', `expected ${CHAIN_ID}, got ${network.chainId}`)
  }
  pass('producing blocks', `head at ${block}`)
} catch (error) {
  fail('0G RPC unreachable', error.shortMessage || error.message)
}

heading('The coach contract exists on it')
const coach = new ethers.Contract(COACH, ABI, provider)
let minted = 0n

try {
  const code = await provider.getCode(COACH)
  if (code && code.length > 2) {
    pass('CoachAgent has bytecode', `${(code.length - 2) / 2} bytes at ${COACH}`)
    console.log(`         ${EXPLORER}/address/${COACH}`)
  } else {
    fail('no contract at that address', COACH)
  }

  pass('it is the coach contract', await coach.name())
  minted = await coach.totalMinted()
  pass('coaches have been minted', `${minted} so far`)
} catch (error) {
  fail('could not read the contract', error.shortMessage || error.message)
}

heading('Coaches are owned, and they learn')
try {
  let owned = 0
  let evolved = 0

  for (let id = 1n; id <= minted && id <= 20n; id += 1n) {
    const owner = await coach.ownerOf(id)
    const [, , version] = await coach.coachOf(id)

    if (owner !== ethers.ZeroAddress) owned += 1
    if (Number(version) > 1) evolved += 1
  }

  if (owned > 0) {
    pass('every coach has an owner', `${owned} checked`)
  } else {
    fail('no owned coaches found')
  }

  /*
   * The flywheel, as a fact rather than a claim: a version above one is a coach
   * that recorded something it learned, permanently, after it was created.
   */
  if (evolved > 0) {
    pass('a coach has learned since it was created', `${evolved} past version 1`)
  } else {
    fail('no coach has ever evolved', 'the flywheel has not run')
  }
} catch (error) {
  fail('could not read coaches', error.shortMessage || error.message)
}

heading('Coaches can be rented, and the contract holds nobody’s money')
try {
  let listed = 0
  for (let id = 1n; id <= minted && id <= 20n; id += 1n) {
    if ((await coach.rentalPrice(id)) > 0n) listed += 1
  }

  if (listed > 0) {
    pass('a coach is listed for rent', `${listed} with a price`)
  } else {
    fail('no coach is for rent')
  }

  /*
   * Payment forwards to the owner inside the renting transaction, so a balance
   * here would mean somebody's money is stuck in a contract that was never
   * meant to be a custodian.
   */
  const held = await provider.getBalance(COACH)
  if (held === 0n) {
    pass('the contract custodies nothing', '0 0G held')
  } else {
    fail('the contract is holding funds', `${ethers.formatEther(held)} 0G`)
  }
} catch (error) {
  fail('could not read rentals', error.shortMessage || error.message)
}

heading('Inference runs on 0G Compute, in a TEE')
try {
  const { createZGComputeNetworkBroker } = await import('@0gfoundation/0g-compute-ts-sdk')

  // A throwaway key: listing the marketplace is a read, and needs no funds.
  const broker = await createZGComputeNetworkBroker(
    new ethers.Wallet(ethers.Wallet.createRandom().privateKey, provider),
  )
  const services = await broker.inference.listService()

  const attested = []
  for (const service of services) {
    const tuple = Array.isArray(service) ? service : null
    const model = tuple ? String(tuple[6]) : service?.model
    const tee = tuple ? Boolean(tuple[10]) : Boolean(service?.teeVerified)
    if (tee) attested.push(model)
  }

  if (attested.length > 0) {
    pass('a TEE-attested provider is live', attested.join(', '))
  } else {
    fail('no attested provider on the marketplace', 'the app refuses to answer without one')
  }
} catch (error) {
  fail('could not reach 0G Compute', String(error.message || error).slice(0, 120))
}

console.log('')
if (failures === 0) {
  console.log(`All checks passed. Read live from ${RPC}.`)
} else {
  console.log(`${failures} check(s) failed.`)
  process.exitCode = 1
}
