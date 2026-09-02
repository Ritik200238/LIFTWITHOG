# Security Policy

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting** on this repository
(Security → Report a vulnerability), so the report and the fix can travel
together before anything is public. If that is unavailable, open an issue that
says only "security — requesting a private channel" and a maintainer will
provide one; put no details in the public issue.

You can expect an acknowledgement within 72 hours. Please give us a reasonable
window to ship a fix before disclosing.

## What is in scope

- The smart contract (`contracts/src/CoachAgent.sol`) — anything that moves a
  coach, money, or access to somebody the owner did not choose.
- The server (`server/`) — account takeover, another user's data, forged
  sessions, relayer abuse.
- The frontend's key handling (`frontend/src/lib/deviceKey.js`,
  `frontend/src/lib/ogVault.js`) — anything that exfiltrates a device key,
  recovery phrase, or vault plaintext.

Self-hosted instances are configured by their operators; misconfiguration of
somebody's own deployment is theirs, but a default that *invites*
misconfiguration is ours — report those.

## How keys and secrets are handled

Stated here so reports can point at the gap between this policy and the code:

- **The device key never leaves the device.** It is generated in the browser,
  stored locally per profile, and signs EIP-712 messages; the server and
  relayer see signatures, never the key.
- **Vault backups are encrypted before they travel.** AES-256-GCM under a key
  derived on the device; 0G Storage holds ciphertext only.
- **Session cookies are HMAC-signed** with a per-instance secret. A session
  key that was once committed to this repository is recognised **by hash** at
  boot and replaced automatically, signing everyone out rather than carrying
  on with a published key.
- **The relayer key exists only in server configuration** (environment or
  `server/.env`), never in the repository. `render.yaml` marks it `sync:false`
  so platform blueprints prompt for it instead of storing it.
- **The contract has no owner, no admin, and no pause.** Nobody can freeze,
  reassign, or upgrade a coach out from under its owner. The ERC-7857 transfer
  verifier is immutable at deployment for the same reason.

## What a report should include

The shortest path to reproducing what you found: the request, transaction, or
state that demonstrates it, and what you expected instead. A working proof of
concept is welcome; mass-testing against instances you do not operate is not.

---

# Findings and evidence

The half of a security document that is usually missing: what has actually been
found in this codebase, what fixed it, and what is still open. The attacker
model and the abuse paths live in [THREAT-MODEL.md](THREAT-MODEL.md).

## Fixed findings

Each entry names the code and the test, so the claim can be checked rather than
believed. The tests are named as sentences precisely so they can be quoted here.

**1. High — every coach a real person created was unreadable.**
*Impact:* the device sealed the coach payload under a key derived from its own
signature, in the byte layout WebCrypto produces; the server tried a key derived
from `COACH_SERVICE_KEY`, in the layout node's crypto produces. Two independent
mismatches. "Ask a question" returned 422 for every user-created coach, and the
memory pipeline was uploading sentences nothing could ever read.
*Fix:* one implementation of the seal in `server/coachEnvelope.js`, imported by
both halves — envelope encryption where the device mints a content key and wraps
it for the service's public key.
*Evidence:* tests `a coach sealed the way the app seals one is opened by the
server that answers for it` and `a coach sealed on a device opens on the server,
with every field intact`. Verified by reverting the server and watching exactly
those two fail.

**2. High — "attestation verified per response" was not true.**
*Impact:* five documents and an agent card registered on chain as ERC-8004 #382
claimed per-response verification. The code read a marketplace flag once, before
the request, and never looked at the reply — so a provider listed as attested
that then answered from anywhere was indistinguishable from one that had not.
The same call settles the fee, so the inference was unpaid as well as unverified.
*Fix:* `processResponse` on every answer, with only `true` accepted. The SDK
documents `null` as *verification skipped*; a truthiness check, or a `!== false`,
would have read that as success.
*Evidence:* `server/coach-runtime.js`; tests `an answer the enclave will not
vouch for is thrown away, not shown`, `a skipped verification is a refusal,
because null does not mean yes`, and `the fee is settled with the usage, not with
the answer`. Four of the eight fail the moment the result is ignored.

**3. High — the relayer's rate limits did not limit.**
*Impact:* the per-address cap was keyed on an owner address the caller chooses,
so a script minting a fresh keypair per request never reached it. Separately,
the storage endpoint keyed on the first entry of `X-Forwarded-For` — behind nginx
that is the part the client writes, so a new value per request bought unlimited
relayer-paid uploads while appearing rate limited.
*Fix:* a whole-service daily ceiling keyed on a constant, and `callerIp`
preferring `x-real-ip`, else the proxy-appended entry.
*Evidence:* tests `a fresh address per request no longer means unlimited
relaying` and `the caller is identified by a header the caller cannot write`.

**4. Medium — a dead module claimed a TEE it did not have.**
*Impact:* `frontend/src/lib/ogAICoach.js` was imported by nothing and contained
`teeVerified: true` hardcoded, a fallback returning provider `"Local Enclave
Emulation"` with invented advice and `success: true`, and a computer-vision form
check returning a fixed sentence without making a request. None of it ran; all of
it was greppable, in a repository whose argument is attested inference.
*Fix:* deleted.

