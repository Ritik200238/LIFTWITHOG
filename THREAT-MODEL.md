# LIFTWITHOG threat model

What an attacker can do to this system, what stops them, and — the part most
documents leave out — what is still open.

Written against the code at `0xe0bd5144dd254422c1fE4eA8a62A23C3ca52AfB2` on 0G
Galileo. Every Evidence cell points at a file and line, or a command you can run.

---

## Executive summary

The dominant risk in this product is not the chain. It is that a service which
pays other people's transaction fees, and holds a key that opens other people's
coaches, is a service with money and secrets sitting in it.

The chain half is deliberately boring: `CoachAgent` has no owner, no pause, no
upgrade path and no withdraw function, so the class of attack that begins "the
admin key was compromised" does not have an entry point. The custody half is
where the real surface is, and it is where the open risks below live.

No unresolved issue is known that would let anybody take a coach they do not
own, spend the relayer beyond its daily ceiling, or read a coach's contents
without the service key.

---

## Scope and assumptions

**In scope**

- `contracts/src/CoachAgent.sol`, `contracts/src/AttestedTransferVerifier.sol`
- `server/relayer.js`, `server/coach.js`, `server/coach-runtime.js`, `server/coachEnvelope.js`
- `server/store.js` (rate-limit counters, blob mirror, session secret)
- `frontend/src/lib/deviceKey.js`, `frontend/src/lib/ogCoach.js`

**Out of scope**

- 0G Chain consensus, 0G Storage node behaviour beyond availability, and the
  correctness of 0G Compute's attestation registry. We depend on all three and
  can verify none of them from here.
- Whether the coach's *advice* is good. Attestation proves where a model ran.
- Physical access to an unlocked device. A device key in the hands of somebody
  holding the phone is that person's key, by design.
- The platform's own TLS, CDN and DDoS handling.

**Assumptions**

1. The relayer key and the coach service key are secrets on the server. In the
   current deployment **they are the same key**, which is a finding, not a design.
2. A user's device key never leaves the device and is not backed up anywhere we
   can read.
3. `evmrpc-testnet.0g.ai` may be slow, wrong, or absent at any time.
4. Anybody can call any public function on the contract, in any order, from any
   address, as many times as they can pay for.
5. The attestor signing transfer proofs is software, not hardware.

**Open questions that would change the ranking**

- Does 0G Compute's marketplace flag ever report attested for a provider that is
  not? We treat the registry as truth after checking each response against
  `processResponse`; a lying registry plus a cooperating provider defeats both.
- What is the real replication delay on 0G Storage? It sets how long the blob
  mirror is the only copy.

---

## System model

**Components**

| | |
|---|---|
| Device | Generates a key, signs EIP-712 messages, seals the coach payload. Holds no funds. |
| Relayer | Submits signed messages and pays gas. Named in nothing it submits. |
| Coach service | Opens sealed payloads, builds the prompt, calls 0G Compute. Holds the service key. |
| `CoachAgent` | Ownership, versions, rentals, grants. No admin. |
| `AttestedTransferVerifier` | Decides whether a re-encryption really happened. No admin. |
| 0G Storage | Holds ciphertext, addressed by hash. Trusted for availability only. |
| 0G Compute | Runs inference in a TEE. Trusted only as far as `processResponse` verifies. |

**Data flows and trust boundaries**

```
device  -> relayer      : an EIP-712 message naming its own owner
                          enforced by: signature recovery in CoachAgent._useSignature
relayer -> chain        : a transaction paying for that message
                          enforced by: owner is signed data, not msg.sender
device  -> service      : a payload sealed to the service's public key
                          enforced by: ECDH + AES-256-GCM, coachEnvelope.js
service -> 0G Storage   : ciphertext
                          enforced by: nothing — storage sees only ciphertext
chain   -> service      : the hash the payload must match
                          enforced by: keccak256 check, coach-runtime.js
service -> 0G Compute   : the prompt, into an attested enclave
                          enforced by: processResponse per response, fail closed
```

---

## Assets and objectives

