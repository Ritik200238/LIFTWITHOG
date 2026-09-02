import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/**
 * The failure matrix must name codes that exist.
 *
 * VERIFICATION.md lists what this system does when somebody tries something it
 * should refuse — a named revert or a named HTTP code for each. That is only
 * worth more than prose while every name in it is real: a matrix citing a
 * `TransferProofRejected` that had been renamed would read exactly as
 * convincingly and mean nothing, and it is the kind of drift nobody notices
 * because documents are not compiled.
 */
test('every refusal the failure matrix names exists in the code', async () => {
  const root = new URL('../', import.meta.url);
  const doc = await readFile(new URL('VERIFICATION.md', root), 'utf8');

  const matrix = doc.slice(doc.indexOf('## The failure matrix'), doc.indexOf('## What we do NOT claim'));
  assert.ok(matrix.length > 500, 'the failure matrix section is missing or has moved');

  const contract = await readFile(new URL('contracts/src/CoachAgent.sol', root), 'utf8');
  const verifier = await readFile(new URL('contracts/src/AttestedTransferVerifier.sol', root), 'utf8');
  const server = (
    await Promise.all(
      ['server/coach.js', 'server/coach-runtime.js', 'server/relayer.js', 'server/server.js', 'server/x402.js', 'server/progressCard.js'].map((f) =>
        readFile(new URL(f, root), 'utf8'),
      ),
    )
  ).join('\n');

  const solidity = `${contract}\n${verifier}`;

  /* Solidity errors are cited as `Name()` or `Name(args)` in backticks. */
  const reverts = [...matrix.matchAll(/`([A-Z][A-Za-z]+)\(/g)].map((m) => m[1]);
  assert.ok(reverts.length >= 8, 'expected the matrix to cite several reverts');

  for (const name of new Set(reverts)) {
    assert.ok(
      solidity.includes(`error ${name}(`),
      `the matrix names ${name}(), which no contract declares`,
    );
  }

  /* API codes are cited as `<status> <code>`. */
  const codes = [...matrix.matchAll(/`\d{3} ([a-z_]+)`/g)].map((m) => m[1]);
  assert.ok(codes.length >= 8, 'expected the matrix to cite several API codes');

  for (const code of new Set(codes)) {
    assert.ok(server.includes(`'${code}'`), `the matrix names the code ${code}, which no route returns`);
  }
});
