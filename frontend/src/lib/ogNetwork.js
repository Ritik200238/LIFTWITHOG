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
/*
 * Both real networks, written out in full rather than assembled from parts.
 * A chain id paired with the wrong RPC is the worst kind of wrong — every
 * read works and every signature is for somewhere else — so the two are
 * only ever selected together.
 */
const NETWORKS = {
  testnet: {
    name: '0G Galileo Testnet',
    rpcUrl: 'https://evmrpc-testnet.0g.ai',
    chainId: 16602,
    currency: '0G',
    explorer: 'https://chainscan-galileo.0g.ai',
    storageIndexer: 'https://indexer-storage-testnet-turbo.0g.ai',
    testnet: true,
  },
  mainnet: {
    name: '0G Mainnet (Aristotle)',
    rpcUrl: 'https://evmrpc.0g.ai',
    chainId: 16661,
    currency: '0G',
    explorer: 'https://chainscan.0g.ai',
    storageIndexer: 'https://indexer-storage-turbo.0g.ai',
    testnet: false,
  },
}

// Chosen at build time. Defaults to testnet, because the failure mode of the
// other default is an app accidentally asking people to spend real money.
export const OG_NETWORK = NETWORKS[import.meta.env.VITE_OG_NETWORK] || NETWORKS.testnet
