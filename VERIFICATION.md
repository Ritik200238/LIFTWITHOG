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
| `CoachAgent` (ERC-7857) is deployed and readable | [`0xe0bd5144dd254422c1fE4eA8a62A23C3ca52AfB2`](https://chainscan-galileo.0g.ai/address/0xe0bd5144dd254422c1fE4eA8a62A23C3ca52AfB2) on the 0G explorer |
| It answers for both 7857 interfaces **on chain** | `cast call 0xe0bd5144dd254422c1fE4eA8a62A23C3ca52AfB2 "supportsInterface(bytes4)(bool)" 0x4b396f04 --rpc-url https://evmrpc-testnet.0g.ai` → `true`; same for `0x35d39512` (`IERC7857Authorize`) |
| …and says **no** to an interface nothing implements | same call with `0xdeadbeef` → `false`. This is the row that makes the two above it mean anything: a stub answering `true` to everything passes them and fails only this. |
| The ERC-7857 transfer actually transfers | `node --env-file=server/.env scripts/prove-transfer.mjs` — mints, re-keys for a fresh buyer, calls `iTransferFrom`, then shows a replayed attestation and one signed for a different buyer both refused. [transfer tx](https://chainscan-galileo.0g.ai/tx/0x4b4bc5ae2cc2e1f61140ad41c3bc7ad799b80ed0319517937b7b9cd2d228bb99) |
| The transfer verifier is what the coach says it is | `cast call 0xe0bd5144dd254422c1fE4eA8a62A23C3ca52AfB2 "transferVerifier()(address)"` → [`0xc0d95348dA0eD829f400FA3eF04fDb7e67A5a12B`](https://chainscan-galileo.0g.ai/address/0xc0d95348dA0eD829f400FA3eF04fDb7e67A5a12B), read off the contract doing the guarding rather than configured here |
| Coaches exist and evolve | `cast call <addr> "totalMinted()(uint256)" --rpc-url https://evmrpc-testnet.0g.ai` — non-zero, and grows as the app is used |
| The brain is hash-anchored | `getIntelligentDatas(tokenId)` returns the keccak256 the server verifies ciphertext against before every answer |
| The contract never holds funds | read its balance on the explorer — zero — then see the invariant that keeps it so: `invariant_ContractNeverHoldsFunds` in `contracts/test/CoachAgentFuzz.t.sol` |
| A trainer lists without holding a token | list a coach in the app, then `cast call <addr> "rentalPrice(uint256)(uint256)" <id>` — non-zero, set by an owner whose balance is 0 |
| The coach records what it learned | open **What it knows** in the app: each version's sentences travelled inside the payload whose hash `coachOf(tokenId)` returns |
| The coach is a registered ERC-8004 Trustless Agent | agent **#382** on 0G's Identity Registry — `cast call 0x8004A818BFB912233c491871b3d84c89A494BD9e "tokenURI(uint256)(string)" 382 --rpc-url https://evmrpc-testnet.0g.ai` returns our agent card, and `ownerOf(382)` returns the wallet that registered it |
| Its agent card is public and served by the app | [liftwithog.vercel.app/agent-card.json](https://liftwithog.vercel.app/agent-card.json) — capabilities, standards, and the limitations we refuse to hide |
| No admin can touch your coach | read the source: no owner role, no pause, no upgrade hook, `transferVerifier` immutable |

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
npm --prefix frontend test     # 543 tests — app logic, nutrition, coach memory, sync, offline
npm test                       # 103 tests  — server, storage backends, rate limits, auth, sync
cd contracts && forge test     # 88 tests  — 42 unit · 9 fuzz · 5 invariant · 18 ERC-7857 · 14 verifier
```

734 in total. `node scripts/counts.mjs` prints these by running the suites, and
is where every number in this repository's documents comes from — the previous
set was typed by hand and disagreed with itself in three places.

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
[`0xF003D9116147AF7Bbc1E50b7bc3b894a827C0D43`](https://chainscan-galileo.0g.ai/address/0xF003D9116147AF7Bbc1E50b7bc3b894a827C0D43),
listed at 0.0003 0G/day, balance **0.0 0G** —
[mint](https://chainscan-galileo.0g.ai/tx/0x86ded4a19776a96cf49ef4abcd8d85c403e778bbdada5201b18388e20042ac70)
· [listing](https://chainscan-galileo.0g.ai/tx/0xb0d24b1ae3985241a20ce1b997091f6564bddcb4434d765191a359b465a0d38e).

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
