/**
 * Which chain this build talks to, with nothing attached.
 *
 * Its own module for the same reason as `coachConfig.js`: this lived in
 * `ogVault.js`, which imports ethers and the 0G storage SDK, so anything
 * wanting the chain id — the device key, for the signing domain — dragged
 * about a megabyte of JavaScript onto the first-paint path to read a number.
 *
 * One definition, still. `ogVault` re-exports this rather than declaring its
 * own, because two copies of a chain id is exactly how signatures end up
 * being made for a chain nobody is on.
 */
export const OG_NETWORK = {
  name: '0G Galileo Testnet',
  rpcUrl: 'https://evmrpc-testnet.0g.ai',
  chainId: 16602,
  currency: '0G',
  explorer: 'https://chainscan-galileo.0g.ai',
  storageIndexer: 'https://indexer-storage-testnet-turbo.0g.ai',
}
