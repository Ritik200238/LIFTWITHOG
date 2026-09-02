/**
 * Open and top up the 0G Compute ledger the coach pays inference from.
 *
 * Why this is a script you run rather than something the server does: it moves
 * funds out of the wallet whose key pays for everything, and that is a decision
 * with a number attached. Nothing in the app should make it quietly.
 *
 * Without this account, every question fails — correctly. `processResponse`
 * settles the fee and returns the enclave's verdict in the same call, so an
 * unfunded ledger means no provider will vouch for an answer, and the coach
 * refuses rather than serving an unattested one. That is the design working;
 * it just looks like a broken feature until the account exists.
 *
 *   node scripts/fund-compute.mjs            # show the account, change nothing
 *   node scripts/fund-compute.mjs 0.1        # open it, or top it up, with 0.1 0G
 *
 * Reads COACH_SERVICE_KEY from server/.env — the same key the server uses, so
 * the account this opens is the one it will spend from.
 */

import { ethers } from 'ethers';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Both the config and the SDK come from server/, because that is where the key
 * lives and where the dependency is installed. Resolving from here rather than
 * from the working directory means this runs the same from the repo root or
 * from inside scripts/.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, '..', 'server', 'index.js'));

require('dotenv').config({ path: path.join(HERE, '..', 'server', '.env') });
const { createZGComputeNetworkBroker } = require('@0gfoundation/0g-compute-ts-sdk');

const RPC = process.env.OG_RPC_URL || 'https://evmrpc-testnet.0g.ai';
const key = process.env.COACH_SERVICE_KEY;

if (!key) {
  console.error('No COACH_SERVICE_KEY. Run this from the repo root with server/.env in place.');
  process.exit(1);
}

const amount = process.argv[2] ? Number(process.argv[2]) : null;

if (amount !== null && !(amount > 0)) {
  console.error(`"${process.argv[2]}" is not an amount of 0G to add.`);
  process.exit(1);
}

const wallet = new ethers.Wallet(key, new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true }));
const balance = await wallet.provider.getBalance(wallet.address);

console.log('wallet      ', wallet.address);
console.log('0G balance  ', ethers.formatEther(balance));

const broker = await createZGComputeNetworkBroker(wallet);
const show = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? ethers.formatEther(x) : x));

let existing = null;
try {
  existing = await broker.ledger.getLedger();
  console.log('ledger      ', show(existing));
} catch {
  console.log('ledger       none yet');
}

if (amount === null) {
  console.log('\nPass an amount in 0G to change this, e.g. `node scripts/fund-compute.mjs 0.1`.');
  process.exit(0);
}

/*
 * 0G will not open a ledger for less than this. Checked here rather than
 * discovered from the SDK, which throws an unhandled error with a stack trace:
 *
 *   Error: Minimum balance to create a ledger is 3 0G, but got 0.1 0G.
 *
 * Accurate, and not a sentence that tells you the wallet needs topping up
 * first. Adding to a ledger that already exists has no such floor; only
 * opening one does.
 */
const MIN_TO_OPEN = 3;

if (!existing && amount < MIN_TO_OPEN) {
  console.error(`\n0G will not open a ledger for less than ${MIN_TO_OPEN} 0G, and you asked for ${amount}.`);
  console.error(`Run: node scripts/fund-compute.mjs ${MIN_TO_OPEN}`);
  process.exit(1);
}

if (balance < ethers.parseEther(String(amount))) {
  const short = Number(ethers.formatEther(balance));
  console.error(`\nThe wallet holds ${short.toFixed(3)} 0G and needs ${amount}.`);
  console.error(`\nSend at least ${(amount - short).toFixed(2)} more testnet 0G to:`);
  console.error(`  ${wallet.address}`);
  console.error(`\nThen run this again. The faucet at https://faucet.0g.ai gives 0.1 0G`);
  console.error(`per request, so opening a ledger from empty takes many requests —`);
  console.error(`asking in the 0G Discord for a larger testnet drip is faster.`);
  process.exit(1);
}

console.log(`\n${existing ? 'Adding' : 'Opening the ledger with'} ${amount} 0G…`);
await (existing ? broker.ledger.depositFund(amount) : broker.ledger.addLedger(amount));

console.log('done —', show(await broker.ledger.getLedger()));
console.log('\nAsk the coach a question. It should answer now.');
