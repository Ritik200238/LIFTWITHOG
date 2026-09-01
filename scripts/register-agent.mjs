#!/usr/bin/env node
/**
 * Register the coach as an ERC-8004 Trustless Agent, so it is discoverable
 * outside this app.
 *
 * ERC-7857 governs who owns an agent and how its encrypted intelligence
 * transfers. ERC-8004 answers a different question: how does anything *else*
 * find it. Registering puts LIFTWITHOG's coach in the same identity graph as
 * every other 8004 agent — visible to 8004scan and to any indexer that speaks
 * the standard — while ownership stays governed by the 7857 contract.
 *
 *   node --env-file=server/.env scripts/register-agent.mjs            # testnet
 *   node --env-file=server/.env scripts/register-agent.mjs --mainnet  # mainnet
 *
 * Registration is idempotent by intent, not by the contract: `register` mints
 * a new agentId every time it is called. So this refuses to run twice against
 * the same network unless forced, and records the id it was given in
 * `agents.json` — the file the docs and the app read, rather than a number
 * somebody has to remember.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

/** The repo root, and the record of which agent id each network gave us. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECORD = path.join(root, 'agents.json');

/**
 * 0G's ERC-8004 deployments, from the official registry list.
 *
 * The agentId space is a single global counter on the Identity Registry — it
 * is not scoped per project — so an id here is comparable with any other 8004
 * agent on the same chain.
 */
const NETWORKS = {
  testnet: {
    name: '0G Galileo testnet',
    chainId: 16602,
    rpc: 'https://evmrpc-testnet.0g.ai',
    identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    explorer: 'https://chainscan-galileo.0g.ai',
  },
  mainnet: {
    name: '0G Mainnet (Aristotle)',
    chainId: 16661,
    rpc: 'https://evmrpc.0g.ai',
    identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    explorer: 'https://chainscan.0g.ai',
  },
};

/** Only what this script calls, from the published registry ABI. */
const REGISTRY_ABI = [
  'function register(string agentURI) returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

/** 0G's gas floor. Below this the transaction is refused by the node, not mined slowly. */
const GAS_PRICE = 3_000_000_000n;

const wanted = process.argv.includes('--mainnet') ? 'mainnet' : 'testnet';
const force = process.argv.includes('--force');
const net = NETWORKS[wanted];

const key = process.env.RELAYER_PRIVATE_KEY || process.env.COACH_SERVICE_KEY;
if (!key) {
  console.error('Set RELAYER_PRIVATE_KEY (or COACH_SERVICE_KEY) — try: node --env-file=server/.env …');
  process.exit(1);
}

const readRecord = () => {
  try {
    return JSON.parse(fs.readFileSync(RECORD, 'utf8'));
  } catch {
    return {};
  }
};

const record = readRecord();
if (record[wanted]?.agentId && !force) {
  console.log(`Already registered on ${net.name}: agent #${record[wanted].agentId}`);
  console.log(`  ${net.explorer}/address/${net.identityRegistry}`);
  console.log('  Re-register anyway with --force (it mints a second, separate id).');
  process.exit(0);
}

const provider = new ethers.JsonRpcProvider(net.rpc, net.chainId, { staticNetwork: true });
const wallet = new ethers.Wallet(key, provider);

const balance = await provider.getBalance(wallet.address);
console.log(`network   ${net.name} (${net.chainId})`);
console.log(`wallet    ${wallet.address}`);
console.log(`balance   ${ethers.formatEther(balance)} 0G`);

if (balance === 0n) {
  console.error('\nThat wallet holds nothing, so it cannot pay for the registration.');
  console.error(wanted === 'mainnet' ? '  Send real 0G to it on chain 16661.' : '  Claim testnet 0G at https://faucet.0g.ai');
  process.exit(1);
}

/**
 * The agent card's address.
 *
 * Served from the app so it moves with a deployment rather than pointing at a
 * gateway that has to keep answering forever. `AGENT_CARD_URL` overrides it
 * for a self-hosted instance under its own domain.
 */
const agentURI = process.env.AGENT_CARD_URL || 'https://liftwithog.vercel.app/agent-card.json';

console.log(`card      ${agentURI}`);
console.log('\nRegistering…');

const registry = new ethers.Contract(net.identityRegistry, REGISTRY_ABI, wallet);
const tx = await registry['register(string)'](agentURI, { gasPrice: GAS_PRICE });
const receipt = await tx.wait();

/**
 * Read the id from the logs rather than assuming it.
 *
 * The counter is global and shared, so the id this registration receives
 * depends on every other agent registered before it. Guessing from a local
 * count would be wrong the moment anybody else registers.
 */
let agentId = null;
for (const log of receipt.logs) {
  try {
    const parsed = registry.interface.parseLog(log);
    if (parsed?.name === 'Registered') { agentId = parsed.args.agentId.toString(); break; }
    // The registry is an ERC-721: a mint is a Transfer from the zero address.
    if (parsed?.name === 'Transfer' && parsed.args.from === ethers.ZeroAddress) {
      agentId = parsed.args.tokenId.toString();
    }
  } catch {
    // A log from another contract in the same transaction. Not ours.
  }
}

if (!agentId) {
  console.error('Registered, but no agent id could be read from the logs.');
  console.error(`  tx ${receipt.hash}`);
  process.exit(1);
}

record[wanted] = {
  agentId,
  agentURI,
  registry: net.identityRegistry,
  chainId: net.chainId,
  txHash: receipt.hash,
  owner: wallet.address,
  registeredAt: new Date().toISOString(),
};
fs.writeFileSync(RECORD, JSON.stringify(record, null, 2) + '\n');

console.log(`\n✓ Registered as ERC-8004 agent #${agentId}`);
console.log(`  tx        ${net.explorer}/tx/${receipt.hash}`);
console.log(`  registry  ${net.explorer}/address/${net.identityRegistry}`);
console.log(`  explorer  https://8004scan.io`);
console.log(`\n  Recorded in agents.json`);
