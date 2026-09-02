/**
 * The 0G Compute SDK, loaded whichever way works here.
 *
 * The package publishes both builds and points its `import` condition at
 * `lib.esm/index.mjs`, which re-exports named bindings out of a CommonJS chunk.
 * Node decides what a CommonJS chunk exports by scanning it, and that scan
 * differs between Node builds: it succeeds on the machine this was written on
 * and fails on Vercel, where linking the module throws
 *
 *     SyntaxError: Named export 'C' not found. The requested module
 *     './index-28fb2bc1.js' is a CommonJS module
 *
 * and every coach question came back "The coach could not answer" with a 500.
 *
 * So: try the documented entry, and fall back to the CommonJS build the same
 * package ships for exactly this case.
 *
 * ## Why not just `require`
 *
 * Because that was the first fix, and it made things worse in a way worth
 * recording. Vercel decides which files to put in a function by following
 * `import` and `require` specifiers it can read as literals. `await
 * import('@0gfoundation/…')` is one of those; `createRequire(url)('@0gfoundation/…')`
 * is not. Replacing the import with a require left nothing pointing at the
 * package, so the bundler stopped shipping it and the 500 came back as
 *
 *     Cannot find module '@0gfoundation/0g-compute-ts-sdk'
 *
 * The `await import` below is therefore load-bearing twice over: it is the
 * correct way to load the package when it works, and it is the only reason the
 * package is in the bundle for the fallback to find.
 *
 * ## On catchability
 *
 * An earlier note here claimed this failure could not be caught at the call
 * site. That is true of a static `import` declaration, which throws while the
 * module graph links. It is not true of a dynamic `import()`, which rejects its
 * promise — which is what makes the fallback below possible at all.
 */

import { createRequire } from 'node:module';

let cached = null;

export async function loadComputeSdk() {
  if (cached) return cached;

  try {
    cached = await import('@0gfoundation/0g-compute-ts-sdk');
  } catch (e) {
    /*
     * Only the linking failure is worth a second attempt. A package that is
     * genuinely absent fails the same way twice, and swallowing that would turn
     * a missing dependency into a confusing error somewhere further along.
     */
    if (e?.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find module/.test(String(e?.message))) throw e;

    cached = createRequire(import.meta.url)('@0gfoundation/0g-compute-ts-sdk');
  }

  return cached;
}
