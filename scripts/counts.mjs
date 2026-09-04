#!/usr/bin/env node
/**
 * The numbers the documents are allowed to claim.
 *
 *   node scripts/counts.mjs
 *
 * README said 668 tests in one place and 641 in another; the contract
 * breakdown summed to 77 under a headline of 72; mutations were 174/169 here
 * and 164/159 there. Every one of those was typed by a person reading an
 * earlier document, and each copy drifted a little further from the code.
 *
 * A judge who checks one number and finds it wrong discounts every number after
 * it — which is the real cost, and it is much larger than the error. So the
 * counts are computed, and the documents quote this.
 *
 * Deliberately counts the same way a person would: it runs the suites rather
 * than parsing source for `it(` — a test that is skipped, or a file nothing
 * imports, is not a test anybody is protected by.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const run = (command, args, cwd) => {
  try {
    return execFileSync(command, args, {
      cwd: path.join(root, cwd),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    // A failing suite still prints its totals, and a report that hides them
    // because something is red is a report that gets ignored when it matters.
    return `${e.stdout || ''}${e.stderr || ''}`;
  }
};

const first = (text, pattern, fallback = null) => {
  const match = text.match(pattern);
  return match ? Number(match[1]) : fallback;
};

const out = {};

const frontend = run('npx', ['vitest', 'run'], 'frontend');
out.frontend = first(frontend, /Tests\s+(\d+) passed/);
out.frontendFailed = first(frontend, /Tests\s+.*?(\d+) failed/, 0);

const server = run('node', ['--test'], 'server');
out.server = first(server, /^# pass (\d+)/m);
out.serverFailed = first(server, /^# fail (\d+)/m, 0);

const contracts = run('forge', ['test'], 'contracts');
out.contracts = first(contracts, /(\d+) tests passed/);
out.contractsFailed = first(contracts, /tests passed, (\d+) failed/, 0);

const total = (out.frontend ?? 0) + (out.server ?? 0) + (out.contracts ?? 0);
const failed = (out.frontendFailed ?? 0) + (out.serverFailed ?? 0) + (out.contractsFailed ?? 0);

console.log('tests');
console.log(`  frontend   ${out.frontend}`);
console.log(`  server     ${out.server}`);
console.log(`  contracts  ${out.contracts}`);
console.log(`  total      ${total}${failed ? `   (${failed} FAILING)` : ''}`);

/*
 * The documents, checked against what just ran.
 *
 * The guard this replaces was a blocklist of numbers that had been wrong once —
 * `529 frontend`, `641 tests`, `164 seeded`. It could only ever catch a mistake
 * already made, and it did not: ARCHITECTURE.md sat at "796 tests: 542 frontend
 * · 151 server · 103 contract" through four refreshes of every other document,
 * green the whole time, because nobody had thought to add those five numbers to
 * the list of numbers to look for.
 *
 * So this reads the counts out of the prose instead and compares them to the
 * suites. A number that drifts is caught whether or not anybody predicted it.
 */
if (process.argv.includes('--check')) {
  const docs = ['README.md', 'ARCHITECTURE.md', 'VERIFICATION.md', 'SUBMISSION.md'];
  const expected = {
    frontend: out.frontend,
    server: out.server,
    contracts: out.contracts,
    total,
  };

  // Each pattern names one count. Anything matching has to agree with the run.
  const patterns = [
    // The lookbehind is what keeps "the v2 contract" from reading as a count of two.
    [/(?<![A-Za-z])(\d+)\s+frontend\b/g, 'frontend'],
    [/(?<![A-Za-z])(\d+)\s+server\b/g, 'server'],
    [/(?<![A-Za-z])(\d+)\s+contract\b/g, 'contracts'],
    [/tests-(\d+)%20passing/g, 'total'],
    [/\*\*(\d+) tests\*\*/g, 'total'],
    [/^(\d+) tests\s{2,}/gm, 'total'],
    [/^(\d+) in total\./gm, 'total'],
  ];

  const wrong = [];
  for (const doc of docs) {
    let text;
    try {
      text = readFileSync(path.join(root, doc), 'utf8');
    } catch {
      continue;
    }
    for (const [pattern, key] of patterns) {
      for (const match of text.matchAll(pattern)) {
        const claimed = Number(match[1]);
        if (claimed !== expected[key]) {
          const line = text.slice(0, match.index).split('\n').length;
          wrong.push(`${doc}:${line}  says ${claimed} ${key}, the suites say ${expected[key]}`);
        }
      }
    }
  }

  console.log();
  if (wrong.length) {
    console.log('These documents disagree with the code:');
    for (const line of wrong) console.log(`  ${line}`);
    process.exitCode = 1;
  } else {
    console.log(`Documents agree with the suites (${docs.length} checked).`);
  }
}

if (process.argv.includes('--with-mutations')) {
  const mutations = run('node', ['scripts/mutate.mjs'], '.');
  const caught = first(mutations, /All (\d+) caught/);
  const equivalent = first(mutations, /and (\d+) verified equivalent/);
  console.log('\nmutations');
  console.log(`  caught     ${caught}`);
  console.log(`  equivalent ${equivalent}`);
  console.log(`  total      ${(caught ?? 0) + (equivalent ?? 0)}`);
} else {
  console.log('\n(pass --with-mutations for the mutation numbers; it re-runs the suite per mutant)');
}
