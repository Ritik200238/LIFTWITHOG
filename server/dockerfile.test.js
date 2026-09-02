import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

/**
 * The image has to contain every file the server imports.
 *
 * The Dockerfile copies an explicit list rather than the directory, which is
 * right — it keeps tests, fixtures and stray files out of the image — and it
 * has now failed the same way three times. Each time the build succeeded, the
 * image was pushed, and the container died at boot on "Cannot find module",
 * because nothing connects the list to the imports.
 *
 * The comment above that line already records the first two. This is the check
 * the comment could not be.
 */
test('the Dockerfile copies every module the server imports', async () => {
  const dockerfile = await readFile(new URL('./Dockerfile', import.meta.url), 'utf8');

  const copyLine = dockerfile
    .split('\n')
    .find((line) => line.startsWith('COPY') && line.includes('server.js'));

  assert.ok(copyLine, 'no COPY line naming server.js — the Dockerfile has changed shape');

  const copied = new Set(
    copyLine
      .replace(/^COPY\s+/, '')
      .split(/\s+/)
      .filter((word) => word.endsWith('.js')),
  );

  /*
   * Walked from every shipped file rather than from server.js alone, because a
   * module reached two hops down is exactly as missing as one reached directly
   * — and that is the case that took the longest to find.
   */
  const here = new URL('./', import.meta.url);
  const local = (await readdir(here)).filter(
    (name) => name.endsWith('.js') && !name.endsWith('.test.js'),
  );

  const required = new Set();

  for (const name of local) {
    if (!copied.has(name)) continue;

    const source = await readFile(new URL(name, here), 'utf8');
    for (const [, spec] of source.matchAll(/from\s+'(\.\/[^']+)'/g)) {
      required.add(spec.replace('./', ''));
    }
    // Dynamic imports count: `await import('./x.js')` fails at run time just as
    // loudly, and later, which is worse.
    for (const [, spec] of source.matchAll(/import\(\s*'(\.\/[^']+)'\s*\)/g)) {
      required.add(spec.replace('./', ''));
    }
  }

  assert.ok(required.size > 0, 'found no local imports at all — the pattern must have drifted');

  const missing = [...required].filter((name) => !copied.has(name));
  assert.deepEqual(missing, [], `the Dockerfile does not copy: ${missing.join(', ')}`);
});
