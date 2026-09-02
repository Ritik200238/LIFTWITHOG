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

if (balance < ethers.parseEther(String(amount))) {
  console.error(`\nThe wallet holds ${ethers.formatEther(balance)} 0G, which is less than ${amount}.`);
  console.error(`Send testnet 0G to ${wallet.address} first — https://faucet.0g.ai`);
  process.exit(1);
}

console.log(`\n${existing ? 'Adding' : 'Opening the ledger with'} ${amount} 0G…`);
await (existing ? broker.ledger.depositFund(amount) : broker.ledger.addLedger(amount));

console.log('done —', show(await broker.ledger.getLedger()));
console.log('\nAsk the coach a question. It should answer now.');
