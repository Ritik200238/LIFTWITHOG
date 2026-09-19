#!/usr/bin/env node
/**
 * Write the deployment record for one network, from evidence rather than memory.
 *
 *   node scripts/deployment-record.mjs 16661      # 0G Aristotle mainnet
 *
 * Output: `deployments/<chainId>.json`, then checked by
 * `scripts/verify-deployment.mjs`, which reads nothing but that file, the
 * source, and the chain.
 *
 * Nothing in the record is typed. Addresses, deploy transactions and
 * constructor arguments come from forge's own broadcast file; the compiler and
 * its settings from the build artifact; blocks, code hashes and every piece of
 * on-chain activity from the chain itself. This matters because every record in
 * this repository that a person wrote by hand has drifted: the README linked six
 * mainnet transactions while twelve had happened, and the policy record named a
 * testnet anchor for a week after the mainnet one existed.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { blockRanges, summarizeActivity, recordProblems } from './deployment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chainId = Number(process.argv[2] ?? 16661);

const NETWORKS = {
  16661: { name: '0G Aristotle mainnet', rpc: 'https://evmrpc.0g.ai', explorer: 'https://chainscan.0g.ai', agentsKey: 'mainnet' },
  16602: { name: '0G Galileo testnet', rpc: 'https://evmrpc-testnet.0g.ai', explorer: 'https://chainscan-galileo.0g.ai', agentsKey: 'testnet' },
};
const net = NETWORKS[chainId];
if (!net) {
  console.error(`No network configured for chain ${chainId}.`);
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(net.rpc, chainId, { staticNetwork: true });
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

/* ----------------------------------------------------------- the broadcast */

const broadcastPath = `contracts/broadcast/Deploy.s.sol/${chainId}/run-latest.json`;
if (!fs.existsSync(path.join(root, broadcastPath))) {
  console.error(`No broadcast at ${broadcastPath}. Deploy first: npm run go-mainnet`);
  process.exit(1);
}
const broadcast = read(broadcastPath);
if (Number(broadcast.chain) !== chainId) {
  console.error(`${broadcastPath} is for chain ${broadcast.chain}, not ${chainId}.`);
  process.exit(1);
}

/*
 * The broadcast stores a seven-character commit. That is a lookup, not a pin:
 * resolved here to the full hash so the record names exactly one tree.
 */
const commit = execFileSync('git', ['rev-parse', broadcast.commit], { cwd: root, encoding: 'utf8' }).trim();

/* ------------------------------------------------------------ the compiler */

const artifact = (name) => read(`contracts/out/${name}.sol/${name}.json`);
const meta = artifact('CoachAgent').metadata;
const settings = meta.settings;

/* ------------------------------------------------------------ the contracts */

const creations = broadcast.transactions.filter((t) => t.transactionType === 'CREATE');
const contracts = {};
for (const t of creations) {
  const receipt = await provider.getTransactionReceipt(t.hash);
  if (!receipt || receipt.status !== 1) {
    console.error(`${t.contractName}: deploy transaction ${t.hash} did not succeed on chain.`);
    process.exit(1);
  }
  const code = await provider.getCode(t.contractAddress);
  const ctorInputs = artifact(t.contractName).abi.find((x) => x.type === 'constructor')?.inputs ?? [];
  contracts[t.contractName] = {
    address: ethers.getAddress(t.contractAddress),
    deployTx: t.hash,
    block: receipt.blockNumber,
    constructorArgs: Object.fromEntries(ctorInputs.map((input, i) => [input.name || `arg${i}`, t.arguments?.[i]])),
    constructorTypes: ctorInputs.map((i) => i.type),
    runtimeCodeHash: ethers.keccak256(code),
    runtimeCodeBytes: (code.length - 2) / 2,
    source: `contracts/src/${t.contractName}.sol:${t.contractName}`,
    explorer: `${net.explorer}/address/${ethers.getAddress(t.contractAddress)}#code`,
  };
}

const coach = contracts.CoachAgent;
if (!coach) {
  console.error('No CoachAgent in the broadcast.');
  process.exit(1);
}

