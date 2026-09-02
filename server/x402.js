/**
 * A coach another agent can hire, over HTTP.
 *
 * Everything else here assumes a person: a browser, a device key, a screen. This
 * is the same coach exposed the way software buys things — an endpoint that
 * answers **HTTP 402 Payment Required** with what it costs and where to pay,
 * accepts a transaction hash, verifies it on chain, and then does the work.
 *
 * Why it is worth having. Renting a coach is already an on-chain action with an
 * expiry and a payment that reaches the trainer inside the same transaction, so
 * the hard part — a payment rail with settlement — exists. What was missing was
 * a way for something that is not a browser to discover the price and pay it.
 * Paired with the ERC-8004 registration, that makes this coach hireable by any
 * agent that can read an agent card, without us shipping anything else.
 *
 * ## Where this differs from the one implementation that exists
 *
 * Talos verifies payment by scanning for an ERC-20 `Transfer` to an address it
 * expects. That works, and it trusts a token contract it does not control: a
 * token whose `transfer` emits whatever it likes satisfies the check.
 *
 * This verifies **our own contract's `Rented` event**, from our own address,
 * and then confirms the access it granted is still live by asking the chain
 * directly. A forged event would have to come from our contract.
 *
 * ## Replay
 *
 * A transaction hash is a bearer token — anybody watching the chain sees it the
 * moment it lands. Two things stop it being reused: the payment must name the
 * caller as the renter, and each hash is consumed once. Consumed rather than
 * rejected, because an agent retrying a request whose response it never
 * received should get the answer it paid for, not a 409 for a job it completed.
 */

import { ethers } from 'ethers';
import { CoachError, OG_CHAIN_ID, OG_RPC, coachReader, defaultProvider } from './coach.js';
import { createStore } from './store.js';

/**
 * The idempotency store, made on first use rather than on import.
 *
 * A module that creates its store at import time does filesystem work as a
 * side effect of being read. Importing this file to test a pure function, or to
 * check that the image copies it, created a directory — and on a Linux runner,
 * where the old default was root-owned, importing it failed before a single
 * test ran.
 */
let _store = null;
const store = () => (_store ??= createStore());

/** The event our contract emits when somebody pays for access. */
const RENTED = 'event Rented(uint256 indexed tokenId, address indexed renter, uint64 expiresAt, uint256 paid)';

/** How long a quote is good for. Long enough to sign and send, short enough to mean something. */
const QUOTE_TTL_MS = 10 * 60 * 1000;

const jobKey = (txHash) => `x402:${String(txHash).toLowerCase()}`;

/**
 * What it costs to hire this coach, and where to pay.
 *
 * Returned with a 402 by the route. The shape follows x402's convention closely
 * enough for a generic client to read it, and adds what a caller needs to build
 * the transaction itself: our contract, the function, and the price per day.
 */
export async function quote(tokenId, deps = {}) {
  const contract = deps.contract ?? coachReader(deps.provider ?? defaultProvider());

  let pricePerDay;
  let owner;
  try {
    [pricePerDay, owner] = await Promise.all([contract.rentalPrice(tokenId), contract.ownerOf(tokenId)]);
  } catch {
    throw new CoachError(404, 'no_such_coach', `No coach ${tokenId}.`);
  }

  if (pricePerDay === 0n) {
    /*
     * Not for rent is a different answer from "you have not paid". A caller
     * told 402 for a coach nobody can rent would retry forever.
     */
    throw new CoachError(409, 'not_for_rent', 'That coach is not listed for rent.');
  }

  const now = deps.now ?? Date.now();

  return {
    x402Version: 1,
    resource: `coach/${tokenId}`,
    description: 'One question answered by this coach, inside a TEE-attested enclave on 0G Compute.',
    serviceName: 'coach_advice',
    fulfillmentMode: 'instant',

    network: OG_CHAIN_ID === 16661 ? '0g-aristotle' : '0g-galileo',
    chainId: OG_CHAIN_ID,
    rpc: OG_RPC,

    // Pay by calling our contract, not by transferring to an address. The
    // payment and the access it buys are the same transaction.
    payTo: contract.target ?? deps.address ?? null,
    payVia: 'function rent(uint256 tokenId, uint256 dayCount) payable',
    asset: 'native',
    currency: '0G',
    pricePerDay: pricePerDay.toString(),
    minimumDays: 1,
    payee: owner,

    expiresAt: now + QUOTE_TTL_MS,
  };
}

/**
 * Confirm a payment, then hand back what it bought.
 *
 * `caller` is the address the answer is for, and it must be the renter named in
 * the transaction — otherwise anybody watching the chain could spend somebody
 * else's rental by quoting their hash first.
 */
