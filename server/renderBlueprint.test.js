/*
 * The Render blueprint points at a Dockerfile that exists, in a context that
 * can build it.
 *
 * This exists because it did not. `api/Dockerfile` was moved to `server/` when
 * the server was made stateless and `api/` became the single-file Vercel entry
 * point; render.yaml kept pointing at the old path. Every autoDeploy after that
 * failed with "Exited with status 1" for five days, and nobody noticed, because
 * the live app is served entirely by Vercel and nothing on a user's path goes
 * through Render. It surfaced as an email, not as a test.
 *
 * A build failure is the cheapest kind of wrong to catch and the easiest to
 * leave rotting: nothing breaks, so nothing complains. Reading the blueprint is
 * not the same as building the image — Docker is not available here — but every
 * failure this has actually had was a path that did not exist, and that is
 * checkable from the file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const blueprint = readFileSync(path.join(root, 'render.yaml'), 'utf8');

/** The value of a `key: value` line, ignoring comments. YAML enough for this. */
const field = (name) => {
  const line = blueprint
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .find((l) => l.trim().startsWith(name + ':'));
  return line ? line.split(':').slice(1).join(':').trim() : null;
};

const resolve = (p) => path.join(root, p.replace(/^\.\//, ''));

test('the blueprint names a Dockerfile that is in the repository', () => {
  const dockerfilePath = field('dockerfilePath');
  assert.ok(dockerfilePath, 'render.yaml has no dockerfilePath');
  assert.ok(
    existsSync(resolve(dockerfilePath)),
    `render.yaml builds ${dockerfilePath}, which does not exist`,
  );
});

test('the build context exists, and holds the Dockerfile', () => {
  const context = field('dockerContext');
  const dockerfilePath = field('dockerfilePath');
  assert.ok(context, 'render.yaml has no dockerContext');
  assert.ok(existsSync(resolve(context)), `dockerContext ${context} does not exist`);

  // Docker cannot COPY from outside its context, so a Dockerfile sitting
  // somewhere else is a build that fails on its first COPY.
  const rel = path.relative(resolve(context), resolve(dockerfilePath));
  assert.ok(
    !rel.startsWith('..'),
    `${dockerfilePath} is outside the build context ${context}`,
  );
});

test('every path the Dockerfile copies is inside the context', () => {
  const context = resolve(field('dockerContext'));
  const dockerfile = readFileSync(resolve(field('dockerfilePath')), 'utf8');

  const missing = [];
  for (const line of dockerfile.split('\n')) {
    if (!line.startsWith('COPY ')) continue;
    // The last token is the destination inside the image, not a source.
    const sources = line.slice(5).trim().split(/\s+/).slice(0, -1);
    for (const src of sources) {
      // `package-lock.json*` is deliberately optional — that is what the
      // trailing glob means to Docker, and it must not be read as missing.
      if (src.endsWith('*')) continue;
      if (!existsSync(path.join(context, src))) missing.push(src);
    }
  }

  assert.deepEqual(missing, [], `the build context does not contain: ${missing.join(', ')}`);
});

test('the service still declares a health check the server answers', () => {
  const health = field('healthCheckPath');
  assert.ok(health, 'no healthCheckPath — Render cannot tell a dead container from a slow one');
  const server = readFileSync(path.join(root, 'server', 'server.js'), 'utf8');
  assert.ok(
    server.includes(health),
    `render.yaml health-checks ${health}, which server.js does not serve`,
  );
});
