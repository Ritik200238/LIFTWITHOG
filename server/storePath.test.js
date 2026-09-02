import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultDataDir } from './store.js';

/**
 * Where the server writes when nothing tells it where to write.
 *
 * The default was `/data`, which is correct inside the container and wrong
 * everywhere else in two different directions. On a Linux runner it is
 * root-owned, so the first CI run died on `EACCES: mkdir '/data'` before a
 * single server test executed. On Windows the same string resolves to the root
 * of the current drive, where it had been quietly collecting 0G storage blobs
 * for weeks — a directory nobody asked for, in a place nobody would look.
 *
 * Both symptoms came from one habit: modules that build a store as a side
 * effect of being imported. These two tests are about that habit rather than
 * about the path.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('the default store path is inside the server, not at the root of a disk', () => {
  const previous = process.env.DATA_DIR;
  delete process.env.DATA_DIR;

  try {
    const dir = defaultDataDir();

    assert.equal(
      path.resolve(dir).startsWith(path.resolve(HERE)),
      true,
      `the default store path escaped the server directory: ${dir}`,
    );

    /*
     * Named rather than merely implied. The container sets DATA_DIR to /data
     * and mounts a disk there, so production keeps the path it has always had;
     * what must not come back is /data arriving by default on a machine that
     * has no such mount.
     */
    assert.notEqual(path.resolve(dir), path.resolve('/data'));
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
  }
});

test('DATA_DIR still wins, because the container depends on it', () => {
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = '/somewhere/else';

  try {
    assert.equal(defaultDataDir(), '/somewhere/else');
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
  }
});

test('importing a module does not create a directory', async () => {
  /*
   * The actual defect. `x402.js` called createStore() at module scope, so
   * reading the file made a directory — which is why the failure appeared in a
   * test that never touches storage, and why it appeared at import rather than
   * at any call.
   *
   * A fresh, non-existent DATA_DIR is the whole test: import the modules that
   * own a store, then assert nothing was written. If the store is built eagerly
   * again, the directory appears and this fails.
   */
  const probe = path.join(HERE, '.data-import-probe');
  fs.rmSync(probe, { recursive: true, force: true });

  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = probe;

  try {
    // Cache-busted so this is a real import even when the suite loaded them already.
    const bust = `?probe=${Date.now()}`;
    await import(`./x402.js${bust}`);
    await import(`./progressCard.js${bust}`);
    await import(`./referral.js${bust}`);

    assert.equal(
      fs.existsSync(probe),
      false,
      'importing a module created its storage directory as a side effect',
    );
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    fs.rmSync(probe, { recursive: true, force: true });
  }
});