| Asset | Why it matters | Objective |
|---|---|---|
| A coach's ownership | It is the product. Losing it is losing the thing somebody built over months. | Integrity |
| A coach's contents | Training history, bodyweight, injuries. | Confidentiality |
| The relayer's balance | It pays for everybody. Empty means nobody can mint or evolve. | Availability |
| The coach service key | Opens every coach sealed to it. | Confidentiality |
| Rental payments | Money moving from a renter to a trainer. | Integrity |
| The device key | Sole authority over one person's coach. | Confidentiality |

---

## Attacker model

**Capabilities**

- Call any contract function from any address, repeatedly.
- Send any HTTP request to the API, with any headers, including forged
  `X-Forwarded-For`.
- Watch every transaction and every 0G Storage blob.
- Run a 0G Compute provider and answer requests routed to it.
- Mint unlimited coaches, since `mint` is permissionless.

**Non-capabilities**

Each line below is enforced by code, not policy.

- **Cannot pause, upgrade, migrate or drain the contract.** There is no owner
  role, no proxy, no `withdraw`, and `transferVerifier` is immutable. Not "no
  admin has done this" — there is no function to call.
- **Cannot mint, evolve or list a coach on somebody else's behalf.** `owner` is a
  field inside the signed message; a relayer substituting itself submits a
  signature that does not say so.
- **Cannot replay a signed action.** The nonce is consumed on chain.
- **Cannot forge a transfer.** The attestation binds chain id, verifier address,
  from, to, token id, the sealed key and the recipient's public key — and is
  spent on use.
- **Cannot read a coach from 0G Storage.** The payload is sealed to the service
  key before it leaves the device.
- **Cannot obtain an answer from an unattested model.** Every attested provider
  is tried and the request fails when none will vouch for its response. There is
  no unattested fallback.
- **Cannot spend the relayer past its daily ceiling** by inventing identities,
  because that ceiling is not keyed on identity.

---

## Entry points

| Surface | Reached by | Boundary crossed | Evidence |
|---|---|---|---|
| `mintFor` / `evolveFor` / `setRentalPriceFor` | `POST /api/coach/{mint,evolve,price}` | anonymous → our money | `server/relayer.js:198` |
| `POST /api/coach/store` | anonymous | anonymous → our money + 0G Storage | `server/server.js:691` |
| `POST /api/coach/advice` | rental/ownership checked on chain | renter → the service key's plaintext | `server/coach.js:124` |
| `GET /api/coach/pubkey` | anonymous | none — public key | `server/server.js` |
| `rent()` | any wallet | renter → trainer's balance | `CoachAgent.sol` `rent` |
| `iTransferFrom` | owner or approved | owner → buyer | `CoachAgent.sol` `iTransferFrom` |
| `mint()` | any wallet | anonymous → the id space | `CoachAgent.sol` `mint` |

---

## Top abuse paths

1. **Relayer drain by identity churn.** Attacker generates a keypair per request
   → per-address limit never trips → relayer empties. *Mitigated by* a
   whole-service daily ceiling keyed on a constant (`MAX_RELAYS_PER_DAY`).
2. **Relayer drain via forged client IP.** Attacker sets `X-Forwarded-For` per
   request → store limit keyed on a value they chose → unlimited paid uploads.
   *Mitigated by* `callerIp` preferring `x-real-ip` and otherwise taking the
   proxy-appended entry.
3. **Marketplace denial.** Attacker mints hundreds of empty coaches → the market
   page walks every id → nobody can browse. *Mitigated by* a bounded,
   newest-first, batched scan.
4. **Substituted coach brain.** Attacker replaces a blob on 0G Storage → service
   decrypts somebody else's method. *Mitigated by* the keccak256 check against
   the on-chain hash, applied to the mirror as well as the download.
5. **Transfer replay after a round trip.** Coach is sold, bought back, and
   yesterday's attestation re-presented. *Mitigated by* spending the nonce in
   `attestTransfer`.
