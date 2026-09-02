/**
 * Proof that an enclave signed this answer, that anybody can check offline.
 *
 * `processResponse` — the gate every answer already passes — returns a boolean.
 * The SDK checked something on our behalf and told us the result, which means
 * the SDK is inside the trust base: a caller who does not trust us has to trust
 * our report of what a library told us.
 *
 * The provider will also hand over the **raw signature** it made over the
 * response, and its signer address is registered on chain. That is a different
 * kind of evidence. `recoverAddress(hashMessage(text), signature)` is arithmetic
 * anybody can run, in a browser, with no account and no library of ours — and it
 * either lands on the address 0G's contract says belongs to that provider, or it
 * does not.
 *
 * Hanami wired exactly this and shipped it **disabled**, because the direct
 * broker wants a standing deposit they chose not to lock up. So the strongest
 * attestation story available on 0G was written and turned off. This one is on.
 *
 * ## Why it is additive rather than another gate
 *
 * The fail-closed gate is `processResponse`, and it stays. This runs after a
 * response has already been accepted, and when a provider does not serve
 * signatures it says so rather than throwing an answer away that the enclave
 * already vouched for. Refusing an attested answer because a *second, better*
 * proof was unavailable would trade real availability for no extra safety.
 *
 * What it never does is claim a proof it does not have. `signed: false` and a
 * reason, or a signature somebody else can check. Never a badge on faith.
 */

/**
 * The provider's signature over one answer, and the address it must recover to.
 *
 * Returns `{ signed: false, reason }` rather than throwing, because a missing
 * signature is a fact about the provider, not an error in the request.
 */
export async function signatureFor({ broker, provider, chatId, model, endpoint }) {
  if (!chatId) return { signed: false, reason: 'the provider returned no chat id to sign over' };

  let InferenceVerifier;
  try {
    ({ InferenceVerifier } = await import('@0gfoundation/0g-compute-ts-sdk'));
  } catch {
    return { signed: false, reason: 'the compute SDK does not expose a verifier here' };
  }

  /*
   * The signer address comes from the chain, not from the provider. Asking the
   * provider who it is and then checking its signature against its own answer
   * proves only that it can sign — which is what every attacker can also do.
   */
  let teeSignerAddress = null;
  try {
    ({ teeSignerAddress } = await broker.inference.checkProviderSignerStatus(provider));
  } catch {
    return { signed: false, reason: 'the provider has no TEE signer registered on chain' };
  }

  if (!teeSignerAddress || /^0x0{40}$/i.test(teeSignerAddress)) {
    return { signed: false, reason: 'the provider has no TEE signer registered on chain' };
  }

  let text;
  let signature;
  try {
    ({ text, signature } = await InferenceVerifier.fetchSignatureByChatID(endpoint, chatId, model));
  } catch (e) {
    return { signed: false, reason: `the provider did not serve a signature: ${e.message || e}` };
  }

  if (!text || !signature) {
    return { signed: false, reason: 'the provider returned an incomplete signature' };
  }

  /*
   * Verified here as well as being handed out. A signature that does not
   * recover to the registered signer is worse than none — published, it would
   * be a proof that fails the first time anybody checks it, which is exactly
   * the reading this whole page exists to survive.
   */
  let valid = false;
  try {
    valid = InferenceVerifier.verifySignature(text, signature, teeSignerAddress);
  } catch {
    valid = false;
  }

  if (!valid) {
    return { signed: false, reason: 'the signature did not recover to the registered TEE signer' };
  }

  return {
    signed: true,
    /*
     * The exact bytes the enclave signed. Not necessarily identical to the
     * answer as rendered, so it is returned rather than assumed — a verifier
     * that re-hashes the wrong string gets the wrong address and blames the
     * signature.
     */
    text,
    signature,
    signingAddress: teeSignerAddress,
    provider,
    chatId,
    /*
     * Shipped with the proof so a reader does not have to work out how to check
     * it. One line, no dependency on anything of ours.
     */
    verifyWith: 'ethers.recoverAddress(ethers.hashMessage(text), signature) === signingAddress',
  };
}
