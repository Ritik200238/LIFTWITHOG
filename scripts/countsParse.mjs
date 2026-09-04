/**
 * Reading a number out of a test runner's output.
 *
 * Extracted from `counts.mjs` so it can be tested against the output CI
 * actually produces, which is not the output this repository's author sees.
 *
 * vitest and forge both colourise when they detect a terminal that supports it,
 * and GitHub Actions is one. So the line that reads
 *
 *     Tests  577 passed (577)
 *
 * on a laptop arrives in CI as
 *
 *     <ESC>[2m Tests <ESC>[22m <ESC>[1m<ESC>[32m577 passed<ESC>[39m
 *
 * and /Tests\s+(\d+) passed/ misses it. `counts.mjs` therefore reported
 * `frontend null` and a contract count four short on every CI run it has ever
 * done, exiting 0 the whole time, because the only thing checking it was
 * checking the exit code. Nobody reads the output of a green step.
 */

/** Strip SGR colour sequences. Nothing else in the output is touched. */
export const plain = (text) => String(text).replace(/\u001b\[[0-9;]*m/g, '');

/** The first number a pattern finds, once the colour is off. */
export const first = (text, pattern, fallback = null) => {
  const match = plain(text).match(pattern);
  return match ? Number(match[1]) : fallback;
};

/**
 * What each runner's summary looks like. Named here rather than written inline
 * at the call sites so the test can assert the real patterns rather than a copy
 * of them that can drift.
 */
export const PATTERNS = {
  frontendPassed: /Tests\s+(\d+) passed/,
  frontendFailed: /Tests\s+.*?(\d+) failed/,
  serverPassed: /^# pass (\d+)/m,
  serverFailed: /^# fail (\d+)/m,
  // Anchored to forge's run summary. Unanchored, any line in the output
  // saying "N tests passed" could answer for the whole run.
  contractsPassed: /Ran \d+ test suites?[^:]*:\s*(\d+) tests passed/,
  contractsSkipped: /Ran \d+ test suites?[^:]*:.*?(\d+) skipped/,
  contractsFailed: /tests passed, (\d+) failed/,
  mutationsCaught: /All (\d+) caught/,
  mutationsEquivalent: /and (\d+) verified equivalent/,
};

/**
 * The line a pattern matched, for a report that has to explain itself.
 *
 * When a count is missing or surprising, the useful thing is not the number —
 * it is the line the number came from, or the last few lines when there was
 * none. Without it a CI failure says "contracts 107" and gives no way to find
 * out why from a log you cannot re-run.
 */
export const evidence = (text, pattern) => {
  const clean = plain(text);
  const match = clean.match(pattern);
  if (match) {
    const start = clean.lastIndexOf('\n', match.index) + 1;
    const end = clean.indexOf('\n', match.index);
    return clean.slice(start, end === -1 ? undefined : end).trim();
  }
  return clean.trimEnd().split('\n').slice(-5).join(' / ').trim() || '(no output)';
};
