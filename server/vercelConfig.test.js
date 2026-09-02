import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/**
 * vercel.json has to be a config Vercel will accept.
 *
 * It is JSON with no schema check in this repository and no test around it, so
 * a plausible-looking addition is only rejected at deploy time — by which point
 * the deploy has already failed and the site is serving the previous build.
 * That happened: a `"//"` key was added as a comment, which is a common JSON
 * convention and which Vercel refuses outright with "should NOT have additional
 * property". Every deploy would have failed until somebody read the error.
 */
test('vercel.json carries only keys Vercel accepts', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));

  /*
   * From Vercel's project-configuration reference. Deliberately a closed list:
   * an unknown key is the failure mode being caught, so an allowlist is the
   * only shape that catches it.
   */
  const allowed = new Set([
    '$schema', 'buildCommand', 'outputDirectory', 'installCommand', 'devCommand',
    'framework', 'rewrites', 'redirects', 'headers', 'cleanUrls', 'trailingSlash',
    'crons', 'functions', 'regions', 'public', 'git', 'images', 'ignoreCommand',
  ]);

  const unknown = Object.keys(config).filter((k) => !allowed.has(k));
  assert.deepEqual(unknown, [], `vercel.json has keys Vercel will reject: ${unknown.join(', ')}`);

  // Comments are not a thing in this file, however tempting.
  const asText = JSON.stringify(config);
  assert.ok(!asText.includes('"//"'), 'a "//" comment key will be rejected at deploy time');

  // The API function needs longer than the storage timeout it waits on.
  const maxDuration = config.functions?.['api/index.js']?.maxDuration;
  assert.ok(maxDuration >= 90, 'the API function needs room for a 0G Storage write to finalise');
});
