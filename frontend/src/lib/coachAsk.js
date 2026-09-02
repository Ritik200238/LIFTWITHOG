/**
 * Asking your coach a question.
 *
 * The browser signs, the server answers. It does not run the model itself, and
 * that is the point rather than an implementation detail: a coach's value is
 * that the person using it gets the advice and never the method behind it. Run
 * in the browser, the configuration and the key to it both pass through the
 * machine of whoever is asking — so a rented coach would be worth exactly one
 * request, and a trainer's income with it.
 *
 * What is sent is a signature proving control of an address. The server checks
 * that address against `hasAccess` on 0G Chain, which is the only authority on
 * whether this person is allowed.
 */


/** Must match `challengeFor` in api/coach.js, exactly. */
export function challengeFor(tokenId, issuedAt) {
  return ['LIFTWITHOG coach request', `coach: ${tokenId}`, `issued: ${issuedAt}`].join('\n')
}

export class CoachAskError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'CoachAskError'
    this.code = code
  }
}

/**
 * Ask a coach something.
 *
 * @param {object} signer   An ethers signer for the address that holds access.
 * @param {string} tokenId  Which coach.
 * @param {string} question What to ask it.
 */
export async function askCoach(signer, tokenId, question, opts = {}) {
  const issuedAt = opts.now ?? Date.now()

  /*
   * The token is inside the signed message. Without it one signature would
   * open every coach on the contract, and a single subscription would be a key
   * to all of them.
   */
  const signature = await signer.signMessage(challengeFor(tokenId, issuedAt))

  const response = await fetch('/api/coach/advice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokenId: String(tokenId), issuedAt, signature, question }),
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    /*
     * The server's own wording where it has any. "This coach is not available
     * to that address" tells somebody what to do; "request failed" sends them
     * to support.
     */
    const error = new CoachAskError(
      payload.message || `The coach could not answer (${response.status}).`,
      payload.error || 'request_failed',
    )
    /*
     * A referral rides along. It is the one refusal that is not a failure — the
     * coach was asked about a torn ligament or a pregnancy and said "not me",
     * which is the correct answer and the one a person should be able to act
     * on. Carried on the error so every existing catch still shows the right
     * sentence, and a screen that knows about it can offer the specialist.
     */
    if (payload.referral) error.referral = payload.referral
    throw error
  }

  if (!payload.answer) {
    throw new CoachAskError('The coach returned an empty answer.', 'empty')
  }

  return payload.answer
}

/**
 * The signer for the address that owns this device's coach.
 *
 * The device key, not a browser wallet. This demanded `window.ethereum` and
 * threw "No wallet found" without one — which contradicted the product's own
 * central claim, printed on the proof screen, that a coach needs no wallet,
 * and made the button impossible to satisfy in an iOS home-screen app or the
 * Capacitor build. The coach was minted by this key and is owned by it; it is
 * the address `hasAccess` is checked against, so it is the one that should be
 * signing.
 *
 * Imported lazily so that opening the app does not pay for the signing stack
 * before anybody has asked a coach anything.
 */
export async function deviceSignerForAsk() {
  const { deviceSigner } = await import('./deviceKey.js')
  const { signer } = await deviceSigner()
  return signer
}

/**
 * A browser wallet, for the paths that genuinely need one.
 *
 * Renting spends real funds, so it is a wallet's job. Asking is not.
 */
export async function walletSigner() {
  if (!window.ethereum) {
    throw new CoachAskError(
      'No wallet found. A coach is used by an address, so this needs one.',
      'no_wallet',
    )
  }
  // Imported here rather than at the top: this is the only line in the file
  // that needs ethers, and it runs only when somebody rents with a wallet.
  const { ethers } = await import('ethers')
  return new ethers.BrowserProvider(window.ethereum).getSigner()
}

/**
 * What this coach has learned, fetched back from 0G.
 *
 * The coaching record is the app's answer to "it learns from your training",
 * and it lived in one browser's local storage — so a new phone, or cleared site
 * data, showed an empty screen while the record itself sat on 0G Storage,
 * hashed on chain, intact. A product whose argument is that a coach outlives
 * the device it was made on cannot have its clearest demonstration of that be
 * the thing a reinstall destroys.
 *
 * It has to come from the server: the payload is sealed to the service key, so
 * this browser could not open it even holding the bytes. Owner-only on the
 * server side — a renter may ask a coach questions, not read the notes it kept
 * about somebody else's body.
 */
export async function recallMemory(signer, tokenId, opts = {}) {
  const issuedAt = opts.now ?? Date.now()
  const signature = await signer.signMessage(challengeFor(tokenId, issuedAt))

  const response = await fetch('/api/coach/recall', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokenId: String(tokenId), issuedAt, signature }),
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new CoachAskError(
      payload.message || `That could not be read (${response.status}).`,
      payload.error || 'request_failed',
    )
  }

  return {
    memory: Array.isArray(payload.memory) ? payload.memory : [],
    version: Number(payload.version) || 0,
  }
}
