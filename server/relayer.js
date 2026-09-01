/**
 * Paying the fee so that somebody who lifts weights does not need a coin.
 *
 * The device holds a key it generated and never showed anybody. It signs; this
 * submits and pays. The coach belongs to the device's address, and this cannot
 * change that — the owner is named inside the signed message, so the worst a
 * broken or hostile relayer can do is refuse to help.
 *
 * What it can do is spend our money, which is what most of this file is about.
 */

import { ethers } from 'ethers';
import { createStore } from './store.js';

export const OG_RPC = process.env.OG_RPC_URL || 'https://evmrpc-testnet.0g.ai';
// Mainnet (Aristotle) is 16661, Galileo testnet 16602. The id must move with
// the RPC or every signature is for a chain nobody is on — so it defaults by
// looking at which RPC was chosen, and OG_CHAIN_ID overrides for anything else.
export const OG_CHAIN_ID = +(process.env.OG_CHAIN_ID || (OG_RPC === 'https://evmrpc.0g.ai' ? 16661 : 16602));
export const COACH_ADDRESS = process.env.COACH_ADDRESS || '';

/**
 * 0G Galileo rejects anything under 2 gwei, and ethers' own estimate comes back
 * below that. Found by having deployments refused, not by reading it anywhere.
 */
export const GAS_PRICE = 5_000_000_000n;

/** Stop relaying below this, so the wallet cannot be drained to a dead stop. */
export const MIN_RELAYER_BALANCE = ethers.parseEther('0.05');

const ABI = [
  'function mintFor(address owner,bytes32 configHash,string configURI,uint256 deadline,bytes signature) returns (uint256)',
  'function evolveFor(address owner,uint256 tokenId,bytes32 configHash,string configURI,uint256 deadline,bytes signature)',
  'function nonceOf(address signer) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'event CoachMinted(uint256 indexed tokenId,address indexed owner,bytes32 configHash)',
];

export class RelayError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * How often one address may be relayed for.
 *
 * The endpoint spends our funds on behalf of anybody who asks, so it needs a
 * limit that is generous for a person and useless for a script. A coach is
 * minted once and evolves every few sessions; a dozen an hour is far past what
 * training produces and far below what draining a wallet requires.
 */
export const MAX_RELAYS_PER_HOUR = 12;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Uploads we will pay for, per caller, per hour.
 *
 * Storing on 0G Storage costs us gas, and the endpoint that does it accepts
 * anything — it has to, since the blob arrives encrypted and we cannot look
 * inside to see whether it is a coach. Without a limit it is an open invitation
 * to spend our wallet a megabyte at a time.
 *
 * Higher than the relay limit because a mint stores once and then relays, and a
 * retry after a failed upload should not be what runs somebody out.
 */
export const MAX_STORES_PER_HOUR = 20;

/**
 * Questions we will pay a model to answer, per address, per hour.
 *
 * Renting is a one-off payment and inference is a running cost, so without this
 * a single month's rent buys unlimited calls and the arithmetic of the whole
 * marketplace stops working. Sixty is far more than somebody planning a workout
 * asks and far less than a loop.
 */
export const MAX_QUESTIONS_PER_HOUR = 60;

/**
 * The counters live in the store, not in this process.
 *
 * They used to be module-level Maps, which was correct for exactly one
 * deployment shape and quietly wrong for the one actually running. On
 * serverless every cold instance began at zero, so the cap protecting the
 * relayer's balance was really "twelve per hour per instance an attacker can
 * cause to exist". That is a wallet-draining bug the moment the wallet holds
 * real money — which mainnet makes true.
 */
const limiter = createStore();

/** `now` stays injectable so a test can cross a window boundary without waiting an hour. */
const allow = (bucket, key, max, now = Date.now()) =>
  limiter.limit({ bucket, key: String(key ?? 'unknown').toLowerCase(), max, windowMs: HOUR_MS, now });

/**
 * Rate limit by whatever identifies the caller.
 *
 * An address when one is known, an IP otherwise. The storage endpoint has no
 * address to key on — the upload happens before there is anything signed — so
 * this is deliberately coarse: it is a cost control, not an authorisation.
 */
export const withinStoreLimit = (caller, now) => allow('store', caller, MAX_STORES_PER_HOUR, now);

export const withinQuestionLimit = (caller, now) => allow('question', caller, MAX_QUESTIONS_PER_HOUR, now);

