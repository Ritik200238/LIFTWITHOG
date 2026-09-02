import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

import { loadComputeSdk } from './computeSdk.js';

/**
 * That the 0G Compute SDK can actually be loaded.
 *
 * This is the test that was missing when every coach question in production
 * returned "The coach could not answer". The package points its `import`
 * condition at an ESM build that re-exports named bindings out of a CommonJS
 * chunk, and Node's ESM loader refuses to link it:
 *
 *     SyntaxError: Named export 'C' not found.
 *
 * Nothing here caught it, because nothing here ever loaded the SDK. Every test
 * of the compute path injects a fake broker — correctly, since the real one
 * wants a funded account and a network — and the one line those fakes replace
 * was the line that was broken. The suite was green and the feature was dead.
 *
 * So this asserts the loading and nothing else: no network, no wallet, no
 * account. It is fast, it needs nothing, and it fails on exactly the fault that
 * shipped.
 */

test('the compute SDK loads, and exposes what the coach path calls', async () => {
  const sdk = await loadComputeSdk();

  for (const name of ['createZGComputeNetworkBroker', 'InferenceVerifier']) {
    assert.ok(sdk?.[name], `the SDK did not expose ${name}`);
  }
});

test('loading twice returns the same module rather than reloading it', async () => {
  assert.equal(await loadComputeSdk(), await loadComputeSdk());
});

test('the package is reachable by the name the bundler traces', async () => {
  /*
   * The failure this replaced a previous test for. Loading the SDK through
   * `createRequire` alone worked locally and broke production a second time,
   * because Vercel decides what to put in a function by following `import` and
   * `require` specifiers it can read as literals. A `createRequire(url)(name)`
   * call is not one, so nothing pointed at the package, the bundler dropped it,
   * and the 500 came back as "Cannot find module".
   *
   * So the property to hold is not which build wins — that legitimately differs
   * by environment — but that the module still names the package in a form the
   * tracer follows.
   */
  const source = fs.readFileSync(new URL('./computeSdk.js', import.meta.url), 'utf8');

  assert.match(
    source,
    /await import\('@0gfoundation\/0g-compute-ts-sdk'\)/,
    'nothing in computeSdk.js names the package in a way Vercel traces, so it will not be bundled',
  );

  // And the loader still produces something usable either way.
  const sdk = await loadComputeSdk();
  assert.equal(typeof sdk.createZGComputeNetworkBroker, 'function');
});
