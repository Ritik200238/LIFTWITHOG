#!/usr/bin/env node
/**
 * Put a few coaches on the marketplace so it is not empty on the first day.
 *
 * An empty marketplace is a dead feature: nobody lists into a room with nobody
 * in it, and nobody browses a room with nothing in it. These are built from
 * training methods that are public and well understood — not somebody's secret
 * — and priced low, so they are a demonstration of what a trainer's coach looks
 * like rather than a competitor to one.
 *
 *   COACH_ADDRESS=0x... RELAYER_PRIVATE_KEY=0x... node scripts/seed-coaches.mjs
 *
 * Run once. Running it twice mints duplicates rather than updating, because a
 * script that silently rewrites somebody's coach is worse than one that makes a
 * mess you can see.
 */

import { ethers } from 'ethers'
import { sealForService, servicePublicKeyFrom } from '../server/coachEnvelope.js'

const RPC = process.env.OG_RPC_URL || 'https://evmrpc-testnet.0g.ai'
const CHAIN_ID = 16602
const INDEXER = process.env.OG_INDEXER_URL || 'https://indexer-storage-testnet-turbo.0g.ai'
const COACH = process.env.COACH_ADDRESS
// Pays the gas. May differ from the key a coach is sealed to.
const KEY = process.env.RELAYER_PRIVATE_KEY || process.env.COACH_SERVICE_KEY
// Opens the coach. This is the one the server holds, so it is the one sealed to.
const SERVICE_KEY = process.env.COACH_SERVICE_KEY || process.env.RELAYER_PRIVATE_KEY
const GAS = { gasPrice: 5_000_000_000n }

if (!COACH || !KEY) {
  console.error('Set COACH_ADDRESS and RELAYER_PRIVATE_KEY.')
  process.exit(1)
}

const ABI = [
  'function mint(bytes32 configHash,string configURI) returns (uint256)',
  'function setRentalPrice(uint256 tokenId,uint256 pricePerDay)',
  'event CoachMinted(uint256 indexed tokenId,address indexed owner,bytes32 configHash)',
]

/**
 * The house coaches.
 *
 * Each `method` is what the model is given when somebody asks this coach a
 * question. They are deliberately public programmes: a trainer's own method is
 * theirs to sell, and seeding the market with a copy of one would be the worst
 * possible start.
 */
const COACHES = [
  {
    name: 'Push Pull Legs',
    pricePerDay: '0.0002',
    method: [
      'You coach a six-day Push/Pull/Legs split.',
      'Push: chest, shoulders, triceps. Pull: back, biceps, rear delts. Legs: quads, hamstrings, calves.',
      'Compound lifts first, 3-4 working sets of 5-8 reps. Accessories after, 3 sets of 8-12.',
      'Add 2.5kg to upper-body lifts and 5kg to lower-body lifts once every rep of every set is met.',
      'If a lift stalls for three sessions, cut the weight by 10% and build back.',
      'Volume is the driver. Prioritise total hard sets per muscle per week over any single heavy day.',
    ].join('\n'),
  },
  {
    name: 'Strength 5x5',
    pricePerDay: '0.0002',
    method: [
      'You coach a linear 5x5 strength programme built on squat, bench, row, overhead press and deadlift.',
      'Five sets of five on the main lift, except deadlift which is one set of five.',
      'Add 2.5kg every session while every rep is completed. Deadlift adds 5kg.',
      'Three failed sessions on a lift means deload that lift by 10% and work back up.',
      'Recovery limits progress before effort does — insist on sleep and eating before adding volume.',
      'Form over load, every time. A missed rep at a lighter weight beats a rounded back.',
    ].join('\n'),
  },
  {
    name: 'Beginner',
    pricePerDay: '0.0001',
    method: [
      'You coach somebody in their first six months of lifting.',
      'Three full-body sessions a week, never on consecutive days.',
      'Squat, bench, row, overhead press, deadlift. Two to three sets of 5-8 reps.',
      'Add the smallest possible increment every session for as long as it keeps working.',
      'Explain the why in one sentence. Never assume gym vocabulary is understood.',
      'Consistency beats intensity at this stage. Praise showing up, not weight moved.',
    ].join('\n'),
  },
]

/**
 * Seal with the one implementation the server opens with.
 *
 * A rentable coach is sealed to the service key rather than to a person, so the
 * enclave can open it for whoever is authorised.
 *
 * This used to be a hand-rolled copy of `encryptConfig`, keyed on
 * `RELAYER_PRIVATE_KEY || COACH_SERVICE_KEY` while the server keyed on
 * `COACH_SERVICE_KEY` alone. Where a deployment sets those to different values —
 * which render.yaml does — every coach seeded here was unreadable by the server
 * that had to answer for it, and nothing said so until somebody asked one a
 * question. Importing the real thing removes the copy that could disagree.
 */
function sealForTheService(plaintext) {
  return sealForService(plaintext, servicePublicKeyFrom(SERVICE_KEY))
}

const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true })
const wallet = new ethers.Wallet(KEY, provider)
const contract = new ethers.Contract(COACH, ABI, wallet)

const { Indexer, MemData } = await import('@0gfoundation/0g-storage-ts-sdk')
const indexer = new Indexer(INDEXER)

console.log(`Seeding ${COACHES.length} coaches from ${wallet.address}\n`)

for (const coach of COACHES) {
  process.stdout.write(`${coach.name}… `)

  const ciphertext = await sealForTheService(coach.method)
  const [uploaded, uploadErr] = await indexer.upload(
    new MemData(new Uint8Array(ciphertext)),
    RPC,
    wallet,
    { taskSize: 10, expectedReplica: 1, finalityRequired: true, tags: '0x', skipTx: false, fee: 0n },
  )

  if (uploadErr || !uploaded?.rootHash) {
    // Never anchor a hash for a blob that was not stored: it produces a coach
    // that validates on chain and can never be loaded by anybody.
    console.log(`FAILED to store: ${uploadErr?.message || 'no root hash'}`)
    continue
  }

  const tx = await contract.mint(ethers.keccak256(ciphertext), uploaded.rootHash, GAS)
  const receipt = await tx.wait()

  let tokenId = null
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log)
      if (parsed?.name === 'CoachMinted') tokenId = parsed.args.tokenId
    } catch {
      /* another contract's log */
    }
  }

  if (tokenId === null) {
    console.log('minted, but the id could not be read')
    continue
  }

  await (
    await contract.setRentalPrice(tokenId, ethers.parseEther(coach.pricePerDay), GAS)
  ).wait()

  console.log(`#${tokenId} at ${coach.pricePerDay} 0G/day`)
}

console.log('\nDone.')
process.exit(0)
