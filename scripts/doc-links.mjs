#!/usr/bin/env node
/**
 * Every transaction and contract the documents link to exists on mainnet.
 *
 *   node scripts/doc-links.mjs
 *
 * Twice now a document has linked something that was not there. After the move
 * to mainnet, six README links still carried Galileo transaction hashes under
 * the mainnet explorer's address — every one a 404 for whoever clicked it. And
 * while writing DEPLOYMENTS.md, a commit link was typed with a hash that was
 * never a commit. Both were caught by reading. This catches them by asking.
 *
 * A transaction must have succeeded. An address link must have code, or be one
 * of the externally owned accounts the documents name on purpose (the relayer,
 * the walletless owners) — those must at least have been active on chain.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = ['README.md', 'DEPLOYMENTS.md', 'VERIFICATION.md', 'SUBMISSION.md', 'ARCHITECTURE.md', 'SECURITY.md'];
const provider = new ethers.JsonRpcProvider('https://evmrpc.0g.ai', 16661, { staticNetwork: true });

const txs = new Map();
const addresses = new Map();
const commits = new Map();
for (const doc of DOCS) {
  let text;
  try { text = fs.readFileSync(path.join(root, doc), 'utf8'); } catch { continue; }
  for (const m of text.matchAll(/chainscan\.0g\.ai\/tx\/(0x[0-9a-fA-F]{64})/g)) txs.set(m[1].toLowerCase(), doc);
  for (const m of text.matchAll(/chainscan\.0g\.ai\/address\/(0x[0-9a-fA-F]{40})/g)) addresses.set(m[1].toLowerCase(), doc);
  for (const m of text.matchAll(/github\.com\/Ritik200238\/LIFTWITHOG\/commit\/([0-9a-f]{7,40})/g)) commits.set(m[1], doc);
}

let failed = 0;
const bad = (what, doc) => { failed += 1; console.log(`  [FAIL] ${what}  (${doc})`); };

for (const [hash, doc] of txs) {
  const r = await provider.getTransactionReceipt(hash);
  if (!r) bad(`tx ${hash} is not on mainnet`, doc);
  else if (r.status !== 1) bad(`tx ${hash} reverted`, doc);
}

for (const [addr, doc] of addresses) {
  const [code, nonce, balance] = await Promise.all([provider.getCode(addr), provider.getTransactionCount(addr), provider.getBalance(addr)]);
  // A contract has code. An account named on purpose has been used: it sent
  // something, or was sent something. An address with neither is a typo.
  if (code === '0x' && nonce === 0 && balance === 0n) {
    // Walletless owners hold nothing and send nothing by design, so a zero
    // account is not proof of a typo on its own. They are accepted only if the
    // coach contract's mint log names them.
    const coach = new ethers.Contract('0x94Ce4680890ab16B52E3F1A9CDf25C1B01e119B5', ['event CoachMinted(uint256 indexed tokenId, address indexed owner, bytes32 configHash)'], provider);
    const logs = await coach.queryFilter(coach.filters.CoachMinted(null, addr), 43752560).catch(() => []);
    if (logs.length === 0) bad(`address ${addr} has no code, no activity, and owns no coach`, doc);
  }
}

for (const [sha, doc] of commits) {
  try { execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: root, stdio: 'pipe' }); }
  catch { bad(`commit ${sha} does not exist in this repository`, doc); }
}

console.log(`${txs.size} transactions, ${addresses.size} addresses, ${commits.size} commits linked from ${DOCS.length} documents — ${failed === 0 ? 'all real' : `${failed} not`}.`);
process.exit(failed ? 1 : 0);
