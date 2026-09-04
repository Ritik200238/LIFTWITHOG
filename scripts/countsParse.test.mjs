/*
 * The counts script, read against the output CI actually produces.
 *
 * This exists because `counts.mjs` reported `frontend null` and a contract
 * count four short on every CI run it had ever done, and exited 0 each time.
 * The runners colourise when they detect a CI terminal, so the summary line
 * arrives with escape sequences between the word and the number, and every
 * pattern in that script missed. Nobody noticed, because the only thing
 * checking the script was checking its exit code — and nobody reads the output
 * of a green step.
 *
 * The samples below are the real shapes, escape sequences and all, written with
 * \u001b rather than pasted so the file stays free of control bytes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { plain, first, evidence, PATTERNS } from './countsParse.mjs';

const E = '\u001b';

// Exactly what vitest prints in GitHub Actions.
const VITEST_CI =
  `${E}[2m      Tests ${E}[22m ${E}[1m${E}[32m577 passed${E}[39m${E}[22m${E}[90m (577)${E}[39m`;
const VITEST_LOCAL = '      Tests  577 passed (577)';

const FORGE_CI =
  `Ran 5 test suites in 1.20s: ${E}[32m111${E}[0m tests passed, 0 failed, 0 skipped (111 total tests)`;
const FORGE_LOCAL =
  'Ran 5 test suites in 1.20s: 111 tests passed, 0 failed, 0 skipped (111 total tests)';

test('the colour comes off', () => {
  assert.equal(plain(VITEST_CI).trim(), 'Tests  577 passed (577)');
  assert.equal(plain(FORGE_CI), FORGE_LOCAL);
});

test('a coloured vitest summary still yields its count', () => {
  assert.equal(first(VITEST_CI, PATTERNS.frontendPassed), 577);
  assert.equal(first(VITEST_LOCAL, PATTERNS.frontendPassed), 577);
});

test('a coloured forge summary still yields its count', () => {
  // The failure that started this: 111 locally, 107 in CI, from the same repo.
  assert.equal(first(FORGE_CI, PATTERNS.contractsPassed), 111);
  assert.equal(first(FORGE_LOCAL, PATTERNS.contractsPassed), 111);
});

test('node:test output is read the same either way', () => {
  assert.equal(first('# pass 157\n# fail 0', PATTERNS.serverPassed), 157);
  assert.equal(first(`${E}[32m# pass 157${E}[0m\n# fail 0`, PATTERNS.serverPassed), 157);
});

test('a failing suite still reports how many failed', () => {
  const red = `${E}[2m      Tests ${E}[22m ${E}[1m${E}[31m4 failed${E}[39m | 571 passed`;
  assert.equal(first(red, PATTERNS.frontendFailed), 4);
});

test('prose that merely looks like an escape sequence is left alone', () => {
  // The README badge, and any array index written in text, must survive.
  assert.equal(plain('badge/tests-845%20passing'), 'badge/tests-845%20passing');
  assert.equal(plain('rows[0;1]m'), 'rows[0;1]m');
});

test('an unreadable count is null rather than a wrong number', () => {
  // The distinction the check depends on: null means "could not count", and
  // must never be compared against a document as though it were a count.
  assert.equal(first('the suite crashed before printing anything', PATTERNS.frontendPassed), null);
});

test('the contract count comes from the run summary, not from any line that looks like one', () => {
  /*
   * CI reported 107 where this machine reported 111, from the same commit, with
   * forge itself green. The pattern was unanchored, so any line in several
   * hundred saying "N tests passed" could answer for the whole run.
   */
  const noisy = [
    'Ran 20 tests for test/AttestedTransferVerifier.t.sol:AttestedTransferVerifierTest',
    'Suite result: ok. 20 passed; 0 failed; 0 skipped (20 total tests)',
    'Compiler run successful with 107 tests passed somewhere in a warning',
    'Ran 5 test suites in 1.31s (2.10s CPU time): 111 tests passed, 0 failed, 0 skipped (111 total tests)',
  ].join('\n');

  assert.equal(first(noisy, PATTERNS.contractsPassed), 111);
});

test('skipped contract tests are visible rather than silently missing', () => {
  // If a suite is skipped in one environment and not another, the count differs
  // for a real reason, and the report has to be able to say which.
  const skipped =
    'Ran 5 test suites in 1.31s: 107 tests passed, 0 failed, 4 skipped (111 total tests)';
  assert.equal(first(skipped, PATTERNS.contractsPassed), 107);
  assert.equal(first(skipped, PATTERNS.contractsSkipped), 4);
});

test('evidence shows the line a number came from', () => {
  const out = 'noise\nRan 5 test suites in 1.31s: 111 tests passed, 0 failed, 0 skipped\nmore noise';
  assert.match(evidence(out, PATTERNS.contractsPassed), /^Ran 5 test suites/);
});

test('evidence shows the tail when nothing matched', () => {
  const out = 'line one\nline two\nit crashed';
  assert.match(evidence(out, PATTERNS.contractsPassed), /it crashed/);
  assert.equal(evidence('', PATTERNS.contractsPassed), '(no output)');
});
