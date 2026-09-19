# Deployments

LIFTWITHOG runs on **0G Aristotle mainnet (chain 16661)**. This page says what is
deployed, where it came from, and how to check every part of that without trusting
us — no key, no account, nothing hosted by this project.

```bash
git clone https://github.com/Ritik200238/LIFTWITHOG && cd LIFTWITHOG
npm ci && (cd contracts && npm ci)      # Foundry must be installed for the bytecode checks
node scripts/verify-deployment.mjs 16661
```

That last command ends in `Every check passed.` It was run from a fresh clone of
the public repository before this page was written.

---

## What is deployed

| Contract | Address | Deployed in | Source |
|---|---|---|---|
| `CoachAgent` — ERC-7857 + ERC-721 | [`0x94Ce4680890ab16B52E3F1A9CDf25C1B01e119B5`](https://chainscan.0g.ai/address/0x94Ce4680890ab16B52E3F1A9CDf25C1B01e119B5#code) | [tx](https://chainscan.0g.ai/tx/0xc2cc554f9ce486a11af5cec2d92142111c782ee702cdaaefaada77cc5a017ede), block 43752560 | verified on chainscan |
| `AttestedTransferVerifier` | [`0x70c4dE9D0edbE53733821558Bf6b14b64451e56E`](https://chainscan.0g.ai/address/0x70c4dE9D0edbE53733821558Bf6b14b64451e56E#code) | [tx](https://chainscan.0g.ai/tx/0x4e5578dae6a1b407100750936c7b4f1682c28ddda9e87e5afe5dba91537b8c6f), block 43752560 | verified on chainscan |

Built from commit [`55f46d4`](https://github.com/Ritik200238/LIFTWITHOG/commit/55f46d4421eb7b6d8cae6d1a16eeb70ae9f6f8e1) with
solc `0.8.28+commit.7893614a`, optimizer 200 runs, via-IR, EVM `cancun`.

The rest of the stack on the same chain:

| | |
|---|---|
| ERC-8004 identity | agent **#3568516** on 0G's registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` — [registration](https://chainscan.0g.ai/tx/0xb8e3f824a7f2d5ea847ca7ff613f5380ade59805cc2e9fe6a8dedbc8ff673d7a) |
| 0G Compute | the ledger the coach pays inference from — [funded](https://chainscan.0g.ai/tx/0x0d926c6db615a9d5554849dd2ee2633269a376931ed64f847a0f1fbf995a79a2) |
| Published rules | the coach's system prompt and nutrition bounds on 0G Storage, commitment [anchored](https://chainscan.0g.ai/tx/0x7b4c890bb58f9c42708a2c79374c7a301ced41020dc8d231f67995b1a7f0897a) — see [`policy-provenance.json`](policy-provenance.json) |

The machine-readable version of all of this is [`deployments/16661.json`](deployments/16661.json).
Forge's own record of the deploy is published beside it:
[`contracts/broadcast/Deploy.s.sol/16661/run-latest.json`](contracts/broadcast/Deploy.s.sol/16661/run-latest.json).

---

## What the check proves

`verify-deployment.mjs` reads the record and then trusts none of it. Each line of its
output is one claim with its own PASS or FAIL.

**The deploy transaction is this source, exactly.** The input of each deploy
transaction is compared, byte for byte, to what this repository compiles to with the
pinned compiler, followed by the ABI-encoded constructor arguments the record states.
For `CoachAgent` that is 17,356 bytes with no tolerance anywhere. This one check pins
the source, the compiler, its settings and the arguments at once.

**The code at the address is that code.** The runtime code on chain is compared to the
compiled runtime code. The only bytes allowed to differ are the contract's
immutables — the slots the constructor writes.

**Every immutable is accounted for.** Masking those slots is only honest if they are
then checked, so each one is named from the compiler's syntax tree and must hold the
value its rule produces. `CoachAgent` has eight: the verifier it is wired to, and seven
that OpenZeppelin's EIP712 caches at construction — the chain id, the contract's own
address, the hashed name and version, the domain separator (recomputed from its
definition here, and checked in tests against ethers' independent implementation), and
the name and version themselves. An immutable with no rule fails; it is not skipped.

**The source is published.** Both contracts show verified Solidity on 0G's explorer.

**The wiring is what the record says.** The coach names the recorded verifier; the
verifier names the recorded attestor. Both are `immutable` — there is no function
that could change either.

**The stack exists.** The ERC-8004 registration resolves to our agent card; the compute
ledger funding went to the ledger contract; the policy commitment is the calldata of
its anchor transaction.

**The activity is what the chain says.** Mints, evolves, rentals, transfers and clone
generations are re-counted from the contract's events and compared to the record. The
contract's balance is checked to be zero.

Anything it cannot run — Foundry missing, the explorer not answering — is reported as
`NOT VERIFIED`, never as a pass.

The check was tested by trying to fool it: a record claiming a different verifier, one
over-claiming the number of rentals, and one naming the wrong deploy transaction were
each caught, with the reason. The unit tests in [`scripts/deployment.test.mjs`](scripts/deployment.test.mjs)
do the same with a flipped byte, a slot holding another address, and an extra
constructor argument.

---

## How the record is made

Nothing in [`deployments/16661.json`](deployments/16661.json) is typed. Addresses,
deploy transactions and constructor arguments come from forge's broadcast; the compiler
and its settings from the build artifact; blocks, code hashes and all on-chain activity
from the chain itself.

```bash
node scripts/deployment-record.mjs 16661      # regenerate from the broadcast and the chain
```

This exists because the records written by hand drifted. The README once linked six
mainnet transactions while twelve had happened; `policy-provenance.json` named a testnet
anchor for a week after the mainnet one existed. The scripts that do the work now write
their own records: `publish-policy.mjs` writes the policy anchor, `fund-compute.mjs`
records every funding transaction.

---

## Deploying your own

```bash
node --env-file=server/.env scripts/go-mainnet.mjs
```

Five steps: deploy (or reuse the recorded deployment when it is live), check the
bytecode answers for ERC-7857 and refuses the `0xdeadbeef` control, register with
ERC-8004, publish the verified source, write the record and run the independent check.
It does not report success unless that check passes. Running it a second time sends no
transactions — measured, not assumed. Replacing a live deployment takes `--redeploy`.

It deliberately does not repoint the live app; that step is printed, for a person to do
with the addresses in hand.

---

## What this does not prove

- **That the running app uses this contract.** Checked separately, by reading the live
  site's JavaScript: `./verify.sh live`, line *"the deployed app carries the contract this
  repo deploys"*.
- **That the attestor key is safe.** The verifier trusts one key. It is immutable, so it
  cannot be swapped — and for the same reason it cannot be rotated. See
  [SECURITY.md](SECURITY.md).
- **That the coach's advice is any good.** Attestation proves where a model ran, not
  whether it was right.
