# Submission

Written against the four scoring criteria, in their order of weight. Every claim
here is a command you can run, a transaction you can open, or a file you can
read — and where something is not done, it says so rather than being left out.

**LIFTWITHOG** — the AI coach you own. A workout and nutrition tracker whose
coach is an ERC-7857 Agentic ID on 0G Chain, controlled by a key your device
generated, with an encrypted brain on 0G Storage and advice that runs only
inside a TEE-attested enclave on 0G Compute.

- **Live:** [liftwithog.vercel.app](https://liftwithog.vercel.app) · **Verify:** [/#/verify](https://liftwithog.vercel.app/#/verify)
- **CoachAgent:** [`0x0253fb92F9e88E82Fb0632C076C88204e4400025`](https://chainscan-galileo.0g.ai/address/0x0253fb92F9e88E82Fb0632C076C88204e4400025) (0G Galileo, 16602)
- **AttestedTransferVerifier:** [`0xAb4553bA4C93E6e332580FA69af1E77E1d15E44B`](https://chainscan-galileo.0g.ai/address/0xAb4553bA4C93E6e332580FA69af1E77E1d15E44B)
- **ERC-8004 Trustless Agent:** #382 on 0G's Identity Registry

---

## The problem, in one paragraph

Every fitness app dies the same way: years of somebody's training, and their
coach's knowledge of them, are rows in a company's database that disappear with
the company. And the moment an app's coach becomes an AI, that database is
health data sitting on somebody else's server. LIFTWITHOG makes the coach
property — owned by a key the user's device made, its brain encrypted, its
advice provably run inside an enclave — and does it without asking anybody to
install a wallet or hold a coin.

---

## 40% — Progress & momentum this wave

The wave's work was not new features on a working product. It was finding that
the product's central loop did not work, and fixing that before anything else.

### What was broken, and is not now

| | Found | Now |
|---|---|---|
| **Ask your coach** | Returned **422 for every coach a real person created.** The device sealed the payload with its own key in WebCrypto's byte layout; the server tried a key from `COACH_SERVICE_KEY` in node's layout. Two independent mismatches. Only the three seeded house coaches worked. | One implementation of the seal, imported by both halves. Verified by reverting the server and watching the round-trip test fail. |
| **Attestation** | Five documents and the on-chain agent card said "verified per response". The code read a marketplace flag once, before the request, and never checked the reply. The same call settles the fee — so inference was unpaid too. | `processResponse` on every answer, only `true` accepted, no unattested fallback. |
| **ERC-7857 transfer** | `address(0)` verifier, so `iTransferFrom` reverted on every call ever made, immutably. | [Moves a coach on chain](https://chainscan-galileo.0g.ai/tx/0x8c60c34aa35f1685c6c7c74ee0ce7f0d875168613a9933666b8f06f3b46318ea), with a replayed attestation and one signed for another buyer both refused. |
| **Rate limits** | Keyed on an address the caller chooses, and on the client-writable half of `X-Forwarded-For`. A fresh keypair per request drained the relayer. | Whole-service daily ceiling; caller identified by a header the caller cannot write. |
| **Storage** | No timeout and no second copy. A node dropping a blob left a coach whose on-chain pointer resolved to nothing, forever. | Timeouts both directions, plus a mirror — hash-checked against the chain exactly like a download. |
| **Market page** | Walked every token id and scanned logs from block 0 on every load. `mint` is permissionless. | Bounded, newest-first, batched. |
| **A dead module** | `teeVerified: true` hardcoded, a "Local Enclave Emulation" fallback, and a fabricated computer-vision form check. Imported by nothing; greppable by anyone. | Deleted. |
| **The documents** | Three different test totals, two mutation counts, two owners for token #1 seventeen lines apart, and a cost argument ten times out against a constant in the repo. | Every number printed by `scripts/counts.mjs`, which runs the suites. |

### New this wave

- **`AttestedTransferVerifier`** — the ERC-7857 re-encryption check. The
  attestation binds chain id, verifier address, from, to, token id, the sealed
  key *and* the recipient's public key, and is spent on use. Binding the key
  material is the point: a signature over from/to/id alone could be presented
  next to any sealed key, including the one the seller still holds.
- **The published coaching policy** — the literal system prompt and every
  nutrition bound, unencrypted on 0G Storage, with a commitment
  [anchored on chain](https://chainscan-galileo.0g.ai/tx/0x4d82b9b127953c35d5088030509a5dbbee85b0f94571f63e84ee056569731faa).
  The numbers are read out of the module enforcing them, so the document cannot
  drift from the code.
- **Coaching record recovery** — the record lived in one browser's local
  storage, so a new phone showed an empty screen while it sat on 0G Storage
  intact. Owner-only recall, and only the memory travels.
- **`THREAT-MODEL.md`** with an attacker **non-capabilities** list, and the
  findings half of `SECURITY.md`: ten findings with the code and named test that
  closed each, plus six open risks.
- **`verify.sh`**, splitting evidence by kind — and `live` reads nothing in the
  repository.
- **Seven guard tests** that each exist because something shipped broken.

**20 commits this wave.** Each names what was wrong before it, because a commit
log is the only record of momentum a judge can check.

---

## What this contract cannot do to you

Most of what an agent NFT promises is undone by the admin key nobody mentions.
A pausable token is one wallet away from freezing every owner; an upgradeable
one can be rewritten under them; a swappable verifier means the rules of
ownership are a setting. Those are all normal, and all of them mean the agent is
yours until somebody decides otherwise.

This contract has none of them, and the absence is checkable in one command:

```bash
grep -rc "Ownable\|AccessControl\|onlyOwner\|onlyRole\|Pausable\|whenNotPaused\|UUPS\|upgradeTo\|_authorizeUpgrade\|selfdestruct\|delegatecall" contracts/src
# every file: 0
```

| Power a contract usually keeps | Here | Where to check |
|---|---|---|
| Pause transfers, minting or use | **Does not exist.** No `Pausable`, no `whenNotPaused` anywhere | the grep above |
| Upgrade the logic under owners | **Does not exist.** No proxy, no UUPS, no `_authorizeUpgrade` | the grep above |
| An owner or admin role | **Does not exist.** No `Ownable`, no `AccessControl`, no `onlyOwner`, no `onlyRole` | the grep above |
| Swap the transfer verifier | **Impossible.** `address public immutable transferVerifier` | [`CoachAgent.sol:123`](contracts/src/CoachAgent.sol) |
| Swap the attestor behind that verifier | **Impossible.** `address public immutable attestor` | [`AttestedTransferVerifier.sol:48`](contracts/src/AttestedTransferVerifier.sol) |
| Hold or divert your money | **Cannot.** Rent and clone fees leave in the same call, proven by an invariant | `invariant_ContractNeverHoldsFunds`, `testFuzz_TheTrainerIsPaidEverythingAndTheContractKeepsNothing` |
| Destroy the contract | **Does not exist.** No `selfdestruct`, no `delegatecall` | the grep above |

The cost of this is real and stated rather than hidden: **there is no admin to
rescue anybody either.** A bug cannot be paused around, and the attestor key
cannot be rotated — if it leaks, the answer is a new deployment that owners
migrate to by choice. That trade is deliberate. Property whose rules can be
changed under it by a third party is custody wearing a different name, and an
attestation that never expires is a bearer token, which is why attestations
carry a signed deadline instead ([`AttestedTransferVerifier.sol:86`](contracts/src/AttestedTransferVerifier.sol)).

## What the server cannot read

| | How it is enforced | Where to check |
|---|---|---|
| Your coach's method | Sealed on the device with ECDH + AES-256-GCM before it is sent; the server relays ciphertext it has no key for | [`server/coachEnvelope.js`](server/coachEnvelope.js) |
| Your training history in a backup | Encrypted on the device; the server pays the storage fee and never sees plaintext | [`frontend/src/lib/ogVault.js`](frontend/src/lib/ogVault.js) |
| — asserted, not asserted about | A test fails if a workout or a number appears in what leaves the browser | `ogVault.test.js:71` — *"sends ciphertext, never the training history"* |

## What the coach refuses to do

Advice is produced inside a TEE-attested enclave on 0G Compute or not at all.
`processResponse` is checked per response and only `true` passes — `null` means
verification was *skipped* and is refused too, because the quietest way to end
up fail-open is to treat a missing answer as a yes
([`coach-runtime.js:513-535`](server/coach-runtime.js)). Every attested provider
is tried; when the list runs out the request fails with `503 no_tee`. There is
no unattested last resort, and `coachCompute.test.js` fails if one is added.

## 30% — 0G integration

Every pillar is load-bearing. Remove any one and the product stops working.

### 0G Chain

`CoachAgent` is a genuine ERC-7857 Agentic ID, and the interfaces are vendored
verbatim from 0G's own `agenticID-examples`. Ask the bytecode:

```bash
$ for id in 0x4b396f04 0x35d39512 0x80ac58cd 0xdeadbeef; do
    cast call 0x0253fb92F9e88E82Fb0632C076C88204e4400025 \
      "supportsInterface(bytes4)(bool)" $id --rpc-url https://evmrpc-testnet.0g.ai
  done
true  true  true  false
```

**The `false` is the one that matters.** `0xdeadbeef` is not an interface
anybody implements. A stub answering `true` to everything passes the three
before it. The same control is pinned in Foundry and read live on `/verify`.

- **All three 7857 mechanisms work** — transfer, authorize, and the intelligent
  data surface. No stubs, nothing disabled.
- **Gasless both ways.** [Coach #4](https://chainscan-galileo.0g.ai/address/0x885715F1f33aFfBaD28b21C7a048be40336da42e)
  is owned and listed for rent by an address holding **0.0 0G**
  ([mint](https://chainscan-galileo.0g.ai/tx/0xc6e4c9688b4b77cb15be6dfc390d5a3b2f8b64ba205159ecd1338c27fea54cc1) ·
  [listing](https://chainscan-galileo.0g.ai/tx/0x2f73ae2b66167c9877ef6de816e2d1b5da1e9c776b5ce9154b02ae4a9584b2a1)).
- **No admin.** No owner role, no pause, no proxy, no withdraw. The verifier
  address is immutable.
- **ERC-8004** agent #382, agent card served by the app.

### 0G Compute

Every answer runs on a TEE-attested provider, and `processResponse` verifies
*that response* before it is shown — only `true` passes, because the SDK
documents `null` as verification skipped. Every attested provider is tried; when
none will vouch, the request fails. There is no unattested fallback.

### 0G Storage

The coach's brain, sealed on the device before it leaves. Envelope encryption:
the device mints a content key and wraps it for the service's public key, which
it fetches rather than has compiled in — so the same blob can later be re-wrapped
for a TEE's own key without re-encrypting anything. Every read is checked against
the keccak256 the chain holds, whichever copy answered.

### What we do not use, and why

**0G DA.** Nothing here is a high-throughput availability stream. A decorative
integration is worse than an absent one.

---

## 20% — Technical quality

```
843 tests    575 frontend · 157 server · 111 contract
             (91 unit, 15 fuzz, 5 invariant)
174 seeded faults, 169 caught, 5 proven equivalent with measured evidence
```

Both numbers come from `node scripts/counts.mjs` and `node scripts/mutate.mjs`.
Nothing in any document here was typed from memory.

**Mutation testing is the one worth looking at.** A passing suite proves the
tests run. Deliberately breaking a calorie floor, a deficit cap or a plate
calculation and checking the tests notice proves they would catch a wrong number
reaching somebody's diet or a loaded bar.

**Five guard tests, each named after a real failure:** the seal disagreeing with
the reader; attestation not being checked; the Dockerfile missing a module
(three times); either ABI missing a call it makes; anything sensitive reaching
0G Storage in the clear.

```bash
./verify.sh            # everything except mutation and live
./verify.sh live       # the deployed contract, over RPC — no local file counts
```

A filter matching zero checks **fails**, so a typo cannot look like a green run.
And the run prints what it does not automate.

---

## 10% — Traction & communication

- **Documentation:** [README](README.md) · [ARCHITECTURE](ARCHITECTURE.md) ·
  [VERIFICATION](VERIFICATION.md) · [SECURITY](SECURITY.md) ·
  [THREAT-MODEL](THREAT-MODEL.md) · [CHANGELOG](CHANGELOG.md)
- **Walk it with no wallet:** four links and one command, in the README.
- **On chain right now:** 5 coaches, 3 listed for rent, one past version 1,
  contract balance zero. `npm run evidence` reads all of it live.

### Not done, stated rather than omitted

- **Mainnet.** The relayer holds 0.46 0G on Galileo and nothing on Aristotle.
  `npm run go-mainnet` is written and waiting on funding.
- **CI.** The workflow is written; pushing `.github/workflows/` needs a token
  scope the repository owner has to grant.
- **Demo video and the public X post.** The owner is handling both.
- **Real users.** There are none yet. The addresses above are ours, and the
  coach owned by a zero-balance address was generated by a script — which
  demonstrates the mechanism honestly and is not a user.

---

## Non-negotiables

**Does it solve a real problem?** Losing years of training history when an app
shuts down is a thing that happens to people. So is handing health data to a
company because the coach needs it.

**Does the AI provide real value?** The coach reads the training you actually
logged, writes down what changed in sentences you can read, and that record is
inside the payload the chain hashes — so `version 12` is twelve things it can
tell you about yourself rather than a counter.

**Does the blockchain provide real value?** It is what makes the coach outlive
us. Ownership that no admin can revoke, a version history nobody can rewrite,
and rental payments that reach a trainer inside the same transaction that grants
access — from a contract with no withdraw function.

> **The model writes the workout. The chain decides who owns the coach.
> The model cannot touch the second one.**
