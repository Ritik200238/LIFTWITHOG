#!/usr/bin/env node
/**
 * Everything that has to happen on 0G mainnet, in order, once.
 *
 *   node --env-file=server/.env scripts/go-mainnet.mjs
 *
 * The whole point is that mainnet day is not the day anybody improvises.
 * Each step below has already run against Galileo — the same contract, the
 * same registration script, the same checks — so this is a rehearsed sequence
 * rather than a first attempt with real money.
 *
 * It refuses before spending rather than failing halfway: the balance is
 * checked first, and every step that has already been done is skipped instead
 * of repeated. Run it twice and the second run should do nothing but confirm.
 *
 * What it does NOT do is change what the live app points at. Deploying a
 * contract is reversible in the sense that nobody is using it yet; repointing
 * the app is what makes it real, so that stays a deliberate act with the
 * addresses in hand.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MAINNET = {
  chainId: 16661,
  rpc: 'https://evmrpc.0g.ai',
  explorer: 'https://chainscan.0g.ai',
};

/**
 * What the sequence needs, measured rather than guessed.
 *
 * A deploy is ~2.5M gas and a registration ~250k; at the 3 gwei floor that is
 * well under a tenth of a token. Asking for 1 0G leaves room for the rental
 * round-trip and for gas to be dearer than it was when this was measured.
 */
const NEEDED = ethers.parseEther('1');

const key = process.env.RELAYER_PRIVATE_KEY || process.env.COACH_SERVICE_KEY;
if (!key) {
  console.error('Set RELAYER_PRIVATE_KEY — try: node --env-file=server/.env scripts/go-mainnet.mjs');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(MAINNET.rpc, MAINNET.chainId, { staticNetwork: true });
const wallet = new ethers.Wallet(key, provider);
const balance = await provider.getBalance(wallet.address);

console.log('0G Mainnet (Aristotle) — going live\n');
console.log(`  wallet   ${wallet.address}`);
console.log(`  balance  ${ethers.formatEther(balance)} 0G`);

if (balance < NEEDED) {
  console.error(`\nNot enough to run the sequence — it needs about ${ethers.formatEther(NEEDED)} 0G.`);
  console.error('  Buy 0G on an exchange and withdraw to the address above,');
  console.error('  making sure the withdrawal network is 0G Mainnet (chain 16661).');
  process.exit(1);
}

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...opts });

/* ---------------------------------------------------------- 1. the contract */

console.log('\n[1/3] Deploying CoachAgent…');

const deployed = execFileSync(
  'forge',
  [
    'script', 'script/Deploy.s.sol:Deploy',
    '--rpc-url', MAINNET.rpc,
    '--broadcast',
    '--with-gas-price', '3gwei',
    '--priority-gas-price', '2gwei',
  ],
  { cwd: path.join(root, 'contracts'), encoding: 'utf8', env: { ...process.env, PRIVATE_KEY: key }, shell: process.platform === 'win32' },
);

const address = /CoachAgent deployed at: (0x[0-9a-fA-F]{40})/.exec(deployed)?.[1];
if (!address) {
  console.error('Deployed, but the address could not be read from the output.');
  process.exit(1);
}
console.log(`      ${address}`);

/* ------------------------------------------------- 2. prove it, before trusting it */

console.log('\n[2/3] Asking the deployed bytecode what it is…');

const coach = new ethers.Contract(
  address,
  ['function name() view returns (string)', 'function supportsInterface(bytes4) view returns (bool)'],
  provider,
);

const checks = {
  name: await coach.name(),
  'ERC-721': await coach.supportsInterface('0x80ac58cd'),
  'IERC7857': await coach.supportsInterface('0x4b396f04'),
  'IERC7857Authorize': await coach.supportsInterface('0x35d39512'),
};

for (const [what, value] of Object.entries(checks)) console.log(`      ${what}: ${value}`);

if (!checks['IERC7857'] || !checks['IERC7857Authorize'] || !checks['ERC-721']) {
  console.error('\nThe deployed contract does not answer for the interfaces it should. Stopping.');
  process.exit(1);
}

/* ------------------------------------------------------ 3. make it discoverable */

console.log('\n[3/3] Registering as an ERC-8004 Trustless Agent…');
run(process.execPath, ['scripts/register-agent.mjs', '--mainnet']);

/* ------------------------------------------------------------------ what next */

const record = JSON.parse(fs.readFileSync(path.join(root, 'agents.json'), 'utf8'));

console.log('\n──────────────────────────────────────────────');
console.log('Mainnet is live. Two addresses to put everywhere:\n');
console.log(`  CoachAgent      ${address}`);
console.log(`  ERC-8004 agent  #${record.mainnet?.agentId ?? '?'}`);
console.log(`  explorer        ${MAINNET.explorer}/address/${address}\n`);
console.log('Then, deliberately rather than automatically:');
console.log('  1. Point the app at it:');
console.log(`       vercel env add VITE_COACH_ADDRESS production   → ${address}`);
console.log(`       vercel env add COACH_ADDRESS production        → ${address}`);
console.log('       vercel env add VITE_OG_NETWORK production      → mainnet');
console.log('       vercel env add OG_RPC_URL production           → https://evmrpc.0g.ai');
console.log('  2. Redeploy, then mint one coach and list it, to prove the live path.');
console.log('  3. Update README.md and VERIFICATION.md with both addresses.');
