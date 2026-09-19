#!/usr/bin/env node
/**
 * Check a deployment record against the chain and the source. Trust nothing in it.
 *
 *   node scripts/verify-deployment.mjs 16661      # 0G Aristotle mainnet
 *
 * Needs no key, no account and no server of ours: a public RPC, the repository
 * and forge. Every line is a separate claim with its own PASS or FAIL, and the
 * exit code is the count of failures — so this can sit in CI as it is.
 *
 * What it proves, in the order a sceptic would ask:
 *
 *   1. The record is internally complete — nothing missing that a check needs.
 *   2. Each contract was deployed by the transaction the record names, in the
 *      block it names, at the address it names.
 *   3. That transaction's input is exactly the creation code this repository
 *      compiles to, followed by exactly the constructor arguments recorded.
 *      Rebuilt here, from source, with the pinned compiler — not read from a
 *      file somebody could have edited.
 *   4. The code now at the address matches the compiled runtime code byte for
 *      byte, and the only bytes that differ are immutables, each holding the
 *      value the record says. A coach wired to any other verifier fails here.
 *   5. The source is published and verified on 0G's own explorer.
 *   6. The ERC-8004 identity, the compute ledger and the policy anchor exist
 *      as recorded.
 *   7. The activity the record reports is what the chain's events say.
 *
 * Anything that cannot be checked — forge missing, the explorer down — is
 * reported as NOT VERIFIED rather than skipped. A check that quietly does not
 * run is indistinguishable from one that passed.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import {
  compareRuntime,
  sameAddress,
  matchesCreationInput,
  blockRanges,
  summarizeActivity,
  recordProblems,
  IMMUTABLE_SOURCES,
  eip712Immutables,
  expectedImmutable,
  immutableWord,
  eip712FromSource,
} from './deployment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chainId = Number(process.argv[2] ?? 16661);
const recordFile = path.join(root, 'deployments', `${chainId}.json`);

let failures = 0;
let unverified = 0;
const pass = (what, detail = '') => console.log(`  [PASS] ${what}${detail ? ` — ${detail}` : ''}`);
const fail = (what, detail = '') => { failures += 1; console.log(`  [FAIL] ${what}${detail ? ` — ${detail}` : ''}`); };
const unknown = (what, detail = '') => { unverified += 1; console.log(`  [NOT VERIFIED] ${what}${detail ? ` — ${detail}` : ''}`); };
const section = (title) => console.log(`\n${title}\n${'-'.repeat(title.length)}`);

if (!fs.existsSync(recordFile)) {
  console.error(`No record at deployments/${chainId}.json.`);
  process.exit(1);
}
const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));

/* ------------------------------------------------------------ 1. the record */

section('The record is complete');
const problems = recordProblems(record);
if (problems.length) fail('every field a check needs is present', `missing or malformed: ${problems.join(', ')}`);
else pass('every field a check needs is present');
if (record.network.chainId !== chainId) fail('the record is for this chain', `it says ${record.network.chainId}`);

const provider = new ethers.JsonRpcProvider(record.network.rpc, chainId, { staticNetwork: true });
const actual = Number((await provider.getNetwork()).chainId);
if (actual === chainId) pass('the RPC in the record is that chain', `${record.network.rpc} answers chain id ${actual}`);
else fail('the RPC in the record is that chain', `it answers ${actual}`);

/* ------------------------------------------------------- 3a. rebuild, here */

section('The source rebuilds to what was deployed');

/*
 * Built from the working tree, so the tree has to be the recorded commit for
 * the contract sources. Checked rather than assumed: a later edit to
 * CoachAgent.sol would otherwise fail every bytecode line below with an error
 * that looks like a tampered deployment.
 */
/*
 * The Solidity sources and the pinned dependency versions — what the compiler
 * reads. foundry.toml is left out on purpose: its compile-relevant settings
 * (version, optimizer, via-IR, EVM target) are checked below from the build's
 * own metadata, and the rest of it (lint, fuzz budgets, RPC names) cannot
 * change a byte of output. Including it failed this check over a lint setting.
 */
