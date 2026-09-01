import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ethers } from 'ethers';
import {
  MAX_RELAYS_PER_HOUR,
  MIN_RELAYER_BALANCE,
  RelayError,
  relayEvolve,
  relayMint,
  MAX_STORES_PER_HOUR,
  ABI,
  resetRateLimit,
  resetStoreLimit,
  withinRateLimit,
  withinStoreLimit,
} from './relayer.js';

/**
 * The endpoint that spends our money for strangers.
 *
 * It cannot take anybody's coach — the owner is named inside the signature the
 * contract checks — so what is left to protect is the wallet itself, and the
 * quiet failures: a mint whose id is guessed rather than read, and a relayer
 * that keeps promising to pay after it has run dry.
 */

const OWNER = ethers.Wallet.createRandom().address;
const SIGNATURE = '0x' + '11'.repeat(65);
const CONFIG_HASH = ethers.keccak256(ethers.toUtf8Bytes('profile'));
const URI = 'og://storage/root/abc';

function fakeWallet(balance = ethers.parseEther('1')) {
  return {
    address: '0xRELAYER',
    provider: { getBalance: async () => balance },
  };
}

function fakeContract(overrides = {}) {
  const calls = [];
  return {
    calls,
    interface: {
      parseLog: () => ({ name: 'CoachMinted', args: { tokenId: 42n } }),
    },
    async mintFor(owner, hash, uri, deadline, signature, opts) {
      calls.push({ fn: 'mintFor', owner, hash, uri, deadline, signature, opts });
      return { hash: '0xTX', wait: async () => ({ logs: [{}] }) };
    },
    async evolveFor(owner, tokenId, hash, uri, deadline, signature, opts) {
      calls.push({ fn: 'evolveFor', owner, tokenId, opts });
      return { hash: '0xTX2', wait: async () => ({}) };
    },
    ...overrides,
  };
}

const ok = () => true;

/**
 * The ABI must name every function the relay paths call.
 *
 * Every other test here uses a fake contract, which answers to anything — so
 * an ABI missing an entry passes the whole suite and fails in production with
 * a 502 the first time somebody uses the feature. That happened to
 * setRentalPriceFor; this is the test that would have caught it.
 */
