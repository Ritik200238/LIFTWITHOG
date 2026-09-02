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

test('the compute SDK loads, and exposes what the coach path calls', () => {
  const sdk = loadComputeSdk();

  for (const name of ['createZGComputeNetworkBroker', 'InferenceVerifier']) {
    assert.ok(sdk?.[name], `the SDK did not expose ${name}`);
  }
});

test('loading twice returns the same module rather than reloading it', () => {
  assert.equal(loadComputeSdk(), loadComputeSdk());
});

test('the SDK comes from the CommonJS build, which is the whole fix', () => {
  /*
   * Asserted rather than described, because the failure itself cannot be
   * reproduced here: the ESM entry links cleanly under this machine's Node and
   * throws under Vercel's. Node detects a CommonJS chunk's named exports
   * heuristically, and that detection is what differs — so a test that asserted
   * "the ESM build is broken" would pass in production and fail in CI, which is
   * exactly backwards.
   *
   * What is true everywhere is which build we load. `exports.require` names the
   * CommonJS one, and identity against `require` proves we took that door
   * rather than the ESM one. Change this back to `await import` and this fails.
   */
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve('@0gfoundation/0g-compute-ts-sdk'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, '..', 'package.json'), 'utf8'));

  assert.equal(pkg.exports?.require, './lib.commonjs/index.js');
  assert.equal(
    loadComputeSdk(),
    require('@0gfoundation/0g-compute-ts-sdk'),
    'the SDK was not loaded through require — the ESM entry is the one that breaks on Vercel',
  );
});