let sourceMatches = false;
try {
  const diff = execFileSync('git', ['diff', '--name-only', record.source.commit, '--', 'contracts/src', 'contracts/package-lock.json'], { cwd: root, encoding: 'utf8' }).trim();
  if (diff) fail('the contract source here is the recorded commit', `changed since ${record.source.commit.slice(0, 12)}: ${diff.split('\n').join(', ')} — git checkout ${record.source.commit} first`);
  else { pass('the contract source here is the recorded commit', record.source.commit.slice(0, 12)); sourceMatches = true; }
} catch (e) {
  unknown('the contract source here is the recorded commit', `git could not compare: ${String(e.message).split('\n')[0]}`);
}

let built = false;
try {
  // --ast so every immutable can be named from the compiler's own syntax tree.
  // It adds output; it does not change a byte of what is compiled.
  execFileSync('forge', ['build', '--ast'], { cwd: path.join(root, 'contracts'), stdio: 'pipe', shell: process.platform === 'win32' });
  built = true;
  pass('forge rebuilt the contracts from source');
} catch (e) {
  // Say which: "not installed" and "installed but the build broke" need
  // different fixes, and the second one is a finding about the repository.
  const out = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim().split('\n').filter(Boolean).slice(-2).join(' / ');
  unknown('forge rebuilt the contracts from source', e.code === 'ENOENT' || /not recognized|not found/i.test(out)
    ? 'forge is not installed — install Foundry to run the bytecode checks'
    : `the build failed: ${out}`);
}

const artifact = (name) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'contracts', 'out', `${name}.sol`, `${name}.json`), 'utf8')); } catch { return null; }
};

/*
 * Immutable id → variable name, from every artifact's AST. The ids are the
 * compiler's own; an inherited immutable (OpenZeppelin's EIP712 caches) lives
 * in its parent's artifact, so one contract's AST alone would miss most of
 * CoachAgent's.
 */
const immutableNames = {};
if (built) {
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.nodeType === 'VariableDeclaration' && node.mutability === 'immutable') immutableNames[node.id] = node.name;
    for (const value of Object.values(node)) walk(value);
  };
  const scan = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'build-info') scan(p); continue; }
      if (!entry.name.endsWith('.json')) continue;
      try { walk(JSON.parse(fs.readFileSync(p, 'utf8')).ast); } catch { /* not an artifact */ }
    }
  };
  scan(path.join(root, 'contracts', 'out'));
}

if (built) {
  const meta = artifact('CoachAgent')?.metadata;
  if (meta?.compiler?.version === record.source.compiler) pass('the compiler is the recorded one', meta.compiler.version);
  else fail('the compiler is the recorded one', `built with ${meta?.compiler?.version}, recorded ${record.source.compiler}`);
  const s = meta?.settings ?? {};
  const want = record.source.settings;
  const same = s.optimizer?.enabled === want.optimizer.enabled && s.optimizer?.runs === want.optimizer.runs && Boolean(s.viaIR) === want.viaIR && s.evmVersion === want.evmVersion;
  if (same) pass('the compiler settings are the recorded ones', `optimizer ${want.optimizer.runs} runs, viaIR ${want.viaIR}, ${want.evmVersion}`);
  else fail('the compiler settings are the recorded ones', JSON.stringify({ optimizer: s.optimizer, viaIR: s.viaIR, evmVersion: s.evmVersion }));
}

/* ----------------------------------------------- 2–4. each deployed contract */

