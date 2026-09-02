/**
 * One place that builds a connection to 0G, so there is one place to make it
 * survive an outage.
 *
 * There were eight `new ethers.JsonRpcProvider(...)` calls across this
 * repository, every one of them pointing at a single URL with no fallback, no
 * timeout and no retry. When `evmrpc-testnet.0g.ai` is slow — which is a normal
 * thing for a testnet RPC to be — a mint hangs until the platform kills the
 * function, and the person is shown "The coach service is not running. Start the
 * API (npm start in api/)". On a hosted site that message is both wrong and
 * unactionable.
 *
 * ## Why the fallbacks are configured rather than shipped
 *
 * 0G's own documentation recommends a third-party RPC for production and links
 * QuickNode, ThirdWeb, Ankr and dRPC — all of which issue per-account endpoints
 * behind a signup. There is no public URL to hardcode, and inventing one that
 * looks plausible would be worse than having none: it would fail at the exact
 * moment the fallback was supposed to help, and nothing would say why.
 *
 * So the shape is here and the endpoints are deployment configuration:
 *
 *   OG_RPC_URL            the primary, as before
 *   OG_RPC_FALLBACK_URLS  comma-separated, optional
 *
 * With none set this behaves exactly as the old code did, which is the correct
 * default for a repository somebody has just cloned.
 *
 * ## Quorum one, deliberately
 *
 * `FallbackProvider` defaults to wanting agreement between backends. That is
 * the right default for reading balances and the wrong one here: it makes every
 * call as slow as the slowest healthy endpoint, and a write path that waits for
 * two RPCs to concur is a write path that stalls whenever one of them is
 * behind. Quorum 1 is "first healthy answer wins", which is what a fallback is
 * for.
 */

import { ethers } from 'ethers';

/** How long any single RPC call gets before that endpoint is treated as down. */
export const RPC_TIMEOUT_MS = 12_000;

/** The primary endpoint, and any fallbacks the deployment has configured. */
export function rpcUrls(primary, fallbacks = process.env.OG_RPC_FALLBACK_URLS) {
  const extra = String(fallbacks || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

  // Deduped, because listing the primary again as a fallback would mean an
  // outage is retried against the endpoint that is already down.
  return [primary, ...extra.filter((url) => url !== primary)];
}

/**
 * A provider for 0G that degrades instead of failing.
 *
 * `staticNetwork` is kept from the original calls and matters more here: it
 * stops ethers making a chain-id round trip per provider before the first real
 * request, which on a cold serverless instance is the difference between a
 * response and a timeout.
 */
export function ogProvider(url, chainId, options = {}) {
  const urls = rpcUrls(url, options.fallbacks);

  const build = (endpoint) => {
    const request = new ethers.FetchRequest(endpoint);
    request.timeout = options.timeoutMs ?? RPC_TIMEOUT_MS;
    return new ethers.JsonRpcProvider(request, chainId, { staticNetwork: true });
  };

  if (urls.length === 1) return build(urls[0]);

  return new ethers.FallbackProvider(
    urls.map((endpoint, index) => ({
      provider: build(endpoint),
      // Same priority for all: ethers then prefers whichever answers, rather
      // than insisting on an order that says nothing about which is healthy.
      priority: 1,
      stallTimeout: 2_000,
      weight: index === 0 ? 1 : 1,
    })),
    chainId,
    { quorum: 1 },
  );
}
