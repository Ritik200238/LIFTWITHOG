<div align="center">

<img src="assets/app/banner.svg" alt="LIFTWITHOG — the AI coach you own, an ERC-7857 agent on 0G" width="100%"/>

<br/>

[![tests](https://img.shields.io/badge/tests-857%20passing-30d158?style=flat-square)](VERIFICATION.md#the-test-suites)
[![mutation](https://img.shields.io/badge/mutation-174%20faults%20·%20169%20caught-30d158?style=flat-square)](scripts/mutate.mjs)
[![contract](https://img.shields.io/badge/contract-111%20Foundry%20·%20fuzz%20%2B%20invariants-4b9fd1?style=flat-square)](contracts/test)
[![erc7857](https://img.shields.io/badge/ERC--7857-verified%20on--chain-a78bfa?style=flat-square)](VERIFICATION.md#the-contract)
[![erc8004](https://img.shields.io/badge/ERC--8004-agent%20%233568516-a78bfa?style=flat-square)](https://liftwithog.vercel.app/agent-card.json)
[![0g](https://img.shields.io/badge/0G%20Chain-live%20on%20mainnet-e0655f?style=flat-square)](https://chainscan.0g.ai/address/0x94ce4680890ab16b52e3f1a9cdf25c1b01e119b5)
[![demo](https://img.shields.io/badge/demo-2%3A29%20·%20watch-e8452c?style=flat-square)](assets/demo/liftwithog-demo.mp4)
[![pwa](https://img.shields.io/badge/PWA-offline--first-d9a94a?style=flat-square)](frontend/public/sw.js)

# The AI coach you own.

**Not a subscription. Property.** It learns from the workouts you finish. What it learns is
recorded on 0G Chain, its brain is encrypted on 0G Storage, and its advice runs sealed inside
a TEE on 0G Compute. Delete the app — your coach, its history and its rental income are still there.

### ▶ **[liftwithog.vercel.app](https://liftwithog.vercel.app)** &nbsp;·&nbsp; Prove it from your own browser: **[/#/verify](https://liftwithog.vercel.app/#/verify)**

No wallet. No seed phrase. No extension. Open it on a phone and you have a coach on 0G in thirty seconds.

<br/>

[![Watch the demo — 2:29](assets/demo/poster.png)](https://raw.githubusercontent.com/Ritik200238/LIFTWITHOG/main/assets/demo/liftwithog-demo.mp4)

**[▶ Watch the demo — 2:29](https://raw.githubusercontent.com/Ritik200238/LIFTWITHOG/main/assets/demo/liftwithog-demo.mp4)** &nbsp;·&nbsp; <sub>8.8 MB mp4 · plays in any player</sub>

*Every frame is the live app. A coach minted on camera in 28 seconds, a TEE-attested answer,
and `0xdeadbeef` returning false on the verify page — nothing staged, nothing mocked.*

</div>

---

## In sixty seconds

Every line below has a command, a transaction, or a test behind it. Not one is a promise.

| | The claim | Check it |
|---|---|---|
| 🏋️ | **A complete gym product first.** 1,324 animated exercises, plate math, warm-up ramps, an India-first nutrition engine, 11 languages, offline-first. People would use this with the chain switched off. | [Open it](https://liftwithog.vercel.app) |
| 🧠 | **The coach learns, and you can read what it learned.** Every ten sessions it re-derives itself from your real training, writes down *what changed*, re-encrypts, and `evolve()`s on chain. Version 12 is twelve sentences about you. | [`coach-runtime.js`](server/coach-runtime.js) |
| 🔑 | **Owned from a phone with no wallet and no gas — and still yours.** A device key signs; our relayer pays. The owner's address is *inside* the signed message, so the relayer can pay but cannot redirect. Coach `#1`'s owner has never held a coin. | [tx](https://chainscan.0g.ai/tx/0xf1df10c55fa5cef58436f99dde949ddd43bfd377e61bddfa5f40e590c8735c25) · [owner](https://chainscan.0g.ai/address/0xF82915a4d6B05D0700949d0a6e0c4a6b70c64c35) |
| 🔒 | **Advice that proves where it ran, or refuses.** Every answer is TEE-attested on 0G Compute, attestation checked per response. No attested provider — the coach says so. There is no unattested fallback, and a test fails if one is added. | [`coachCompute.test.js`](server/coachCompute.test.js) |
| 🛡️ | **A contract with no owner, no pause, no upgrade, no admin key.** Nobody — including us — can freeze your coach or rewrite the rules under you. One grep proves the absence. | [below](#what-this-contract-cannot-do-to-you) |
| 💸 | **Trainers earn without holding a token.** `rent()` grants access and pays the trainer in the same transaction. `clone()` builds a lineage that pays each generation. The contract's balance is always zero — an invariant drives thousands of random calls to prove it. | [`CoachAgentFuzz.t.sol`](contracts/test/CoachAgentFuzz.t.sol) |
| 🧪 | **The numbers regenerate themselves.** 857 tests, 174 seeded faults, and a check that fails CI if any document disagrees with the suites. | `node scripts/counts.mjs --check` |

---

## The product

<div align="center">

<img src="assets/app/library.png" alt="Sixty of the 1,324 exercises — every one animated, with the working muscles highlighted" width="100%"/>

*1,324 exercises. Every one animated, every one showing the muscles it works. Search by body part, equipment, or name; add your own.*

<br/>

<table>
  <tr>
    <td><img src="assets/app/home.png" alt="Home — the week, your coach, body-weight trend and streak" width="100%"/></td>
    <td><img src="assets/app/workout.png" alt="Active workout — set logged, rest timer running, per-set tracking" width="100%"/></td>
    <td><img src="assets/app/nutrition.png" alt="Nutrition — targets computed from your own weigh-ins" width="100%"/></td>
  </tr>
  <tr>
    <td align="center"><em>Your coach lives on the home screen — created in one tap, no wallet, then learning from every session</em></td>
    <td align="center"><em>Mid-set: 80 kg logged, set ticked, rest timer running — one hand, plate math and warm-up ramps a tap away</em></td>
    <td align="center"><em>Mifflin-St Jeor targets, hard safety bounds, IFCT foods</em></td>
  </tr>
  <tr>
    <td><img src="assets/app/coaches.png" alt="Coach market — rent a trainer's coach; payment settles to the trainer atomically" width="100%"/></td>
    <td><img src="assets/app/verify.png" alt="/verify — chain id, block and coaches minted, read live from the visitor's own browser" width="100%"/></td>
    <td align="center" valign="middle">
      <b>Install it like an app</b><br/><br/>
      <b>Android</b> · Chrome → ⋮ → Add to Home screen<br/>
      <b>iPhone</b> · Safari → Share → Add to Home Screen<br/><br/>
      <sub>Opens with no signal. Screen stays awake mid-set. Timers beep from your pocket. Every control ≥ 44 px to a thumb — measured, not eyeballed.</sub>
    </td>
  </tr>
  <tr>
    <td align="center"><em>The market — real coaches, priced in 0G, payment atomic with access</em></td>
    <td align="center"><em><a href="https://liftwithog.vercel.app/#/verify">/verify</a> reads 0G from <b>your</b> browser, not our server</em></td>
    <td></td>
  </tr>
</table>

</div>

Built for the gym, not the desk. Every screen is designed one-handed, mid-set, with chalk on the glass.
Your coach's key is generated on the phone and never leaves it — the phone *is* the wallet — and
Settings → *Your coach's key* shows the twelve BIP-39 words, so the same account opens in any wallet
and restores on any device.

---

## The proof — read the chain, not this file

`CoachAgent` is deployed at
[`0x94ce4680890ab16b52e3f1a9cdf25c1b01e119b5`](https://chainscan.0g.ai/address/0x94ce4680890ab16b52e3f1a9cdf25c1b01e119b5),
wired to an immutable transfer verifier at
[`0x70c4dE9D0edbE53733821558Bf6b14b64451e56E`](https://chainscan.0g.ai/address/0x70c4dE9D0edbE53733821558Bf6b14b64451e56E).
Ask the bytecode — not us — whether it speaks ERC-7857:

```bash
$ for id in 0x4b396f04 0x35d39512 0xd79f01c7 0xdeadbeef; do
    cast call 0x94ce4680890ab16b52e3f1a9cdf25c1b01e119b5 \
      "supportsInterface(bytes4)(bool)" $id --rpc-url https://evmrpc.0g.ai
  done
true     # 0x4b396f04  ERC-7857
true     # 0x35d39512  ERC-7857 Authorize
true     # 0xd79f01c7  ERC-7857 Cloneable
false    # 0xdeadbeef  ← the control
```

**The last line is the one worth reading.** A stub that answers `true` to everything passes the
three above it and fails only that one. Without a control, three green ticks prove nothing.
The same four are read live, in your browser, on [/#/verify](https://liftwithog.vercel.app/#/verify).

**Every ERC-7857 verb has run on this contract, not just compiled:**

| | What happened | On chain |
|---|---|---|
| Gasless mint | A key generated on the spot, funded with nothing, owns coach `#1` and listed it for rent | [mint](https://chainscan.0g.ai/tx/0xf1df10c55fa5cef58436f99dde949ddd43bfd377e61bddfa5f40e590c8735c25) · [listing](https://chainscan.0g.ai/tx/0x350484f7b255ca10cc004e2adcc22a159dd1ab113ef5a9d0830c0daf2e9076a1) |
| Rental, paid inside it | Coach `#1` rented for a day. The owner — a wallet holding **0.0 0G** — went to exactly the price, 0.0003 0G, in the transaction that granted access; the contract stayed at zero. Balances read before and after, not inferred from the event. | [rent](https://chainscan.0g.ai/tx/0xc361ef9e1c39733dba39386b0e53dbea78f6caf1ccbb6ba2d96620dc15b7f9a6) |
| Intelligent transfer | Brain re-encrypted to the buyer, attestor signs the hand-over, `iTransferFrom` moves it. The same attestation replayed — **refused**. Signed for somebody else — **refused**. | [transfer](https://chainscan.0g.ai/tx/0x7b4d771bb6a299e18a258ba20050835b83c059420d8d45daac2dd55d618f11b2) |
| Clone lineage | `#4 → #5 → #6`, three generations, each parent paid in full, `generationOf(6) → 3`. Not one address in the line has ever held a coin. | [gen 2](https://chainscan.0g.ai/tx/0x7b5411fe36804f4e9a23e48d3c96e5dfbb66fda798caf9a77fbcf51dc04122c3) · [gen 3](https://chainscan.0g.ai/tx/0x3f7efde8d1f185e9f5b5faf6c1cda5c34d0b3bfad0e4a31ec5ab366f94eaba57) |
| It learns, on chain | Coach `#7` minted then evolved twice by a device holding **0.0 0G** — `coachOf(7)` reads back version 3. This is the flywheel, not a description of it. | [v2](https://chainscan.0g.ai/tx/0x987e12489a122403dee9073f7889761fb8c0e5d5a68ba5ded272a5acabb47222) · [v3](https://chainscan.0g.ai/tx/0xa575820404690b5e22e42ca34a2c823fd83101fb17040259768775610695dd3d) |
| ERC-8004 identity | Registered as agent **#3568516** on 0G's canonical Trustless-Agents registry, discoverable by any 8004 indexer. | [registration](https://chainscan.0g.ai/tx/0xb8e3f824a7f2d5ea847ca7ff613f5380ade59805cc2e9fe6a8dedbc8ff673d7a) |
| The contracts themselves | `CoachAgent` and its immutable verifier, deployed in one block. Nothing was migrated in; this address starts here. | [CoachAgent](https://chainscan.0g.ai/tx/0xc2cc554f9ce486a11af5cec2d92142111c782ee702cdaaefaada77cc5a017ede) · [verifier](https://chainscan.0g.ai/tx/0x4e5578dae6a1b407100750936c7b4f1682c28ddda9e87e5afe5dba91537b8c6f) |
| Inference is paid for | The 0G Compute ledger the coach draws on, opened and funded on mainnet. Without it no attested provider answers, and the coach refuses. | [ledger](https://chainscan.0g.ai/tx/0x0d926c6db615a9d5554849dd2ee2633269a376931ed64f847a0f1fbf995a79a2) |
| Published rules | The literal system prompt and every nutrition bound, as a blob on 0G Storage with its hash anchored on chain. If the coach ever breaks its own rules, the rule is public and timestamped. | [anchor](https://chainscan.0g.ai/tx/0x7b4c890bb58f9c42708a2c79374c7a301ced41020dc8d231f67995b1a7f0897a) |

```bash
node scripts/verify-deployment.mjs 16661   # rebuilds the source and compares it to mainnet, byte for byte
npm run evidence                           # re-reads every one of the above from 0G, live
./verify.sh live                           # the deployed contract and the deployed site — no local file counts
```

**Reproducible deployment.** Both contracts show verified source on the explorer, and
[`deployments/16661.json`](deployments/16661.json) records every address, deploy transaction and
constructor argument — generated from forge's broadcast and the chain, not typed. The first command
above rebuilds this repository with the pinned compiler and checks each deploy transaction is exactly
that code plus exactly those arguments, then accounts for every immutable in the deployed bytecode.
Run from a fresh clone of this repo, it ends in `Every check passed`. How, and what it does not
prove: **[DEPLOYMENTS.md](DEPLOYMENTS.md)**.

The refusals are half the proof. A transfer that always succeeds is not a check.
Stated plainly, in the verifier's own source: the attestor is a software key held by the
re-encryption service, not a hardware enclave.

---

## What this contract cannot do to you

Most of what an agent NFT promises is undone by the admin key nobody mentions. A pausable
token is one wallet away from freezing every owner; an upgradeable one can be rewritten under
them. This contract has none of that, and the absence is one command:

```bash
grep -rc "Ownable\|AccessControl\|onlyOwner\|onlyRole\|Pausable\|whenNotPaused\|UUPS\|upgradeTo\|_authorizeUpgrade\|selfdestruct\|delegatecall" contracts/src
# every file: 0
```

| Power a contract usually keeps | Here |
|---|---|
| Pause minting, transfers or use | **Does not exist** |
| Upgrade the logic under owners | **Does not exist** — no proxy, no UUPS |
| An owner or admin role | **Does not exist** |
| Swap the transfer verifier or its attestor | **Impossible** — both `immutable` |
| Hold or divert your money | **Cannot** — fees leave in the same call; no withdraw function; `invariant_ContractNeverHoldsFunds` |

The cost is real and stated: **there is no admin to rescue anybody either.** Property whose
rules can be changed under it by a third party is custody wearing a different name.
Attestations carry a signed deadline for the same reason — one that never expires is a bearer token.

---

## What nobody else on 0G has shipped

- **A working clone economy.** ERC-7857 defines `clone()`; here it pays each generation and the
  descent is on chain, uneditable — including by whoever holds the third-generation copy.
- **Attestation you can re-check yourself.** `processResponse` is a boolean from an SDK. So the
  provider's raw signature over the answer is fetched too and recovered to the address 0G's
  contract says is theirs — `ethers.recoverAddress(hashMessage(text), sig) === signer`.
  Arithmetic anyone can run. Others wired this and shipped it disabled. Ours is on.
- **A coach that knows what it must not answer.** Torn meniscus, pregnancy, a testosterone dose,
  chest pain under a bar — it hands off to a specialist *before* the model runs, not after.
  Ordinary questions are untouched, and there is a test for each side.
- **A coach another agent can hire.** `GET /api/coach/5/service` answers **HTTP 402** with price,
  payee and the call that pays it. Payment is verified against *our own* `Rented` event, not a
  forgeable token transfer. Registered as **ERC-8004 agent #3568516** with a public
  [agent card](https://liftwithog.vercel.app/agent-card.json).
- **A progress card a stranger can verify.** Signed by the owner, published to 0G Storage, and
  every claim on it re-derived from the chain — including what it does *not* prove: *"that a
  human under a barbell lifted the weight."*
- **A verify page that runs in the visitor's browser.** Chain id, block height, coaches minted,
  the four interface answers — read by *your* device over RPC, so nothing here depends on
  trusting our server.

---

## 0G, module by module

| Module | Where | What it does here |
|---|---|---|
| **0G Chain** | [`CoachAgent.sol`](contracts/src/CoachAgent.sol) | The coach as property: ERC-7857 + ERC-721, versioned intelligent data, expiring rentals with atomic payout, clone lineage, grants voided on sale, EIP-712 relayed mint / evolve / list |
| **0G Compute** | [`coach-runtime.js`](server/coach-runtime.js) | TEE-attested inference, attestation verified per response, **fail-closed** — no attested provider means an honest error, never a downgrade |
| **0G Storage** | [`coach-runtime.js`](server/coach-runtime.js) · [`ogVault.js`](frontend/src/lib/ogVault.js) | The coach's encrypted brain, keccak256-anchored on chain and tamper-checked on every ask; the user's AES-256-GCM vault backups, encrypted **on the device** |
| **ERC-8004** | [`register-agent.mjs`](scripts/register-agent.mjs) | Agent **#3568516** on 0G's Identity Registry — discoverable by any 8004 indexer while ownership stays governed by 7857 |
| **ERC-7857** | [`contracts/src/interfaces/`](contracts/src/interfaces) | Interfaces vendored **verbatim** from 0G's `agenticID-examples`, so selectors match the ecosystem byte for byte |
| **0G DA** | — | **Deliberately not used.** Nothing here is a high-throughput stream, and a decorative integration is worse than an absent one |

Diagrams, flows and the trust model: **[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## The model writes the workout. The chain decides who owns the coach.

> Everything an AI produces here is a *suggestion* about training. Ownership, rental expiry,
> price and transfer are decided by a contract with no admin — so the worst a confused,
> jailbroken or malicious model can do is give bad advice. It cannot move a coach, extend a
> subscription, or pay itself. The separation is the thing to check rather than believe.

| Guarantee | Evidence |
|---|---|
| The contract never holds anyone's money | [`invariant_ContractNeverHoldsFunds`](contracts/test/CoachAgentFuzz.t.sol) — random call sequences |
| A sale voids every rental, in constant gas | [`testFuzz_SellingClearsEveryGrant`](contracts/test/CoachAgentFuzz.t.sol) |
| Renewing never steals paid days | [`testFuzz_RenewingExtendsAndNeverShortens`](contracts/test/CoachAgentFuzz.t.sol) — fuzzed to the last second |
| The oracle cannot override the owner | [`test_TheOracleCannotOverrideTheOwner`](contracts/test/CoachAgent7857.t.sol) |
| A tampered brain is detected, not trusted | keccak256 of fetched ciphertext vs the on-chain hash, every ask |
| Nothing sensitive reaches 0G Storage in the clear | [`ogVault.test.js`](frontend/src/lib/ogVault.test.js) — *"sends ciphertext, never the training history"* |
| Wrong numbers cannot reach a diet or a bar | 174 seeded faults; `node scripts/mutate.mjs` — 169 caught, 5 proven equivalent |

**857 tests**: 585 frontend · 161 server · 111 contract (91 unit, 15 fuzz, 5 invariant).
Every number in this file is printed by `node scripts/counts.mjs`, and CI fails if a document
disagrees with the suites. **[SECURITY.md](SECURITY.md)** lists ten findings we fixed with the
test that closed each, and the risks still open. **[THREAT-MODEL.md](THREAT-MODEL.md)** says
what an attacker cannot do, and why.

---

## Who this is for, and why they stay

Serious lifters already pay for a tracker, and every one of those trackers is a rented seat:
the history lives in a company's database and the "coach" is a feature that ships when the
company does. LIFTWITHOG is the tracker first — the thing a person opens six times a week in a
basement gym with no signal — and the ownership is what makes leaving cost nothing and staying
worth something. A trainer's method becomes an asset they rent out and clone. An athlete's coach
becomes a record they carry. Nobody is asked to learn a wallet to get either.

India first, because that is where the team trains: IFCT food data, protein by reference weight,
plate math in kilograms, Hindi among the eleven languages, and safety bounds a dietician would
recognise. Everything else works anywhere.

## Four questions people ask

**Can you read my training?**
No. The coach's method is sealed on your device with ECDH + AES-256-GCM before it leaves; the
server relays ciphertext it holds no key for. Backups are encrypted on the device too. A test
fails if a workout or a number appears in what leaves the browser — [`ogVault.test.js`](frontend/src/lib/ogVault.test.js).

**What happens if LIFTWITHOG disappears?**
Your coach is a token on 0G Chain owned by a key on your phone; its brain is on 0G Storage,
anchored by hash. Any ERC-7857 reader can find it, and the twelve words in Settings open the same
account in any wallet. The tracker itself works with no server at all.

**What do you actually own?**
The ERC-7857 Agentic ID, its full version history, the encrypted brain, the rental income and
the clone lineage. Not a licence to them — the contract has no admin, no pause and no upgrade,
so there is nobody who can take them back. Including us.

**What will the coach not do?**
Answer without an attested enclave. Improvise on a torn meniscus, a pregnancy, a hormone dose or
chest pain — it hands off to a specialist before the model runs. Break the nutrition floors and
caps, which are published and anchored on chain so a broken promise would be public.

---

## Run it · verify it

```bash
git clone https://github.com/Ritik200238/LIFTWITHOG && cd LIFTWITHOG
npm install && npm --prefix frontend install
cp server/.env.example server/.env        # RELAYER_PRIVATE_KEY + COACH_ADDRESS
node server/server.js                     # API on :3000
npm --prefix frontend run dev             # app on :5173

docker compose up -d                      # or: your own box, one origin, passkeys, media local
```

**Or run the API on somebody else's box, in one click:**

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Ritik200238/LIFTWITHOG)

That reads [`render.yaml`](render.yaml) — checked in, and checked by a test that builds nothing
but proves the blueprint points at a Dockerfile that exists, in a context that holds every file
it copies. It exists because the blueprint once pointed at a path that had moved and failed
every build in silence for five days, which is what a deploy target with nothing downstream
does when nobody is watching it.

Two honest notes: set `RELAYER_PRIVATE_KEY` and `COACH_SERVICE_KEY` in the dashboard, never in
the file — and the free plan has no disk, so accounts live until the next restart. Attach one,
or point `DATABASE_URL` at Postgres, for anything real.

```bash
./verify.sh              # suites · contracts · guards · release checks
./verify.sh live         # the deployed contract and site, over RPC — nothing local counts
npm run evidence         # every on-chain claim above, re-read from 0G
```

`live` reads nothing in this repository. "The tests pass" and "the deployed thing works" are
different claims, and this project once had the first true while the second was false. They
are never reported together again. Full list of every claim and how to check it: **[VERIFICATION.md](VERIFICATION.md)**.

---

## For judges

| | |
|---|---|
| Contract + explorer | [`0x94Ce…19B5`](https://chainscan.0g.ai/address/0x94Ce4680890ab16B52E3F1A9CDf25C1B01e119B5#code), source verified · minted, evolved, rented, transferred and cloned on chain, counted from events in [`deployments/16661.json`](deployments/16661.json) |
| Reproduce the deployment | **[DEPLOYMENTS.md](DEPLOYMENTS.md)** — one command rebuilds the source and checks it against mainnet byte for byte |
| Criterion-by-criterion | **[SUBMISSION.md](SUBMISSION.md)** — in order of weight, a command or transaction behind every claim, and a section naming what is not done |
| Proof of integration | `supportsInterface` answered by deployed bytecode with a control · `npm run evidence` · [/#/verify](https://liftwithog.vercel.app/#/verify) |
| Architecture · Security · Threats | [ARCHITECTURE.md](ARCHITECTURE.md) · [SECURITY.md](SECURITY.md) · [THREAT-MODEL.md](THREAT-MODEL.md) |
| Walk it with no wallet | Open the [app](https://liftwithog.vercel.app) → *Continue without account* → *Load starter plan* → *Create my coach*. Thirty seconds, no extension, and the coach is on 0G. |

<br/>

<sub>The workout-tracker core builds on the open-source <b>openGym</b> project. The 0G integration, <code>CoachAgent</code>, the coach runtime, the nutrition engine, the offline layer, the stateless server and everything above <code>1.0.0</code> in the <a href="CHANGELOG.md">changelog</a> is this project's work.</sub>

<div align="center">

**[Live app](https://liftwithog.vercel.app)** · **[Verify](https://liftwithog.vercel.app/#/verify)** · **[Architecture](ARCHITECTURE.md)** · **[Every claim, checked](VERIFICATION.md)** · **[Security](SECURITY.md)** · **[Threat model](THREAT-MODEL.md)** · **[Changelog](CHANGELOG.md)**

</div>
