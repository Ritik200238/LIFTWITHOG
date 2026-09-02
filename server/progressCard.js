/**
 * A progress card somebody can share, and a stranger can check.
 *
 * Gym people already post their lifts. The number is always somebody's word for
 * it — a screenshot, a claim, a photo of a loaded bar that could be anybody's.
 * Nothing about the *history* is checkable: whether the person has been training
 * twelve weeks or made the account this morning.
 *
 * A coach on chain fixes the half that can be fixed. Three things are facts
 * nobody can edit, and they are the three that make a claim worth reading:
 *
 *   - **how long this coach has existed** — from the mint event
 *   - **how many times it has recorded learning** — the version counter
 *   - **who owns it** — and therefore who is entitled to publish about it
 *
 * ## What this does not prove, said plainly
 *
 * It does not prove somebody lifted the weight. Nothing can: a signature proves
 * a device agreed to something, not that a human under a barbell did. The card
 * is a *signed assertion by the owner of a coach whose age and version history
 * are on chain* — which is strictly more than every fitness app can offer and
 * strictly less than proof of the lift, and the verifier says both.
 *
 * The card is published **unencrypted** on purpose. It is the one thing here
 * meant to be read by strangers, so encrypting it would defeat it; the owner
 * chooses one claim to publish rather than exposing the record. Everything else
 * about a coach stays sealed.
 */

import { ethers } from 'ethers';
import { CoachError, coachReader, defaultProvider, recoverCaller } from './coach.js';

/** What a card says, and what somebody signs. */
export const CARD_VERSION = 1;

/**
 * The exact bytes an owner signs.
 *
 * Every field that a reader is told is in it. Rebuilt from the stored card at
 * verification time rather than trusted from the payload, so re-signing a
 * different claim under the same signature is not a thing that can be done.
 */
export function cardMessage(card) {
  return [
    'LIFTWITHOG progress card',
    `v: ${card.cardVersion}`,
    `coach: ${card.tokenId}`,
    `version: ${card.coachVersion}`,
    `claim: ${card.claim}`,
    `period: ${card.periodDays} days`,
    `issued: ${card.issuedAt}`,
  ].join('\n');
}

/**
 * Publish a claim about a coach, signed by the address that owns it.
 *
 * `claim` is one sentence chosen by the owner — the app offers the sentences
 * the coach already wrote, so the usual case is picking one rather than typing.
 */
export async function publish({ tokenId, claim, issuedAt, signature }, deps = {}) {
  const now = deps.now ?? Date.now();

  const text = String(claim ?? '').trim().slice(0, 140);
  if (!text) throw new CoachError(400, 'bad_request', 'A card needs something to say.');

  /*
   * The same challenge every other owner action uses, so a device that can
   * evolve a coach can publish about it and nothing new has to be learned.
   */
  const address = recoverCaller({ tokenId, issuedAt, signature }, now);
  const contract = deps.contract ?? coachReader(deps.provider ?? defaultProvider());

  let owner;
  try {
    owner = await contract.ownerOf(tokenId);
  } catch {
    throw new CoachError(404, 'no_such_coach', `No coach ${tokenId}.`);
  }

  if (ethers.getAddress(owner) !== address) {
    throw new CoachError(403, 'not_owner', 'Only the owner of a coach can publish about it.');
  }

  const [, , version] = await contract.coachOf(tokenId);
  const createdAt = await deps.createdAt(contract, tokenId);

  const card = {
    cardVersion: CARD_VERSION,
    tokenId: String(tokenId),
    coachVersion: Number(version),
    claim: text,
    periodDays: createdAt ? Math.max(0, Math.floor((now - createdAt) / 86_400_000)) : null,
    issuedAt: Number(issuedAt),
    owner: address,
    /*
     * The signature covers the claim, the coach and the version. A reader
     * recovers it and compares against `ownerOf` on chain — so a card is only
     * ever as good as the address that signed it, and that address is checkable.
     */
    signature,
    chainId: deps.chainId ?? null,
    contract: contract.target ?? null,
  };

  const root = await deps.store(new TextEncoder().encode(JSON.stringify(card, null, 2)));
  return { root, card };
}

/**
 * Check a card, from its storage root, trusting nothing in it.
 *
 * Everything the card asserts about itself is re-derived: the signature is
 * recovered from a message rebuilt out of the card's own fields, the owner is
 * read off the chain, and the version is read off the chain. A card whose
 * claim was edited after signing fails the first check; one published by
 * somebody who has since sold the coach fails the second.
 */
export async function verify(root, deps = {}) {
  const bytes = await deps.fetch(root);
  if (!bytes) throw new CoachError(404, 'no_such_card', 'There is no card at that address.');

  let card;
  try {
    card = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new CoachError(422, 'bad_card', 'That is not a progress card.');
  }

  const checks = {};

  /* 1. Did the address it names actually sign this exact claim? */
  let signer = null;
  try {
    signer = ethers.verifyMessage(cardMessage(card), card.signature);
  } catch {
    // Malformed signature: not an error, an answer.
  }
  checks.signedByTheAddressItNames =
    signer !== null && card.owner && ethers.getAddress(signer) === ethers.getAddress(card.owner);

  const contract = deps.contract ?? coachReader(deps.provider ?? defaultProvider());

  /* 2. Does that address own the coach, according to the chain, right now? */
  let owner = null;
  try {
    owner = await contract.ownerOf(card.tokenId);
  } catch {
    // A coach that does not exist. The check below reports it as failed.
  }
  checks.signerStillOwnsTheCoach =
    owner !== null && signer !== null && ethers.getAddress(owner) === ethers.getAddress(signer);

  /* 3. Has the coach really recorded that much learning? */
  let onChainVersion = null;
  try {
    const [, , version] = await contract.coachOf(card.tokenId);
    onChainVersion = Number(version);
  } catch {
    // Same.
  }
  checks.versionExistsOnChain =
    onChainVersion !== null && Number(card.coachVersion) <= onChainVersion;

  /* 4. Is the coach as old as the card says? */
  const now = deps.now ?? Date.now();
  const createdAt = await deps.createdAt?.(contract, card.tokenId).catch(() => null);
  const actualDays = createdAt ? Math.floor((now - createdAt) / 86_400_000) : null;
  checks.ageMatchesTheChain =
    card.periodDays === null || actualDays === null ? null : Number(card.periodDays) <= actualDays + 1;

  const decided = Object.values(checks).filter((v) => v !== null);

  return {
    card,
    checks,
    valid: decided.length > 0 && decided.every(Boolean),
    onChain: { owner, version: onChainVersion, ageDays: actualDays },

    /*
     * Shipped with the answer rather than left to a reader to work out. A
     * verifier that returns `valid: true` and says nothing about what that
     * covers invites exactly the reading it does not support.
     */
    proves: [
      'the address that signed this card owns the coach, according to the chain',
      'the coach has recorded at least this many versions of learning',
      'the coach has existed at least this long, from its mint event',
    ],
    doesNotProve: [
      'that anybody lifted the weight. A signature proves a device agreed to something, not that a human under a barbell did.',
    ],
  };
}
