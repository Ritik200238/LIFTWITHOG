import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';

import { RPC_TIMEOUT_MS, ogProvider, rpcUrls } from './ogProvider.js';

/**
 * What happens when 0G's RPC is having a bad afternoon.
 *
 * Every provider in this repository used to be a single URL with no fallback,
 * no timeout and no retry, and the failure was not "a read returns stale data"
 * — it was a mint hanging until the platform killed the function, after which
 * the app told the person to run `npm start in api/` on a site they do not host.
 */

const PRIMARY = 'https://evmrpc-testnet.0g.ai';

test('with nothing configured, it behaves exactly as before', () => {
  /*
   * The right default for a fresh clone. A FallbackProvider wrapping one
   * endpoint would add a scheduling layer and change nothing about resilience.
   */
  assert.deepEqual(rpcUrls(PRIMARY, ''), [PRIMARY]);
  assert.ok(ogProvider(PRIMARY, 16602, { fallbacks: '' }) instanceof ethers.JsonRpcProvider);
});

test('configured fallbacks are used, in order, ignoring whitespace and blanks', () => {
  assert.deepEqual(
    rpcUrls(PRIMARY, ' https://a.example , , https://b.example '),
    [PRIMARY, 'https://a.example', 'https://b.example'],
  );
});

test('the primary is never also listed as its own fallback', () => {
  /*
   * Otherwise an outage is retried against the endpoint that is already down,
   * which is the one thing a fallback list must not do.
   */
  assert.deepEqual(rpcUrls(PRIMARY, `https://a.example,${PRIMARY}`), [PRIMARY, 'https://a.example']);
});

test('more than one endpoint gets a fallback provider, at quorum one', () => {
  /*
   * Quorum matters more than it looks. FallbackProvider's default wants
   * agreement between backends, which makes every call as slow as the slowest
   * healthy one — and a write path waiting for two RPCs to concur stalls
   * whenever either is behind. One is "first healthy answer wins", which is the
   * entire point of having a fallback.
   */
  const provider = ogProvider(PRIMARY, 16602, { fallbacks: 'https://a.example' });

  assert.ok(provider instanceof ethers.FallbackProvider);
  assert.equal(provider.quorum, 1);
  assert.equal(provider.providerConfigs.length, 2);
});

test('every endpoint carries a timeout, because node fetch has none', () => {
  /*
   * Without this a provider that accepts a connection and never answers holds
   * the request open until something else gives up — on a serverless function,
   * that is the platform, and the user sees a 502 with no cause attached.
   */
  const provider = ogProvider(PRIMARY, 16602, { fallbacks: 'https://a.example', timeoutMs: 1234 });

  for (const config of provider.providerConfigs) {
    assert.equal(config.provider._getConnection().timeout, 1234);
  }

  const single = ogProvider(PRIMARY, 16602, { fallbacks: '' });
  assert.equal(single._getConnection().timeout, RPC_TIMEOUT_MS);
});

test('the chain id is pinned so a fallback cannot silently be another network', async () => {
  /*
   * The worst available outcome from adding fallbacks: an endpoint that answers
   * perfectly well about a different chain. Every read succeeds, every
   * signature is for somewhere nobody is.
   *
   * Asked through `getNetwork()` rather than by reaching into a private field —
   * this must resolve without touching the network, which is the other half of
   * what pinning it buys.
   */
  const both = await ogProvider(PRIMARY, 16602, { fallbacks: 'https://a.example' }).getNetwork();
  assert.equal(Number(both.chainId), 16602);

  const single = await ogProvider(PRIMARY, 16661, { fallbacks: '' }).getNetwork();
  assert.equal(Number(single.chainId), 16661);
});
