# Verification

Every material claim this project makes, with the command, URL, or contract
call that settles it — so nothing has to be taken on our word. The in-app
version of this page is public at
**[liftwithog.vercel.app/#/verify](https://liftwithog.vercel.app/#/verify)**
and reads the chain live from *your* browser.

Network today: **0G Galileo testnet** (chain id `16602`). The mainnet
(Aristotle, `16661`) deployment lands under the same process; this file gains
the address the day it does.

---

## The contract

| Claim | Check |
|---|---|
| `CoachAgent` (ERC-7857) is deployed and readable | [`0x0253fb92F9e88E82Fb0632C076C88204e4400025`](https://chainscan-galileo.0g.ai/address/0x0253fb92F9e88E82Fb0632C076C88204e4400025) on the 0G explorer |
| It answers for both 7857 interfaces **on chain** | `cast call 0x0253fb92F9e88E82Fb0632C076C88204e4400025 "supportsInterface(bytes4)(bool)" 0x4b396f04 --rpc-url https://evmrpc-testnet.0g.ai` → `true`; same for `0x35d39512` (`IERC7857Authorize`) |
| …and says **no** to an interface nothing implements | same call with `0xdeadbeef` → `false`. This is the row that makes the two above it mean anything: a stub answering `true` to everything passes them and fails only this. |
| The ERC-7857 transfer actually transfers | `node --env-file=server/.env scripts/prove-transfer.mjs` — mints, re-keys for a fresh buyer, calls `iTransferFrom`, then shows a replayed attestation and one signed for a different buyer both refused. [transfer tx](https://chainscan-galileo.0g.ai/tx/0x8c60c34aa35f1685c6c7c74ee0ce7f0d875168613a9933666b8f06f3b46318ea) |
| The transfer verifier is what the coach says it is | `cast call 0x0253fb92F9e88E82Fb0632C076C88204e4400025 "transferVerifier()(address)"` → [`0xAb4553bA4C93E6e332580FA69af1E77E1d15E44B`](https://chainscan-galileo.0g.ai/address/0xAb4553bA4C93E6e332580FA69af1E77E1d15E44B), read off the contract doing the guarding rather than configured here |
| Coaches exist and evolve | `cast call <addr> "totalMinted()(uint256)" --rpc-url https://evmrpc-testnet.0g.ai` — non-zero, and grows as the app is used |
| The brain is hash-anchored | `getIntelligentDatas(tokenId)` returns the keccak256 the server verifies ciphertext against before every answer |
| The contract never holds funds | read its balance on the explorer — zero — then see the invariant that keeps it so: `invariant_ContractNeverHoldsFunds` in `contracts/test/CoachAgentFuzz.t.sol` |
| A trainer lists without holding a token | list a coach in the app, then `cast call <addr> "rentalPrice(uint256)(uint256)" <id>` — non-zero, set by an owner whose balance is 0 |
| The coach records what it learned | open **What it knows** in the app: each version's sentences travelled inside the payload whose hash `coachOf(tokenId)` returns |
| The coach is a registered ERC-8004 Trustless Agent | agent **#382** on 0G's Identity Registry — `cast call 0x8004A818BFB912233c491871b3d84c89A494BD9e "tokenURI(uint256)(string)" 382 --rpc-url https://evmrpc-testnet.0g.ai` returns our agent card, and `ownerOf(382)` returns the wallet that registered it |
| Its agent card is public and served by the app | [liftwithog.vercel.app/agent-card.json](https://liftwithog.vercel.app/agent-card.json) — capabilities, standards, and the limitations we refuse to hide |
| No admin can touch your coach | read the source: no owner role, no pause, no upgrade hook, `transferVerifier` immutable |
| The rules the coach follows are public, and fixed to a moment | the literal system prompt and every nutrition bound are published unencrypted on 0G Storage at root `0x8ce20d59…a9630c`, sha256 `0x76cc63fc…f4e3df`, with a commitment binding the two [anchored on chain](https://chainscan-galileo.0g.ai/tx/0x4d82b9b127953c35d5088030509a5dbbee85b0f94571f63e84ee056569731faa). `node --env-file=server/.env scripts/publish-policy.mjs` recomputes the same hash from the code. See [`policy-provenance.json`](policy-provenance.json). |

## One command, most of the claims

```bash
npm run evidence
```

Reads the chain live and checks: the contract is deployed, coaches exist with
climbing versions, owners hold zero gas (relayed ownership is real), the
contract custodies nothing, and a TEE-attested provider is currently live on
0G Compute. Prints what it found; fails loudly on what it can't confirm.

## The test suites

```bash
npm --prefix frontend test     # 578 tests — app logic, nutrition, coach memory, sync, offline
npm test                       # 157 tests  — server, storage backends, rate limits, auth, sync
cd contracts && forge test     # 111 tests — 91 unit · 15 fuzz · 5 invariant
```

846 in total. `node scripts/counts.mjs` prints these by running the suites, and
is where every number in this repository's documents comes from — the previous
set was typed by hand and disagreed with itself in three places.

One number needs a footnote, because forge's own summary disagrees with it.
Foundry 1.8 runs a suite's invariants as **one shared campaign** — a single
sequence of random calls with every invariant asserted after each step — and
reports that campaign as one test. So our five invariants count as five under
1.7.1 and as one under 1.8.1, and `forge test` prints "107 tests passed" where
this document says 111. All five run and pass on both; only the arithmetic
moved. The count here comes from `forge test --list`, which names every test
function that will run and answers the same on either version — a number in a
document must not depend on which morning the toolchain was installed.

## The one that matters most

```bash
node scripts/mutate.mjs
```

Breaks the code on purpose — 174 seeded faults across the nutrition engine,
meal planner, coach memory, sync merge, plate math, warm-up ramps and the
service-worker manifest — and fails unless the tests notice. 169 are caught; the 5 survivors
are each proven equivalent in the script itself, with measured evidence. This
is the difference between "the tests pass" and "the tests would catch a wrong
number that reaches a person's diet or a loaded bar."

## Gasless ownership (no wallet, still yours)

`node --env-file=server/.env scripts/prove-gasless.mjs` generates a key on the
spot, funds it with nothing, and drives both actions through the relayer. From a
run of it: coach **#5**, owner
[`0x885715F1f33aFfBaD28b21C7a048be40336da42e`](https://chainscan-galileo.0g.ai/address/0x885715F1f33aFfBaD28b21C7a048be40336da42e),
listed at 0.0003 0G/day, balance **0.0 0G** —
[mint](https://chainscan-galileo.0g.ai/tx/0xc6e4c9688b4b77cb15be6dfc390d5a3b2f8b64ba205159ecd1338c27fea54cc1)
· [listing](https://chainscan-galileo.0g.ai/tx/0x2f73ae2b66167c9877ef6de816e2d1b5da1e9c776b5ce9154b02ae4a9584b2a1).

Or do it by hand: mint a coach in the app (no wallet involved), open
**Settings → Proof**, and read the owner address it shows on the explorer. The EIP-712 domain the device signs under is pinned in
`frontend/src/lib/deviceKey.js` and must match the contract's — a mismatch
fails every mint, which is itself the check.

## TEE-attested inference

Ask the coach anything. The server path (`server/coach-runtime.js`) selects
only `TeeML`-attested providers from the 0G Compute marketplace and verifies
the attestation on each response; with none live it returns an error rather
than an unattested answer. `npm run evidence` names the attested provider it
found at run time.

## Encrypted storage

- **Coach brain**: chain holds `(dataHash, URI)`; the server refuses a config
  whose keccak256 doesn't match (`config_tampered` in `server/coach-runtime.js`).
- **Vault**: `frontend/src/lib/ogVault.js` — AES-256-GCM, key derived on the
  device; what 0G Storage receives is ciphertext. Round-trip it from Settings:
  back up, wipe, restore by root hash.

## The failure matrix

What this system does when somebody tries something it should refuse. A product
that only documents its happy path is documenting the half nobody attacks — and
"it is secure" is a claim, while a named revert is a fact.

Every row below is driven by a test, and the on-chain ones are driven against
the deployed contract by `scripts/prove-transfer.mjs`.

### On chain

| Attempt | Result |
|---|---|
| Rent a coach that is not listed | `NotForRent()` |
| Rent for 0 days, or more than a year | `BadDuration()` |
| Pay anything other than the exact cost | `WrongPayment(expected)` |
| Set a price on a coach you do not own | `NotCoachOwner()` |
| Use a relayed signature after its deadline | `SignatureExpired()` |
| Replay a relayed signature | `WrongSignature()` — the nonce moved |
| Alter the owner in a relayed message | `WrongSignature()` — the owner is signed data |
| Read anything about a coach that does not exist | `NoSuchCoach()` |
| Transfer with an attestation signed by anybody else | `TransferProofRejected()` |
| Transfer with an attestation for a different coach | `TransferProofRejected()` |
| Transfer with an attestation for a different buyer | `TransferProofRejected()` |
| Swap the sealed key under a genuine attestation | `TransferProofRejected()` |
| Replay a spent attestation after buying the coach back | `TransferProofRejected()` |
| Drain the contract | there is no withdraw function, and an invariant test asserts its balance is always zero |
| Pause, upgrade or reassign a coach | there is no owner role and no proxy |

### At the API

| Attempt | Result |
|---|---|
| Ask a coach you have no rental on | `403 no_access` — checked on chain, never cached |
| Ask with a signature older than its window | `401 expired` |
| Ask with a signature made for another coach | `403 no_access` — the token id is inside the signed message |
| Ask a coach to recite its own configuration | `422 refused` — checked in the answer, not asked for in the prompt |
| Ask a coach about a torn ligament, a pregnancy, a drug dose or chest pain | `422 out_of_scope` — refused **before** the model, so the answer is never generated. The reply carries a referral rather than an error |
| Read the coaching record of a coach you rent | `403 not_owner` — renting buys questions, not somebody's training history |
| Ask when no attested provider will vouch | `503 no_tee` — never an unattested answer |
| Fetch a coach whose stored blob does not match the chain | `502 config_tampered` |
| Fetch a coach sealed for a different service key | `422 bad_config` — named as that, not as tampering |
| Exceed the per-address hourly limit | `429 too_many` |
| Exceed the whole service's daily budget | `429 budget_spent` — keyed on a constant, so a fresh address does not help |
| Hire a coach by quoting a transaction hash you did not send | `403 not_the_renter` — the payment must name you, and a cached answer is only returned to that address |
| Hire a coach with a `Rented` event from a contract you deployed | `402 payment_not_found` — the log must come from our contract |
| Hire a coach with a payment for a different coach | `402 payment_not_found` |
| Hire a coach on a rental that has since expired | `403 no_access` — the chain is asked, not the receipt |
| Quote a coach nobody has listed | `409 not_for_rent` — a different answer from "you have not paid", which would be retried forever |
| Clone a coach its owner has not offered | `NotCloneable()` |
| Clone for anything other than the exact price | `WrongPayment(required)` |
| Price somebody else's coach for cloning | `NotCoachOwner()` |
| Edit where a clone came from | there is no function that writes the lineage except cloning |
| Walk a lineage deeper than the caller allows | `generationOf` returns `complete: false` rather than exceeding the gas cap |
| Publish a progress card about a coach you do not own | `403 not_owner` |
| Edit a card's claim after signing it | the signature recovers to a different address than the card names, and `valid` is false |
| Claim more versions, or a longer history, than the chain records | the version and the mint event are re-read; `valid` is false |
| Publish a card, then sell the coach | the card stays readable and becomes invalid — not an error, because a sale is not fraud |
| Point at a storage root holding something that is not a card | `422 bad_card` |
| Forge `X-Forwarded-For` to reset a limit | ignored — the caller is identified by a header the caller cannot write |
| Relay when the wallet is nearly empty | `503 relayer_empty`, before spending rather than during |

## What we do NOT claim

- Testnet rentals move test tokens, not money — the mechanism is real, the
  value isn't yet.
- A device signature proves a device agreed, not that a human lifted what was
  typed.
- Attestation proves *where* the model ran and that the channel was sealed —
  not that its advice is wise.
- `iTransferFrom` works, and the key that attests to the re-encryption is
  **software, not hardware** — it is the service that performs the
  re-encryption, signing that it did. Weaker than a TEE quote, and said in the
  verifier contract's own source rather than only here. It was previously
  deployed with `address(0)` and reverted on every call ever made against it;
  `node --env-file=server/.env scripts/prove-transfer.mjs` now moves a coach on
  chain and shows a replayed attestation and one signed for a different buyer
  both being refused.
- 0G DA is not integrated, because nothing in this product is a
  high-throughput availability stream, and decorative integrations are worse
  than absent ones.
