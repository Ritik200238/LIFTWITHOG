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
 * A deploy is ~4.1M gas (measured on the mainnet run) and a registration
 * ~250k; at the 6 gwei this pays that is about 0.03 0G. Asking for 1 0G leaves room for the rental
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

/*
 * Child scripts run as `node <script>` with no shell in between.
 *
 * This ran everything through the Windows shell, which splits an unquoted path
 * on spaces — and node lives in C:\Program Files. Every child call became
 * "C:\Program" and failed. Nobody saw it because the sequence had never got
 * past step 1; the first rehearsal that did stopped exactly here. Node needs no
 * shell to be found (its own path is process.execPath), so it gets none.
 */
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: cmd !== process.execPath && process.platform === 'win32', ...opts });

/* ---------------------------------------------------------- 1. the contract */

/*
 * Skipped when the recorded deployment is already live.
 *
 * The header of this file has always promised that a second run does nothing
 * but confirm. For the deploy it was not true: step 1 ran `forge script
 * --broadcast` unconditionally, so running this twice would have put a second,
 * unrelated pair of contracts on mainnet — real money, a new address, and every
 * link in every document pointing at the wrong one. Now the record decides:
 * if deployments/16661.json names a CoachAgent with code on chain, that is the
 * deployment, and replacing it takes --redeploy, typed on purpose.
 */
const recordPath = path.join(root, 'deployments', `${MAINNET.chainId}.json`);
const existing = fs.existsSync(recordPath) ? JSON.parse(fs.readFileSync(recordPath, 'utf8')) : null;
const redeploy = process.argv.includes('--redeploy');
const live = existing && (await provider.getCode(existing.contracts?.CoachAgent?.address ?? ethers.ZeroAddress)) !== '0x';

let address;
let verifierAddress;

if (live && !redeploy) {
  address = existing.contracts.CoachAgent.address;
  verifierAddress = existing.contracts.AttestedTransferVerifier?.address;
  console.log('\n[1/5] Already deployed — using the recorded contracts (pass --redeploy to replace them).');
  console.log(`      ${address}`);
} else {
console.log('\n[1/5] Deploying CoachAgent…');

const deployed = execFileSync(
  'forge',
  [
    'script', 'script/Deploy.s.sol:Deploy',
    '--rpc-url', MAINNET.rpc,
    '--broadcast',
    // Headroom, not a floor. eth_gasPrice suggests 4 gwei on mainnet, but a
    // 3 gwei transaction has mined there (the policy anchor, block 43753718)
    // and the base fee is effectively zero. An earlier version of this comment
    // said 3 gwei "would sit unmined"; that was asserted, not measured, and
    // it was wrong. 6 gwei costs a fraction of a cent more and never waits.
    '--with-gas-price', '6gwei',
    '--priority-gas-price', '5gwei',
  ],
  { cwd: path.join(root, 'contracts'), encoding: 'utf8', env: { ...process.env, PRIVATE_KEY: key }, shell: process.platform === 'win32' },
);

/*
 * The addresses come from forge's broadcast file, not from its console output.
 *
 * This used to match /CoachAgent deployed at: …/ against stdout, while
 * Deploy.s.sol prints "CoachAgent: …". The pattern never matched once. On the
 * real mainnet run the contracts deployed, the script announced it could not
 * read the address, and exited — so the "one rehearsed command" had never been
 * rehearsed past its first step, and the rest was finished by hand. The
 * broadcast file is what forge writes for exactly this purpose, it carries the
 * transaction hashes too, and it does not change when somebody edits a log line.
 */
void deployed;
const broadcast = JSON.parse(fs.readFileSync(path.join(root, 'contracts', 'broadcast', 'Deploy.s.sol', String(MAINNET.chainId), 'run-latest.json'), 'utf8'));
const created = (name) => broadcast.transactions.find((t) => t.transactionType === 'CREATE' && t.contractName === name)?.contractAddress;
address = created('CoachAgent') && ethers.getAddress(created('CoachAgent'));
verifierAddress = created('AttestedTransferVerifier');
if (!address) {
  console.error('Deployed, but the broadcast file names no CoachAgent. Check contracts/broadcast/.');
  process.exit(1);
}
console.log(`      ${address}`);
}

/* ------------------------------------------------- 2. prove it, before trusting it */

console.log('\n[2/5] Asking the deployed bytecode what it is…');

const coach = new ethers.Contract(
  address,
  [
    'function name() view returns (string)',
    'function supportsInterface(bytes4) view returns (bool)',
    'function transferVerifier() view returns (address)',
  ],
  provider,
);

const checks = {
  name: await coach.name(),
  'ERC-721': await coach.supportsInterface('0x80ac58cd'),
  'IERC7857': await coach.supportsInterface('0x4b396f04'),
  'IERC7857Authorize': await coach.supportsInterface('0x35d39512'),
  /*
   * The control, asked of mainnet the same way the README invites anybody to.
   * A contract answering true to everything passes the three above it, so this
   * is the line that makes them worth printing.
   */
  'control (0xdeadbeef, must be false)': await coach.supportsInterface('0xdeadbeef'),
};

for (const [what, value] of Object.entries(checks)) console.log(`      ${what}: ${value}`);

if (!checks['IERC7857'] || !checks['IERC7857Authorize'] || !checks['ERC-721']) {
  console.error('\nThe deployed contract does not answer for the interfaces it should. Stopping.');
  process.exit(1);
}

if (checks['control (0xdeadbeef, must be false)'] !== false) {
  console.error('\nIt claims an interface nothing implements. That is not our contract. Stopping.');
  process.exit(1);
}

