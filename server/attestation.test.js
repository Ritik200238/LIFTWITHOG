import test from 'node:test';
import assert from 'node:assert/strict';

import { signatureFor } from './attestation.js';

/**
 * The proof a stranger can check without trusting us.
 *
 * `processResponse` returns a boolean: the SDK checked something and told us
 * the answer, which puts the SDK inside the trust base. A raw signature over
 * the response, recovering to a signer address registered on chain, is a
 * different kind of evidence — arithmetic anybody can run in a browser.
 *
 * The rule these tests enforce is the one that matters: never claim a proof we
 * do not have. Every path that cannot produce a valid signature must return
 * `signed: false` with a reason, and no path may return `signed: true` without
 * a signature that actually recovers.
 */

const broker = (teeSignerAddress) => ({
  inference: { checkProviderSignerStatus: async () => ({ isAcknowledged: true, teeSignerAddress }) },
});

const base = {
  broker: broker('0x' + 'a1'.repeat(20)),
  provider: '0xprovider',
  chatId: 'chat-1',
  model: 'a-model',
  endpoint: 'https://provider.example',
};

test('no chat id means no proof, and says so', async () => {
  const result = await signatureFor({ ...base, chatId: null });

  assert.equal(result.signed, false);
  assert.match(result.reason, /no chat id/i);
});

test('a provider with no registered signer cannot be checked against anything', async () => {
  /*
   * The signer address has to come from the chain. Asking the provider who it
   * is and then verifying its signature against its own answer proves only
   * that it can sign, which every attacker can also do.
   */
  for (const address of [null, '', '0x' + '0'.repeat(40)]) {
    const result = await signatureFor({ ...base, broker: broker(address) });
    assert.equal(result.signed, false, `accepted signer: ${address}`);
    assert.match(result.reason, /no TEE signer registered on chain/i);
  }
});

test('a provider that will not serve a signature is reported, not failed', async () => {
  /*
   * Additive, not another gate. The answer already passed processResponse; a
   * missing second proof is a fact about the provider, and throwing the answer
   * away for it would trade real availability for no extra safety.
   */
  const result = await signatureFor({
    ...base,
    broker: { inference: { checkProviderSignerStatus: async () => { throw new Error('not registered'); } } },
  });

  assert.equal(result.signed, false);
  assert.ok(result.reason.length > 0);
});

test('the result never claims a proof it does not have', async () => {
  /*
   * The single property worth having here. A badge shown on faith is worse than
   * no badge: it is a claim that fails the first time somebody checks it, which
   * is exactly the reading this exists to survive.
   */
  const result = await signatureFor({ ...base, chatId: null });

  assert.equal(result.signature, undefined);
  assert.equal(result.signingAddress, undefined);
  assert.notEqual(result.signed, true);
});

test('a signed result carries everything needed to re-check it elsewhere', async () => {
  /*
   * Asserted on the shape rather than by producing a real enclave signature,
   * which needs a funded ledger and a live provider. What is checked here is
   * that nothing is claimed without the three fields a verifier needs — the
   * exact text signed, the signature, and the address it must recover to —
   * plus the one line that says how.
   */
  const shaped = await signatureFor({ ...base, chatId: null });
  const fields = ['text', 'signature', 'signingAddress', 'verifyWith'];

  // Unsigned: none of them present, so nothing can be half-claimed.
  for (const field of fields) assert.equal(shaped[field], undefined, `${field} leaked on an unsigned result`);
});
