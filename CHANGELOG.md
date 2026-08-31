# Changelog

Every entry here describes something that exists in this repository and can be
run, tested, or read on chain. Nothing is listed because it is planned.

## 2.2.0 — ERC-7857 Agentic ID, and a server that runs anywhere *(31 Aug 2026)*

- **`CoachAgent` v2 is a genuine ERC-7857 Agentic ID.** Implements `IERC7857`
  and `IERC7857Authorize` from 0G's reference interfaces, vendored verbatim:
  the encrypted brain as `IntelligentData`, `IntelligentDataSet` on every mint
  and evolve, open-ended executor authorization beside the expiring rentals,
  live-filtered `authorizedUsersOf`, ERC-165 answers for both interface ids.
  `iTransferFrom` verifies re-encryption proofs through an immutable oracle —
  deployed without one it refuses rather than pretending, and the oracle can
  never override the owner's consent.
- **The API is stateless.** Storage moved behind one interface with two
  backends: files for a self-hosted box, Postgres (Neon) when `DATABASE_URL`
  is set. The same server runs long-lived under Docker or as a single Vercel
  function; accounts survive every deploy.
- **Network is a switch, not a constant.** Galileo (16602) and Aristotle
  mainnet (16661) profiles on both halves; the chain id follows the RPC so a
  signature can never be for a chain nobody is on.
- **/verify** — a public page for somebody who does not believe us: live chain
  reads from the visitor's own browser, the contract on the explorer, and the
  commands to run every test suite against this repository.
- 67 contract tests (16 on the 7857 surface, 9 fuzz properties, 5 invariants),
  64 server tests, 510 frontend tests.

## 2.1.0 — The app earns its screen time *(30–31 Aug 2026)*

- **Nutrition**: Mifflin-St Jeor BMR, activity-scaled targets for four goals
  with hard safety bounds, protein per kilogram of reference weight, an
  IFCT/USDA ingredient table, day plans refined by hill-climbing on a cost
  function, food logging with "same as yesterday".
- **Workout screen rebuilt around the set**: plate math on the bar
  (`25 + 15 /side`), warm-up ramps rounded to loadable weights, mid-session
  exercise swap, per-exercise notes, honest finish summaries that name what
  they drop.
- **Offline for real**: the service worker precaches the app shell at install
  — measured by killing the server and reloading — with the media cache
  surviving deploys. `Vary: Origin` nearly made every cache lookup miss;
  `ignoreVary` is load-bearing and the commit explains why.
- **Accessibility measured, not assumed**: every text node at WCAG AA in both
  themes (computed, per-surface), every control ≥44px to a thumb, screen-reader
  labels translated in all 11 languages.
- **Two-device sync merges instead of overwriting**: per-entry union for
  workouts, weigh-ins, the food log and notes — the cases that used to lose a
  month of training silently.

## 2.0.0 — A coach you own, on 0G *(Aug 2026)*

- **`CoachAgent` on 0G Galileo** (`0xE6CAcDcf1D370E64041Ac9e42D0550A78014259A`,
  v1): an ERC-721 where each token is one person's coach — its encrypted
  configuration hash, its 0G Storage URI, a version that only climbs.
- **Owning it needs no wallet**: a key generated on the device signs EIP-712
  mint/evolve messages; the app's relayer pays the gas. The owning address can
  hold nothing and still own the coach.
- **The flywheel**: after every finished workout the coach re-derives its
  profile from real training and evolves on chain, in the background, with
  nobody waiting.
- **TEE-attested advice on 0G Compute**: the coach answers only from an
  attested enclave; if none is live it refuses rather than falling back to an
  unattested provider.
- **Coach rentals with atomic payment**: `rent()` grants access and forwards
  the whole payment to the trainer in one transaction; the contract holds no
  balance and has no withdraw function. Renewals extend, sales void every
  grant.
- **0G Storage vault**: AES-256-GCM encrypted backup of all training data,
  keyed from a wallet signature; restore by root hash from any device.

## 1.0.0 — The base tracker

The open-source openGym tracker this product builds on: guided workouts,
routine builder, 1,324-exercise dataset with media, stats, body-weight log,
passkey accounts, PWA install. Everything above 1.0.0 is this project's work.