/*
 * The wiring, asserted rather than assumed.
 *
 * `transferVerifier` is immutable, so a coach pointed at the wrong verifier —
 * or at nothing — cannot be repaired. It is not a setting somebody fixes later;
 * it is a migration nobody planned. Cheaper to find here than after the first
 * transfer reverts on mainnet.
 */
const wired = await coach.transferVerifier();
console.log(`      transferVerifier: ${wired}`);

if (wired === ethers.ZeroAddress) {
  console.error('\nDeployed without a transfer verifier, so iTransferFrom would revert forever. Stopping.');
  process.exit(1);
}

if (verifierAddress && wired.toLowerCase() !== verifierAddress.toLowerCase()) {
  console.error(`\nThe coach points at ${wired}, not at the verifier just deployed. Stopping.`);
  process.exit(1);
}

const verifier = new ethers.Contract(wired, ['function attestor() view returns (address)'], provider);
const attestor = await verifier.attestor();
console.log(`      attestor:         ${attestor}`);

if (attestor === ethers.ZeroAddress) {
  console.error('\nThe verifier has no attestor, so it would accept malformed signatures. Stopping.');
  process.exit(1);
}

/* ------------------------------------------------------ 3. make it discoverable */

console.log('\n[3/5] Registering as an ERC-8004 Trustless Agent…');
run(process.execPath, ['scripts/register-agent.mjs', '--mainnet']);

/* --------------------------------------------- 4. publish the source, verified */

/*
 * Source verification on 0G's own explorer, so anybody reading the contract
 * there reads Solidity, not bytecode. 0G documents forge's custom verifier
 * against chainscan's open API. Already-verified contracts are left alone.
 *
 * forge's status poll cannot parse this explorer's reply ("guid is required")
 * even when the submission succeeded, so the poll is not trusted either way:
 * the explorer is asked directly afterwards, and that answer is the one used.
 */
console.log('\n[4/5] Publishing the verified source on the explorer…');
const artifact = (name) => JSON.parse(fs.readFileSync(path.join(root, 'contracts', 'out', `${name}.sol`, `${name}.json`), 'utf8'));
const compiler = 'v' + artifact('CoachAgent').metadata.compiler.version;
const isVerified = async (addr, name) => {
  const res = await fetch(`${MAINNET.explorer}/open/api?module=contract&action=getsourcecode&address=${addr}`).catch(() => null);
  const row = (await res?.json().catch(() => null))?.result?.[0];
  return row?.ContractName === name;
};
for (const [name, addr, args] of [
  ['AttestedTransferVerifier', verifierAddress, [attestor]],
  ['CoachAgent', address, [wired]],
]) {
  if (await isVerified(addr, name)) { console.log(`      ${name}: already verified`); continue; }
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(['address'], args);
  try {
    execFileSync('forge', [
      'verify-contract', '--chain-id', String(MAINNET.chainId),
      '--num-of-optimizations', '200', '--via-ir', '--evm-version', 'cancun',
      '--compiler-version', compiler,
      '--verifier', 'custom', '--verifier-api-key', 'PLACEHOLDER',
      '--verifier-url', `${MAINNET.explorer}/open/api`,
      '--constructor-args', encoded,
      addr, `src/${name}.sol:${name}`,
    ], { cwd: path.join(root, 'contracts'), stdio: 'pipe', shell: process.platform === 'win32' });
  } catch { /* judged below, from the explorer itself */ }
  let ok = false;
  for (let i = 0; i < 12 && !ok; i += 1) { await new Promise((r) => setTimeout(r, 5000)); ok = await isVerified(addr, name); }
  console.log(`      ${name}: ${ok ? 'verified' : 'NOT verified — rerun, or submit on the explorer by hand'}`);
}

/* ---------------------------------------- 5. the record, and an independent check */

/*
 * The deployment record is written from the broadcast and the chain, then
 * checked by a separate script that trusts none of it: it rebuilds the source,
 * compares the deploy transaction byte for byte, and accounts for every
 * immutable. If that check fails, this sequence has not finished.
 */
console.log('\n[5/5] Writing the deployment record and checking it against the chain…');
run(process.execPath, ['scripts/deployment-record.mjs', String(MAINNET.chainId)]);
try {
  run(process.execPath, ['scripts/verify-deployment.mjs', String(MAINNET.chainId)]);
} catch {
  console.error('\nThe independent check failed. The deployment is not finished until it passes.');
  process.exit(1);
}

/* ------------------------------------------------------------------ what next */

const agents = JSON.parse(fs.readFileSync(path.join(root, 'agents.json'), 'utf8'));

console.log('\n──────────────────────────────────────────────');
console.log('Mainnet is live, published and checked:\n');
console.log(`  CoachAgent      ${address}`);
console.log(`  ERC-8004 agent  #${agents.mainnet?.agentId ?? '?'}`);
console.log(`  record          deployments/${MAINNET.chainId}.json`);
console.log(`  explorer        ${MAINNET.explorer}/address/${address}#code\n`);
console.log('Then, deliberately rather than automatically:');
console.log('  1. Point the app at it:');
console.log(`       vercel env add VITE_COACH_ADDRESS production   → ${address}`);
console.log(`       vercel env add COACH_ADDRESS production        → ${address}`);
console.log('       vercel env add VITE_OG_NETWORK production      → mainnet');
console.log('       vercel env add OG_RPC_URL production           → https://evmrpc.0g.ai');
console.log('  2. Fund inference: OG_RPC_URL=https://evmrpc.0g.ai node scripts/fund-compute.mjs 3');
console.log('  3. Redeploy the app, then mint one coach from a phone to prove the live path.');