export const withinRateLimit = (caller, now) => allow('relay', caller, MAX_RELAYS_PER_HOUR, now);

/** For tests, and for a fresh instance to start from a known state. */
export const resetRateLimit = () => limiter.resetLimits();
export const resetStoreLimit = () => limiter.resetLimits();
export const resetQuestionLimit = () => limiter.resetLimits();

export function relayerWallet() {
  const key = process.env.RELAYER_PRIVATE_KEY || process.env.COACH_SERVICE_KEY;
  if (!key) throw new RelayError(503, 'not_configured', 'This server has no relayer key, so it cannot pay the fee. Set RELAYER_PRIVATE_KEY in api/.env — see the README.');

  const provider = new ethers.JsonRpcProvider(OG_RPC, OG_CHAIN_ID, { staticNetwork: true });
  return new ethers.Wallet(key, provider);
}

export function coachContract(wallet) {
  if (!COACH_ADDRESS) {
    throw new RelayError(503, 'not_configured', 'No coach contract is configured on this server.');
  }
  return new ethers.Contract(COACH_ADDRESS, ABI, wallet);
}

/**
 * Refuse before spending, when the wallet is nearly empty.
 *
 * A relayer that runs to zero mid-transaction leaves somebody staring at a
 * failure they cannot act on. Refusing early at least says what is wrong, and
 * leaves enough to keep serving the people already mid-flow.
 */
async function assertFunded(wallet) {
  const balance = await wallet.provider.getBalance(wallet.address);
  if (balance < MIN_RELAYER_BALANCE) {
    throw new RelayError(
      503,
      'relayer_empty',
      'The service wallet is too low to sponsor transactions right now.',
    );
  }
}

function requireSignature(signature) {
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new RelayError(400, 'bad_request', 'That is not a signature.');
  }
}

function requireOwner(owner) {
  if (!ethers.isAddress(owner)) throw new RelayError(400, 'bad_request', 'That is not an address.');
  return ethers.getAddress(owner);
}

/**
 * Submit a signed mint. The coach belongs to `owner`, whatever we do.
 */
export async function relayMint({ owner, configHash, configURI, deadline, signature }, deps = {}) {
  const address = requireOwner(owner);
  requireSignature(signature);

  if (!/^0x[0-9a-fA-F]{64}$/.test(String(configHash))) {
    throw new RelayError(400, 'bad_request', 'That is not a config hash.');
  }
  if (!configURI || String(configURI).length > 512) {
    throw new RelayError(400, 'bad_request', 'That is not a config location.');
  }

  if (!(await (deps.withinRateLimit ?? withinRateLimit)(address))) {
    throw new RelayError(429, 'too_many', 'That is more coaches than anybody needs in an hour.');
  }

  const wallet = deps.wallet ?? relayerWallet();
  await assertFunded(wallet);

  const contract = deps.contract ?? coachContract(wallet);

  const tx = await contract.mintFor(address, configHash, configURI, deadline, signature, {
    gasPrice: GAS_PRICE,
  });
  const receipt = await tx.wait();

  /*
   * Read the id from the event rather than assuming the newest. `mintFor`
   * returns a value to another contract; to us it returns a transaction, and
   * guessing "the last one" is a race against everybody else minting in the
   * same block.
   */
  let tokenId = null;
  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === 'CoachMinted') tokenId = parsed.args.tokenId;
    } catch {
      // A log from another contract in the same transaction.
    }
  }

  if (tokenId === null) {
    throw new RelayError(502, 'no_token_id', 'The coach was minted but its id could not be read.');
  }

  return { tokenId: tokenId.toString(), txHash: tx.hash };
}

/** Submit a signed evolve — the flywheel, running in the background. */
export async function relayEvolve(
  { owner, tokenId, configHash, configURI, deadline, signature },
  deps = {},
) {
  const address = requireOwner(owner);
  requireSignature(signature);

  if (!(await (deps.withinRateLimit ?? withinRateLimit)(address))) {
    throw new RelayError(429, 'too_many', 'That coach has learned enough for one hour.');
  }

  const wallet = deps.wallet ?? relayerWallet();
  await assertFunded(wallet);

  const contract = deps.contract ?? coachContract(wallet);

  const tx = await contract.evolveFor(
    address,
    tokenId,
    configHash,
    configURI,
    deadline,
    signature,
    { gasPrice: GAS_PRICE },
  );
  await tx.wait();

  return { txHash: tx.hash };
}
