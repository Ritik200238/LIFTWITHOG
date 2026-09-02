# Submission

Written against the four scoring criteria, in their order of weight. Every claim
here is a command you can run, a transaction you can open, or a file you can
read — and where something is not done, it says so rather than being left out.

**LIFTWITHOG** — the AI coach you own. A workout and nutrition tracker whose
coach is an ERC-7857 Agentic ID on 0G Chain, controlled by a key your device
generated, with an encrypted brain on 0G Storage and advice that runs only
inside a TEE-attested enclave on 0G Compute.

- **Live:** [liftwithog.vercel.app](https://liftwithog.vercel.app) · **Verify:** [/#/verify](https://liftwithog.vercel.app/#/verify)
- **CoachAgent:** [`0xe0bd5144dd254422c1fE4eA8a62A23C3ca52AfB2`](https://chainscan-galileo.0g.ai/address/0xe0bd5144dd254422c1fE4eA8a62A23C3ca52AfB2) (0G Galileo, 16602)
- **AttestedTransferVerifier:** [`0xc0d95348dA0eD829f400FA3eF04fDb7e67A5a12B`](https://chainscan-galileo.0g.ai/address/0xc0d95348dA0eD829f400FA3eF04fDb7e67A5a12B)
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
| **ERC-7857 transfer** | `address(0)` verifier, so `iTransferFrom` reverted on every call ever made, immutably. | [Moves a coach on chain](https://chainscan-galileo.0g.ai/tx/0x4b4bc5ae2cc2e1f61140ad41c3bc7ad799b80ed0319517937b7b9cd2d228bb99), with a replayed attestation and one signed for another buyer both refused. |
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

## 30% — 0G integration

Every pillar is load-bearing. Remove any one and the product stops working.

### 0G Chain

`CoachAgent` is a genuine ERC-7857 Agentic ID, and the interfaces are vendored
verbatim from 0G's own `agenticID-examples`. Ask the bytecode:

```bash
$ for id in 0x4b396f04 0x35d39512 0x80ac58cd 0xdeadbeef; do
    cast call 0xe0bd5144dd254422c1fE4eA8a62A23C3ca52AfB2 \
      "supportsInterface(bytes4)(bool)" $id --rpc-url https://evmrpc-testnet.0g.ai
  done
true  true  true  false
```

**The `false` is the one that matters.** `0xdeadbeef` is not an interface
anybody implements. A stub answering `true` to everything passes the three
before it. The same control is pinned in Foundry and read live on `/verify`.

- **All three 7857 mechanisms work** — transfer, authorize, and the intelligent
  data surface. No stubs, nothing disabled.
- **Gasless both ways.** [Coach #5](https://chainscan-galileo.0g.ai/address/0xF003D9116147AF7Bbc1E50b7bc3b894a827C0D43)
  is owned and listed for rent by an address holding **0.0 0G**
  ([mint](https://chainscan-galileo.0g.ai/tx/0x86ded4a19776a96cf49ef4abcd8d85c403e778bbdada5201b18388e20042ac70) ·
  [listing](https://chainscan-galileo.0g.ai/tx/0xb0d24b1ae3985241a20ce1b997091f6564bddcb4434d765191a359b465a0d38e)).
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
764 tests    542 frontend · 132 server · 90 contract
             (42 unit, 9 fuzz, 5 invariant, 20 ERC-7857, 14 verifier)
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