test('the ABI covers every contract call the relayer makes', async () => {
  const source = await readFile(new URL('./relayer.js', import.meta.url), 'utf8');

  const called = [...source.matchAll(/contract[.]([a-zA-Z_][a-zA-Z0-9_]*)[(]/g)].map((m) => m[1]);
  assert.ok(called.length > 0, 'found no contract calls to check — the pattern must have drifted');

  for (const fn of new Set(called)) {
    assert.ok(
      ABI.some((entry) => entry.includes(`function ${fn}(`)),
      `relayer.js calls contract.${fn}() but the ABI does not declare it`,
    );
  }
});

beforeEach(async () => {
  await resetRateLimit();
});

// ------------------------------------------------------------------- minting

test('it mints for the address in the request, never for itself', async () => {
  /*
   * The contract enforces this — the owner is inside the signed message — but
   * the relayer must not even try, or a bug here becomes a support case about
   * coaches appearing in the wrong account.
   */
  const contract = fakeContract();
  const result = await relayMint(
    { owner: OWNER, configHash: CONFIG_HASH, configURI: URI, deadline: 1n, signature: SIGNATURE },
    { wallet: fakeWallet(), contract, withinRateLimit: ok },
  );

  assert.equal(contract.calls[0].owner, OWNER);
  assert.equal(result.tokenId, '42');
  assert.equal(result.txHash, '0xTX');
});

test('the token id is read from the event, not assumed', async () => {
  // `mintFor` returns a value to another contract; to us it returns a
  // transaction. Guessing "the newest id" is a race against everybody else
  // minting in the same block, and the prize for losing is somebody else's coach.
  const contract = fakeContract({
    interface: { parseLog: () => ({ name: 'SomethingElse', args: {} }) },
  });

  await assert.rejects(
    () =>
      relayMint(
        { owner: OWNER, configHash: CONFIG_HASH, configURI: URI, deadline: 1n, signature: SIGNATURE },
        { wallet: fakeWallet(), contract, withinRateLimit: ok },
      ),
    (error) => error instanceof RelayError && error.code === 'no_token_id',
  );
});

test('it sends a gas price 0G will accept', async () => {
  // Galileo refuses anything under 2 gwei and the library's own estimate comes
  // back below that — found by having transactions rejected, not from a doc.
  const contract = fakeContract();
  await relayMint(
    { owner: OWNER, configHash: CONFIG_HASH, configURI: URI, deadline: 1n, signature: SIGNATURE },
    { wallet: fakeWallet(), contract, withinRateLimit: ok },
  );

  assert.ok(contract.calls[0].opts.gasPrice >= 2_000_000_000n);
});

// ------------------------------------------------------------------ the money

test('it refuses before spending when the wallet is nearly empty', async () => {
  /*
   * A relayer that runs to zero mid-transaction leaves somebody staring at a
   * failure they cannot act on, and takes the people already mid-flow with it.
   */
  const contract = fakeContract();

  await assert.rejects(
    () =>
      relayMint(
        { owner: OWNER, configHash: CONFIG_HASH, configURI: URI, deadline: 1n, signature: SIGNATURE },
        { wallet: fakeWallet(MIN_RELAYER_BALANCE - 1n), contract, withinRateLimit: ok },
      ),
    (error) => error.code === 'relayer_empty' && error.status === 503,
  );

  assert.equal(contract.calls.length, 0, 'and it must not have tried');
});

test('one address cannot drain the wallet', async () => {
  // Generous for a person, useless for a script: a coach is minted once and
  // evolves every few sessions.
  const now = 1_700_000_000_000;

  for (let i = 0; i < MAX_RELAYS_PER_HOUR; i += 1) {
    assert.equal(await withinRateLimit(OWNER, now + i), true, `relay ${i} should be allowed`);
  }

  assert.equal(await withinRateLimit(OWNER, now + MAX_RELAYS_PER_HOUR), false, 'and then it stops');
});

test('the limit is per address, not global', async () => {
  // One busy person must not lock everybody else out.
  const now = 1_700_000_000_000;
  const other = ethers.Wallet.createRandom().address;

  for (let i = 0; i < MAX_RELAYS_PER_HOUR; i += 1) await withinRateLimit(OWNER, now + i);

  assert.equal(await withinRateLimit(OWNER, now + 100), false);
  assert.equal(await withinRateLimit(other, now + 100), true);
});

test('the limit lets go after an hour', async () => {
  const now = 1_700_000_000_000;
  for (let i = 0; i < MAX_RELAYS_PER_HOUR; i += 1) await withinRateLimit(OWNER, now + i);

  assert.equal(await withinRateLimit(OWNER, now + 100), false);
  assert.equal(await withinRateLimit(OWNER, now + 60 * 60 * 1000 + 1), true);
});

test('a rate-limited request never reaches the chain', async () => {
  const contract = fakeContract();

  await assert.rejects(
    () =>
      relayMint(
        { owner: OWNER, configHash: CONFIG_HASH, configURI: URI, deadline: 1n, signature: SIGNATURE },
        { wallet: fakeWallet(), contract, withinRateLimit: () => false },
      ),
    (error) => error.status === 429,
  );

  assert.equal(contract.calls.length, 0);
});

// ------------------------------------------------------------------- garbage

test('rubbish is refused before it costs anything', async () => {
  const contract = fakeContract();
  const wallet = fakeWallet();

  const cases = [
    [{ owner: 'not-an-address' }, 'address'],
    [{ signature: '0x1234' }, 'signature'],
    [{ configHash: 'nope' }, 'hash'],
    [{ configURI: '' }, 'uri'],
  ];

  for (const [override] of cases) {
    await assert.rejects(
      () =>
        relayMint(
          {
            owner: OWNER,
            configHash: CONFIG_HASH,
            configURI: URI,
            deadline: 1n,
            signature: SIGNATURE,
            ...override,
          },
          { wallet, contract, withinRateLimit: ok },
        ),
      (error) => error instanceof RelayError && error.status === 400,
    );
  }

  assert.equal(contract.calls.length, 0, 'none of it reached the chain');
});

// ------------------------------------------------------------------ evolving

test('the flywheel relays too, and is limited the same way', async () => {
  const contract = fakeContract();

  const result = await relayEvolve(
    {
      owner: OWNER,
      tokenId: '42',
      configHash: CONFIG_HASH,
      configURI: URI,
      deadline: 1n,
      signature: SIGNATURE,
    },
    { wallet: fakeWallet(), contract, withinRateLimit: ok },
  );

  assert.equal(result.txHash, '0xTX2');
  assert.equal(contract.calls[0].fn, 'evolveFor');
  assert.equal(contract.calls[0].owner, OWNER);

  await assert.rejects(
    () =>
      relayEvolve(
        {
          owner: OWNER,
          tokenId: '42',
          configHash: CONFIG_HASH,
          configURI: URI,
          deadline: 1n,
          signature: SIGNATURE,
        },
        { wallet: fakeWallet(), contract, withinRateLimit: () => false },
      ),
    (error) => error.status === 429,
  );
});

test('the storage endpoint cannot be used to drain the wallet', async () => {
  /*
   * The hole this closes. Uploading to 0G Storage costs us gas, and the
   * endpoint that does it has to accept whatever arrives — it is encrypted, so
   * there is nothing to inspect. Without a limit it is an open invitation to
   * spend the wallet a megabyte at a time, and unlike the relay endpoints there
   * is no signature to key on.
   */
  await resetStoreLimit();
  const caller = '203.0.113.7';
  const now = 1_700_000_000_000;

  for (let i = 0; i < MAX_STORES_PER_HOUR; i += 1) {
    assert.equal(await withinStoreLimit(caller, now + i), true, `upload ${i} should be allowed`);
  }

  assert.equal(await withinStoreLimit(caller, now + MAX_STORES_PER_HOUR), false, 'and then it stops');
});

test('one noisy caller does not lock everybody else out of storage', async () => {
  await resetStoreLimit();
  const now = 1_700_000_000_000;

  for (let i = 0; i < MAX_STORES_PER_HOUR; i += 1) await withinStoreLimit('203.0.113.7', now + i);

  assert.equal(await withinStoreLimit('203.0.113.7', now + 100), false);
  assert.equal(await withinStoreLimit('198.51.100.4', now + 100), true);
});

test('the storage limit lets go after an hour', async () => {
  await resetStoreLimit();
  const now = 1_700_000_000_000;
  for (let i = 0; i < MAX_STORES_PER_HOUR; i += 1) await withinStoreLimit('203.0.113.7', now + i);

  assert.equal(await withinStoreLimit('203.0.113.7', now + 100), false);
  assert.equal(await withinStoreLimit('203.0.113.7', now + 60 * 60 * 1000 + 1), true);
});
