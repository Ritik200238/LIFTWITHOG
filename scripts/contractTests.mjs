#!/usr/bin/env node
/**
 * Every contract test that is written is also run.
 *
 *   node scripts/contractTests.mjs
 *
 * This exists because CI counted 107 contract tests where this repository
 * counts 111 — same commit, same six suites, none reported skipped, forge
 * green on both. Four tests are written and are not being run somewhere, and
 * a suite that is green while four of its tests quietly do not exist is worse
 * than a red one: it is a false statement about what is protected.
 *
 * The comparison is between what the source declares and what forge says it
 * discovered, so the failure names the functions rather than a total four
 * short — which is the whole reason this could not be diagnosed from a CI log
 * that only ever printed a number.
 *
 * It also catches the ordinary version of the same mistake: a test function
 * renamed to something forge no longer recognises, or made internal, which
 * removes it from the run without removing it from the file or from anybody's
 * sense of what is covered.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(root, 'contracts', 'test');

/*
 * Declared: any function whose name forge treats as a test. Deliberately
 * ignores visibility — a test written `internal` is exactly the mistake this is
 * looking for, and reporting it as missing is the correct answer.
 */
const declared = new Set();
for (const file of readdirSync(testDir)) {
  if (!file.endsWith('.sol')) continue;
  const source = readFileSync(path.join(testDir, file), 'utf8');
  for (const match of source.matchAll(/function\s+((?:test|invariant)[A-Za-z0-9_]*)\s*\(/g)) {
    declared.add(match[1]);
  }
}

/*
 * Discovered: what forge itself says it will run. `--list` rather than a full
 * run, so this is fast enough to sit in front of every push.
 */
let listing = '';
try {
  listing = execFileSync('forge', ['test', '--list'], {
    cwd: path.join(root, 'contracts'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    maxBuffer: 32 * 1024 * 1024,
  });
} catch (e) {
  console.error('forge test --list failed:');
  console.error(`${e.stdout || ''}${e.stderr || ''}`.trimEnd().split('\n').slice(-15).join('\n'));
  process.exit(1);
}

const discovered = new Set();
for (const line of listing.split('\n')) {
  // Indented four spaces under a suite name; the suite lines are indented two.
  const match = line.match(/^\s{4}((?:test|invariant)[A-Za-z0-9_]*)\s*$/);
  if (match) discovered.add(match[1]);
}

const missing = [...declared].filter((name) => !discovered.has(name)).sort();
const extra = [...discovered].filter((name) => !declared.has(name)).sort();

console.log(`declared ${declared.size}, discovered ${discovered.size}`);

if (declared.size === 0 || discovered.size === 0) {
  // A comparison of two empty sets is not agreement.
  console.log('Neither side found anything. That is a broken check, not a pass.');
  process.exit(1);
}

if (missing.length) {
  console.log(`\n${missing.length} written but not run:`);
  for (const name of missing) console.log(`  ${name}`);
}
if (extra.length) {
  console.log(`\n${extra.length} run but not found in the source:`);
  for (const name of extra) console.log(`  ${name}`);
}

if (missing.length || extra.length) {
  console.log('\nforge:');
  try {
    console.log('  ' + execFileSync('forge', ['--version'], {
      cwd: path.join(root, 'contracts'),
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }).trim().split('\n').join('\n  '));
  } catch {
    console.log('  (could not read forge --version)');
  }
  process.exit(1);
}

console.log('Every contract test in the source is one forge will run.');
