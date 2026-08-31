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
| `CoachAgent` v1 is deployed and readable | [`0xE6CAcDcf1D370E64041Ac9e42D0550A78014259A`](https://chainscan-galileo.0g.ai/address/0xE6CAcDcf1D370E64041Ac9e42D0550A78014259A) on the 0G explorer |
| Coaches exist and evolve | `cast call <addr> "totalMinted()(uint256)" --rpc-url https://evmrpc-testnet.0g.ai` — non-zero, and grows as the app is used |
| v2 speaks ERC-7857 | `cast call <v2> "supportsInterface(bytes4)(bool)" <interfaceId> …` returns true for `IERC7857` and `IERC7857Authorize`; the ids are computed in `contracts/test/CoachAgent7857.t.sol` |
| The brain is hash-anchored | `getIntelligentDatas(tokenId)` returns the keccak256 the server verifies ciphertext against before every answer |
| The contract never holds funds | read its balance on the explorer — zero — then see the invariant that keeps it so: `invariant_ContractNeverHoldsFunds` in `contracts/test/CoachAgentFuzz.t.sol` |
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
npm --prefix frontend test     # 510 tests — app logic, nutrition, sync, offline shell
npm test                       # 64 tests  — server, storage backends, auth, sync rules
cd contracts && forge test     # 67 tests  — 42 unit · 9 fuzz · 5 invariant · 16 ERC-7857
```

## The one that matters most

```bash
node scripts/mutate.mjs
```

Breaks the code on purpose — 164 seeded faults across the nutrition engine,
meal planner, sync merge, plate math, warm-up ramps and service-worker
manifest — and fails unless the tests notice. 159 are caught; the 5 survivors
are each proven equivalent in the script itself, with measured evidence. This
is the difference between "the tests pass" and "the tests would catch a wrong
number that reaches a person's diet or a loaded bar."

## Gasless ownership (no wallet, still yours)

Mint a coach in the app (no wallet involved), open **Settings → Proof**, and
read the owner address it shows on the explorer: an address holding **0.0 0G**
that nonetheless owns the token, because the device signed and the relayer
paid. The EIP-712 domain the device signs under is pinned in
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
- `iTransferFrom` refuses until a production TEE/ZKP re-encryption oracle
  exists to verify proofs; we ship the refusal, not a fake pass.
- 0G DA is not integrated, because nothing in this product is a
  high-throughput availability stream, and decorative integrations are worse
  than absent ones.