for (const [name, c] of Object.entries(record.contracts)) {
  section(name);

  const receipt = await provider.getTransactionReceipt(c.deployTx);
  if (!receipt) { fail('the deploy transaction exists', c.deployTx); continue; }
  if (receipt.status === 1 && sameAddress(receipt.contractAddress, c.address) && receipt.blockNumber === c.block) {
    pass('deployed by the recorded transaction', `${c.address} in block ${c.block}`);
  } else {
    fail('deployed by the recorded transaction', `status ${receipt.status}, created ${receipt.contractAddress} in block ${receipt.blockNumber}`);
  }

  const tx = await provider.getTransaction(c.deployTx);
  if (!sameAddress(tx.from, record.deployer)) fail('deployed by the recorded deployer', tx.from);

  const code = await provider.getCode(c.address);
  if (ethers.keccak256(code) === c.runtimeCodeHash) pass('the code at the address has the recorded hash', c.runtimeCodeHash.slice(0, 18) + '…');
  else fail('the code at the address has the recorded hash', `now ${ethers.keccak256(code)}`);

  const art = built ? artifact(name) : null;
  if (!art) { unknown('rebuilt from source and compared', built ? `no artifact for ${name}` : 'no build'); continue; }

  // 3. The deploy transaction, byte for byte.
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(c.constructorTypes, Object.values(c.constructorArgs));
  const creation = matchesCreationInput(tx.data, art.bytecode.object, encoded);
  if (creation.ok && sourceMatches) pass('the deploy input is this source compiled, plus the recorded arguments', `${(tx.data.length - 2) / 2} bytes, exact`);
  else if (creation.ok) unknown('the deploy input is this source compiled, plus the recorded arguments', 'matches, but the source here is not the recorded commit');
  else fail('the deploy input is this source compiled, plus the recorded arguments', creation.reason);

  // 4. The runtime code, byte for byte outside the immutables.
  const runtime = compareRuntime(art.deployedBytecode.object, code, art.deployedBytecode.immutableReferences);
  if (runtime.identical) pass('the runtime code is this source compiled', `${c.runtimeCodeBytes} bytes, identical outside ${Object.keys(runtime.immutables).length} immutable(s)`);
  else fail('the runtime code is this source compiled', runtime.reason);

  // …and every masked byte is accounted for. Each immutable is named from the
  // compiler's AST and must hold the value its rule produces; one with no rule
  // fails rather than being skipped, because a mask with an unexplained slot in
  // it is exactly where a substituted contract would hide.
  const solidity = fs.readFileSync(path.join(root, c.source.split(':')[0]), 'utf8');
  const domain = eip712FromSource(solidity);
  const eip712 = domain ? eip712Immutables({ ...domain, chainId, verifyingContract: c.address }) : {};
  let accounted = 0;
  for (const [id, words] of Object.entries(runtime.immutables)) {
    const variable = immutableNames[id];
    const held = immutableWord(words);
    if (!variable) { fail(`immutable ${id} can be named`, 'not found in the compiler AST'); continue; }
    if (!held.ok) { fail(`${variable} holds one value`, held.reason); continue; }
    const rule = IMMUTABLE_SOURCES[name]?.[variable];
    if (!rule) { fail(`${variable} is accounted for`, 'no rule says where its value comes from'); continue; }
    const expected = expectedImmutable(rule, { constructorArgs: c.constructorArgs, eip712 });
    if (expected && held.word === expected) accounted += 1;
    else fail(`${variable} holds what it should`, `holds ${held.word}, expected ${expected}`);
  }
  const total = Object.keys(runtime.immutables).length;
  if (accounted === total) pass('every immutable holds the value its rule produces', `${accounted} of ${total}${domain ? `, EIP-712 domain "${domain.name}" v${domain.version} on chain ${chainId}` : ''}`);

  // 5. Published on the explorer.
  try {
    const res = await fetch(`${record.network.explorer}/open/api?module=contract&action=getsourcecode&address=${c.address}`);
    const body = await res.json();
    const r = body?.result?.[0] ?? {};
    const verified = r.ContractName === name && !String(r.ABI ?? '').startsWith('Contract source code not verified');
    if (verified && String(r.CompilerVersion).includes(record.source.compiler.split('+')[0])) pass('the source is verified on the explorer', c.explorer);
    else if (verified) fail('the source is verified on the explorer', `verified with compiler ${r.CompilerVersion}`);
    else fail('the source is verified on the explorer', `${record.network.explorer} has no verified source for ${c.address}`);
  } catch (e) {
    unknown('the source is verified on the explorer', `the explorer did not answer: ${e.message}`);
  }
}

/* ------------------------------------------------------------- the wiring */

section('Wiring');
const coach = record.contracts.CoachAgent;
const verifierRec = record.contracts.AttestedTransferVerifier;
const coachContract = new ethers.Contract(coach.address, ['function transferVerifier() view returns (address)'], provider);
const wired = await coachContract.transferVerifier();
if (sameAddress(wired, verifierRec?.address)) pass('the coach names the recorded verifier', wired);
else fail('the coach names the recorded verifier', `it names ${wired}`);
const verifierContract = new ethers.Contract(verifierRec.address, ['function attestor() view returns (address)'], provider);
const attestor = await verifierContract.attestor();
if (sameAddress(attestor, record.wiring['AttestedTransferVerifier.attestor'])) pass('the verifier names the recorded attestor', attestor);
else fail('the verifier names the recorded attestor', `it names ${attestor}`);