export async function redeem({ tokenId, txHash, question, caller }, deps = {}) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(txHash ?? ''))) {
    throw new CoachError(400, 'bad_request', 'That is not a transaction hash.');
  }

  const asked = String(question ?? '').slice(0, 2000);
  if (!asked.trim()) throw new CoachError(400, 'bad_request', 'There is no question to answer.');

  /*
   * An answer already bought and paid for.
   *
   * Returned rather than refused: an agent that lost the response to a timeout
   * will retry, and charging it twice — or telling it 409 for work it paid for
   * — is the wrong answer to a dropped packet.
   *
   * But only to the address that paid. The first version of this returned the
   * cached answer before checking anything, which meant the second caller to
   * quote a hash got the answer for free — and a transaction hash is public the
   * instant it lands, so the second caller is whoever is watching the chain.
   * The replay shortcut had quietly become a way to never pay at all.
   */
  const existing = await store().readState?.(jobKey(txHash)).catch(() => null);
  if (existing?.answer) {
    if (caller && existing.renter && ethers.getAddress(caller) !== ethers.getAddress(existing.renter)) {
      throw new CoachError(403, 'not_the_renter', 'That payment was made by somebody else.');
    }
    return { answer: existing.answer, replayed: true, tokenId: existing.tokenId, renter: existing.renter };
  }

  const provider = deps.provider ?? defaultProvider();
  const contract = deps.contract ?? coachReader(provider);

  const receipt = await (deps.getReceipt ?? ((h) => provider.getTransactionReceipt(h)))(txHash);
  if (!receipt) throw new CoachError(402, 'payment_not_found', 'That transaction is not on chain yet.');
  if (receipt.status !== 1) throw new CoachError(402, 'payment_failed', 'That transaction reverted.');

  /*
   * Our contract's event, from our contract's address.
   *
   * The address check is the load-bearing half: without it, any contract
   * emitting a log with the same shape would satisfy this, and a caller could
   * deploy one for the purpose.
   */
  const iface = new ethers.Interface([RENTED]);
  const wanted = String(contract.target ?? deps.address ?? '').toLowerCase();

  let rented = null;
  for (const log of receipt.logs ?? []) {
    if (String(log.address).toLowerCase() !== wanted) continue;
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === 'Rented' && String(parsed.args.tokenId) === String(tokenId)) {
        rented = parsed.args;
        break;
      }
    } catch {
      // Another event from the same contract. Not this one.
    }
  }

  if (!rented) {
    throw new CoachError(402, 'payment_not_found', 'That transaction did not rent this coach.');
  }

  if (caller && ethers.getAddress(rented.renter) !== ethers.getAddress(caller)) {
    /*
     * A transaction hash is public the moment it lands, so without this anybody
     * watching could quote somebody else's payment and spend the rental they
     * bought.
     */
    throw new CoachError(403, 'not_the_renter', 'That payment was made by somebody else.');
  }

  const renter = ethers.getAddress(rented.renter);

  // Paid, and still valid — a rental that has since expired buys nothing.
  const live = await contract.hasAccess(tokenId, renter);
  if (!live) throw new CoachError(403, 'no_access', 'That rental has expired.');

  const { configURI, configHash } = await deps.readCoach(contract, tokenId);
  const config = await deps.loadConfig(configURI, configHash);
  const answer = await deps.runModel({ config, question: asked });

  if (deps.leaksConfig?.(answer, config)) {
    throw new CoachError(422, 'refused', 'Your coach will not repeat its own configuration.');
  }

  const result = { answer: String(answer ?? '').trim(), tokenId: String(tokenId), renter };

  // Consumed after the work succeeded, so a failure mid-way is retryable.
  await store().writeState?.(jobKey(txHash), result).catch(() => {});

  return { ...result, replayed: false };
}

/**
 * What is for rent right now, so an agent can find a coach before paying.
 *
 * Bounded the same way the market page is, and for the same reason: `mint` is
 * permissionless, so the id space is whatever anybody has made of it and a scan
 * from 1 upward is a denial of service anybody can buy for the price of a few
 * mints.
 */
export async function listing(deps = {}) {
  const contract = deps.contract ?? coachReader(deps.provider ?? defaultProvider());
  const limit = deps.limit ?? 25;
  const depth = deps.depth ?? 100;

  const total = Number(await contract.totalMinted());
  const oldest = Math.max(1, total - depth + 1);
  const out = [];

  for (let id = total; id >= oldest && out.length < limit; id -= 1) {
    try {
      const price = await contract.rentalPrice(id);
      if (price === 0n) continue;

      const [, , version] = await contract.coachOf(id);
      out.push({
        tokenId: String(id),
        pricePerDay: price.toString(),
        currency: '0G',
        versions: Number(version),
        service: `/api/coach/${id}/service`,
      });
    } catch {
      // A token that cannot be read is skipped rather than failing the listing.
    }
  }

  return { chainId: OG_CHAIN_ID, coaches: out };
}

/**
 * Coaches listed for rent, as candidates a referral can name.
 *
 * Specialty is not on chain — a coach is a token with a price, not a category —
 * so this returns what is rentable and lets the caller decide. That is honest:
 * inventing an on-chain taxonomy nobody writes to would be a field that is
 * always empty and a filter that always lies.
 *
 * When the marketplace is empty a referral still happens with nobody named.
 * "Not me" is the load-bearing half.
 */
export async function findSpecialists(_specialty, deps = {}) {
  try {
    const { coaches } = await listing({ ...deps, limit: 3 });
    return coaches.map((c) => ({
      tokenId: c.tokenId,
      pricePerDay: c.pricePerDay,
      currency: c.currency,
      rentVia: `/coaches`,
      service: c.service,
    }));
  } catch {
    return [];
  }
}