const deployer = ethers.getAddress(creations[0].transaction.from);

/* ----------------------------------------------------- activity, from events */

const iface = new ethers.Interface(artifact('CoachAgent').abi);
const latest = await provider.getBlockNumber();
const events = [];
for (const [from, to] of blockRanges(coach.block, latest)) {
  const logs = await provider.getLogs({ address: coach.address, fromBlock: from, toBlock: to });
  for (const log of logs) {
    let parsed = null;
    try { parsed = iface.parseLog(log); } catch { /* not ours to decode */ }
    if (!parsed) continue;
    events.push({ name: parsed.name, args: Object.fromEntries(parsed.fragment.inputs.map((inp, i) => [inp.name, String(parsed.args[i])])), tx: log.transactionHash, block: log.blockNumber });
  }
}
const activity = summarizeActivity(events);
activity.readThroughBlock = latest;

/* ---------------------------------------------------- the rest of the stack */

const agents = read('agents.json')[net.agentsKey];
let erc8004 = null;
if (agents && Number(agents.chainId) === chainId) {
  const r = await provider.getTransactionReceipt(agents.txHash);
  erc8004 = {
    registry: agents.registry,
    agentId: String(agents.agentId),
    owner: agents.owner,
    agentURI: agents.agentURI,
    tx: agents.txHash,
    block: r?.blockNumber ?? null,
  };
}

const policy = read('policy-provenance.json');
const anchor = policy.anchors?.[chainId] ?? null;

const computeLedger = read('deployments/compute-ledgers.json')[chainId] ?? null;

/* ---------------------------------------------------------------- the file */

const record = {
  _what: 'Every contract this project runs on this network, the exact source it was built from, and the transactions that prove it was used. Generated, not typed.',
  _verify: `node scripts/verify-deployment.mjs ${chainId}`,
  _regenerate: `node scripts/deployment-record.mjs ${chainId}`,
  schemaVersion: 1,
  network: { name: net.name, chainId, rpc: net.rpc, explorer: net.explorer },
  source: {
    repository: 'https://github.com/Ritik200238/LIFTWITHOG',
    commit,
    compiler: meta.compiler.version,
    settings: {
      optimizer: settings.optimizer,
      viaIR: settings.viaIR ?? false,
      evmVersion: settings.evmVersion,
    },
    toolchain: execFileSync('forge', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' }).split('\n')[0].trim(),
    broadcast: broadcastPath,
  },
  deployer,
  contracts,
  wiring: {
    'CoachAgent.transferVerifier': contracts.AttestedTransferVerifier?.address ?? null,
    'AttestedTransferVerifier.attestor': contracts.AttestedTransferVerifier?.constructorArgs?._attestor
      ?? Object.values(contracts.AttestedTransferVerifier?.constructorArgs ?? {})[0] ?? null,
  },
  erc8004,
  compute: computeLedger,
  policy: anchor ? { storageRoot: policy.storageRoot, sha256: policy.sha256, commitment: policy.commitment, anchorTx: anchor.tx, block: anchor.block } : null,
  activity,
};

const problems = recordProblems(record);
if (problems.length) {
  console.error('The record would be incomplete:', problems.join(', '));
  process.exit(1);
}

fs.mkdirSync(path.join(root, 'deployments'), { recursive: true });
const out = `deployments/${chainId}.json`;
fs.writeFileSync(path.join(root, out), JSON.stringify(record, null, 2) + '\n');

console.log(`${out}`);
console.log(`  source    ${commit.slice(0, 12)}  solc ${meta.compiler.version}`);
for (const [name, c] of Object.entries(contracts)) console.log(`  ${name.padEnd(26)} ${c.address}  block ${c.block}`);
console.log(`  activity  ${activity.minted} minted · ${activity.evolved} evolves (to v${activity.highestVersion}) · ${activity.intelligentTransfers} transfer · ${activity.clones} clones (${activity.deepestLineage} generations) · ${activity.rented} rentals`);
console.log(`\nCheck it: node scripts/verify-deployment.mjs ${chainId}`);