**5. Medium — the ERC-7857 event was missing from the paths coaches are made on.**
*Impact:* `mint` emitted `IntelligentDataSet` and `mintFor` did not — and
`mintFor` is the relayed path, so an indexer following the standard saw the
coaches nobody has and none of the coaches everybody has. `evolve` and
`evolveFor` had the same split, reversed.
*Fix:* both paths emit it.
*Evidence:* tests `relayed mint announces the intelligent data` and `direct
evolve announces the intelligent data`; removing either emit fails them.

**6. Medium — the market page could be taken down for the price of a few mints.**
*Impact:* listing walked token ids from 1 upward, one round trip each, and ages
came from `queryFilter(CoachMinted, 0, 'latest')` on every load. `mint` is
permissionless, so both grew with whatever anybody made of the id space.
*Fix:* a bounded, newest-first, batched scan; a bounded log window that degrades
to "no age shown" rather than to an empty marketplace.
*Evidence:* test `does not read every id that has ever been minted`.

**7. Medium — a dropped 0G Storage blob bricked a coach permanently.**
*Impact:* no timeout on any upload or download, and no second copy anywhere. A
node dropping a blob before it replicated left a coach whose `configURI` is on
chain forever, pointing at nothing.
*Fix:* timeouts in both directions, and an encrypted mirror — checked against the
on-chain hash exactly like a download, so it cannot become a way to serve bytes
nobody verified.
*Evidence:* tests `a coach still opens when 0G Storage has lost the blob` and
`the mirror is checked against the chain like any other copy`.

**8. Medium — the container was missing a module it imports.**
*Impact:* the Dockerfile copies an explicit file list. Three times a new module
was left off it; each time the build succeeded, the image shipped, and the
container died at boot on "Cannot find module".
*Fix:* a test that walks the local imports of every shipped file, static and
dynamic, and fails when one is not copied. `server/dockerfile.test.js`.

**9. Medium — the frontend ABI had no guard.**
*Impact:* the server has had one since `setRentalPriceFor` was missing from the
relayer ABI and every listing 502'd in production while the whole suite passed.
The frontend had none, and the same thing happened the moment `/verify` began
calling `supportsInterface` and `transferVerifier` — both absent from the ABI.
*Fix:* `frontend/src/lib/coachAbi.test.js`, over every file that builds a
contract from `COACH_ABI`.

**10. Low — a session key was once committed to this repository.**
*Impact:* any instance still using it could have cookies minted for any account.
*Fix:* it is recognised **by hash** at boot and replaced, signing everyone out
rather than continuing under a published key. `LEAKED_SECRET_SHA256` in
`server/store.js`.

## Existing controls

- No owner, no admin role, no pause, no proxy and no `withdraw` on `CoachAgent`.
- `transferVerifier` immutable; the verifier has no admin and an immutable attestor.
- `owner` is signed data on every relayed path, so a relayer can pay but never redirect.
- Nonces consumed on chain; a deadline on every signature.
- Rate-limit counters in Postgres, incremented atomically, so they hold across
  serverless instances instead of resetting on every cold start.
- Fail-closed inference: no attested provider vouching means an error, never a
  downgrade.
- Coach payloads sealed before they leave the device; 0G Storage sees ciphertext.
- Stored blobs verified against the on-chain hash before use, whichever copy answered.

## Current evidence

```
CoachAgent                 0xe0bd5144dd254422c1fE4eA8a62A23C3ca52AfB2   (0G Galileo, 16602)
AttestedTransferVerifier   0xc0d95348dA0eD829f400FA3eF04fDb7e67A5a12B
```

```bash
npm run evidence                                        # every check, read live from 0G
node scripts/counts.mjs                                 # 736 tests: 543 + 103 + 90
node scripts/mutate.mjs                                 # 174 seeded faults, 169 caught
node --env-file=server/.env scripts/prove-gasless.mjs   # owned and listed, holding 0.0 0G
node --env-file=server/.env scripts/prove-transfer.mjs  # ERC-7857 transfer, and two refusals
```

## Open risks

Restated from the threat model, because a security document listing only what it
fixed is marketing.

1. **The relayer key and the coach service key are the same key** in the current
   deployment — one secret holding both the money and the plaintext. Splitting
   them is configuration, documented in `server/.env.example`, and not yet done.
2. **`COACH_SERVICE_KEY` opens every coach.** Rotating it makes every existing
   coach unopenable, because the blobs are anchored on chain by hash: there is no
   migration, only a new deployment.
3. **The transfer attestor is software, not hardware.** It attests that the
   service re-encrypted; nothing forces it to have actually done so.
4. **`leaksConfig` catches verbatim leaks, not paraphrase.**
5. **The blob mirror is operated by us**, trading a dependency on 0G Storage
   replication for one on our own storage.
6. **`mint()` is permissionless.** The market read is bounded now; the id space
   is not.
