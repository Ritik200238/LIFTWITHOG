/**
 * The 0G Compute SDK, loaded through `require` rather than `import`.
 *
 * The package ships both builds and points its `import` condition at
 * `lib.esm/index.mjs`, which re-exports named bindings out of a CommonJS chunk.
 * Node's ESM loader rejects that while linking the module:
 *
 *     SyntaxError: Named export 'C' not found. The requested module
 *     './index-28fb2bc1.js' is a CommonJS module
 *
 * That is a defect in the package rather than in how it is called, and it is
 * not catchable at the call site: the throw happens before any of the module's
 * exports exist.
 *
 * It also did not reproduce locally, which is the part worth remembering. Node
 * here resolved the CommonJS build and Vercel's bundle resolved the ESM one, so
 * every coach question in production answered "The coach could not answer" for
 * a fault no test on this machine could see. `createRequire` pins the build
 * that works, in both places.
 *
 * This lives in its own file because both callers need it and they already
 * point at each other: coach-runtime imports attestation for `signatureFor`,
 * and attestation needs the SDK. Putting the loader in either one makes that a
 * cycle, which ESM tolerates and nobody should have to reason about.
 */

import { createRequire } from 'node:module';

let cached = null;

export function loadComputeSdk() {
  if (cached) return cached;
  cached = createRequire(import.meta.url)('@0gfoundation/0g-compute-ts-sdk');
  return cached;
}