/* ------------------------------------------------- 6. the rest of the stack */

section('The rest of the stack');

if (record.erc8004) {
  const reg = new ethers.Contract(record.erc8004.registry, ['function ownerOf(uint256) view returns (address)', 'function tokenURI(uint256) view returns (string)'], provider);
  try {
    const [owner, uri] = await Promise.all([reg.ownerOf(record.erc8004.agentId), reg.tokenURI(record.erc8004.agentId)]);
    if (sameAddress(owner, record.erc8004.owner) && uri === record.erc8004.agentURI) pass(`ERC-8004 agent #${record.erc8004.agentId} is registered as recorded`, uri);
    else fail(`ERC-8004 agent #${record.erc8004.agentId} is registered as recorded`, `owner ${owner}, uri ${uri}`);
  } catch (e) {
    fail(`ERC-8004 agent #${record.erc8004.agentId} exists`, e.shortMessage || e.message);
  }
} else unknown('ERC-8004 registration', 'none in the record');

if (record.compute?.fundings?.length) {
  let funded = 0n;
  for (const f of record.compute.fundings) {
    const [r, t] = await Promise.all([provider.getTransactionReceipt(f.tx), provider.getTransaction(f.tx)]);
    if (r?.status === 1 && sameAddress(t.to, record.compute.ledgerContract) && sameAddress(t.from, record.compute.owner)) funded += t.value;
    else fail('a compute ledger funding transaction is what the record says', f.tx);
  }
  if (funded > 0n) pass('the 0G Compute ledger was funded on this chain', `${ethers.formatEther(funded)} 0G to ${record.compute.ledgerContract}`);
} else unknown('0G Compute ledger', 'none in the record');

if (record.policy) {
  const t = await provider.getTransaction(record.policy.anchorTx);
  const r = await provider.getTransactionReceipt(record.policy.anchorTx);
  if (r?.status === 1 && String(t.data).toLowerCase() === record.policy.commitment.toLowerCase()) pass('the policy commitment is anchored in the recorded transaction', `block ${r.blockNumber}`);
  else fail('the policy commitment is anchored in the recorded transaction', record.policy.anchorTx);
} else unknown('policy anchor', 'none in the record');

/* ---------------------------------------------------------- 7. activity */

section('Activity, re-read from events');
const iface = new ethers.Interface(artifact('CoachAgent')?.abi ?? [
  'event CoachMinted(uint256 indexed tokenId, address indexed owner, bytes32 configHash)',
  'event CoachEvolved(uint256 indexed tokenId, uint64 indexed version, bytes32 configHash)',
  'event RentalPriceSet(uint256 indexed tokenId, uint256 pricePerDay)',
  'event Rented(uint256 indexed tokenId, address indexed renter, uint64 expiresAt, uint256 paid)',
  'event CoachCloned(uint256 indexed parentId, uint256 indexed childId, address indexed owner, uint256 paid)',
  'event IntelligentTransfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);
const through = record.activity.readThroughBlock;
const events = [];
for (const [from, to] of blockRanges(coach.block, through)) {
  for (const log of await provider.getLogs({ address: coach.address, fromBlock: from, toBlock: to })) {
    let parsed = null;
    try { parsed = iface.parseLog(log); } catch { /* not ours */ }
    if (parsed) events.push({ name: parsed.name, args: Object.fromEntries(parsed.fragment.inputs.map((inp, i) => [inp.name, String(parsed.args[i])])), tx: log.transactionHash, block: log.blockNumber });
  }
}
const now = summarizeActivity(events);
for (const key of ['minted', 'evolved', 'highestVersion', 'listedForRent', 'rented', 'intelligentTransfers', 'clones', 'deepestLineage']) {
  if (now[key] === record.activity[key]) pass(`${key} through block ${through}`, String(now[key]));
  else fail(`${key} through block ${through}`, `the chain says ${now[key]}, the record says ${record.activity[key]}`);
}
const balance = await provider.getBalance(coach.address);
if (balance === 0n) pass('the contract holds nobody\'s money', '0 0G');
else fail('the contract holds nobody\'s money', `${ethers.formatEther(balance)} 0G`);

/* ---------------------------------------------------------------- summary */

console.log(`\n${failures === 0 ? 'Every check passed' : `${failures} check(s) failed`}${unverified ? `, ${unverified} could not be run` : ''}.`);
process.exit(failures);