6. **Prompt extraction by a renter.** Renter asks the coach to recite its own
   configuration. *Mitigated by* `leaksConfig`, a verbatim-substring check that
   refuses the answer — found by an attack that worked, not by a review.
7. **Grant survival across a sale.** Trainer rents widely, sells, buyer inherits
   a coach a crowd still has keys to. *Mitigated by* the epoch counter voiding
   every grant on transfer.

---

## Threat table

| ID | Threat | Existing controls | Gaps | Priority |
|---|---|---|---|---|
| LW-001 | Relayer drained | daily ceiling, per-address hourly limit, balance floor, atomic Postgres counters | the ceiling is a blunt instrument; a real spike and an attack look the same | Medium |
| LW-002 | Relayer key compromised | owner named in signed data; nonce consumed on chain; relayer holds no approval over any coach | a compromised relayer can **censor** — refuse to submit — which we cannot prevent | Medium |
| LW-003 | Coach service key compromised | key is server-side only; never in the repo, never in a `VITE_*` name | **an attacker with it can read every coach sealed to it.** This is the largest single asset. | **High** |
| LW-004 | Ownership stolen | signature recovery, deadline, nonce; `owner` in the message | none known | Low |
| LW-005 | Storage blob substituted | keccak256 against chain, applied to both copies; AES-GCM authenticates | none known | Low |
| LW-006 | Storage blob lost | encrypted mirror; timeout so a stall is not a hang | the mirror is ours; losing it and the blob loses the coach | Medium |
| LW-007 | Unattested inference | per-response `processResponse`, `=== true` only, no fallback | a lying registry plus a cooperating provider defeats this | Medium |
| LW-008 | Method extracted by a renter | `leaksConfig` verbatim check; prompt instruction | a determined paraphrase attack is not covered by a substring check | Medium |
| LW-009 | Marketplace denial | bounded scan, bounded log window | a large enough id space still costs a page-load | Low |
| LW-010 | Transfer forged or replayed | full-field digest, nonce spent, immutable verifier | **attestor is software, not hardware** | Medium |

---

## Criticality calibration

- **Critical** — anybody can take a coach they do not own, or read one without a key.
- **High** — one compromised secret exposes many users' data.
- **Medium** — money or availability loss, bounded, recoverable, no data exposure.
- **Low** — needs an unlikely precondition, or the damage is cosmetic.

---

## Where to look first

| Path | Why | Threats |
|---|---|---|
| `contracts/src/CoachAgent.sol` | ownership, rentals, grants | LW-004, LW-007 |
| `contracts/src/AttestedTransferVerifier.sol` | the only thing standing behind a transfer | LW-010 |
| `server/relayer.js` | spends money for anonymous callers | LW-001, LW-002 |
| `server/coachEnvelope.js` | one implementation, two runtimes | LW-003, LW-005 |
| `server/coach-runtime.js` | attestation, hash check, storage | LW-005, LW-006, LW-007 |
| `server/coach.js` | who may ask, and what leaks back | LW-008 |

---

## Open risks, stated rather than closed

1. **The relayer key and the coach service key are the same key** in the current
   deployment. That gives one secret both the money and the plaintext. Splitting
   them is configuration, not code — `server/.env.example` documents both — and
   it has not been done.
2. **`COACH_SERVICE_KEY` is a single point of confidentiality failure.** Every
   coach is sealed to it. Rotating it makes every existing coach unopenable,
   because the blobs are anchored on chain by hash, so there is no migration —
   only a new deployment.
3. **The transfer attestor is software.** It attests that the service performed a
   re-encryption. Nothing forces the service to have actually done so.
4. **`leaksConfig` catches verbatim leaks, not paraphrase.** A model persuaded to
   describe a method in its own words is not caught by a substring check.
5. **The blob mirror is operated by us.** It removes a dependency on 0G Storage
   replication and adds one on our own storage.
6. **`mint()` is permissionless and the id space is unbounded.** The market read
   is now bounded, but nothing stops the number growing.

---

*If you find something here that is wrong, or something missing, that is the most
useful contribution this repository can receive.*
