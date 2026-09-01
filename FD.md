# FD.md — Frontend Designer / Engineer Briefing

You are designing and building the entire frontend for **LIFTWITHOG**. This file
tells you everything about the product: what it is, who uses it, every screen's
job, every flow, every state, and the hard constraints the design must respect.

It deliberately says **nothing about how anything should look**. Visual
direction, layout, typography, motion, component style — all yours. What follows
is the product truth you design from.

One requirement stated up front because it shapes everything: **this product is
used on a phone, mid-workout, one-handed, often with sweaty hands. The design
must be mobile-first and fully mobile-friendly. Desktop is the secondary
adaptation, never the starting point.**

---

## 1. What the product is

LIFTWITHOG is a workout + nutrition tracker whose AI coach is the user's
**property**. The coach is an on-chain agent (an NFT on the 0G blockchain) that
the user's own phone controls. It learns from every workout the user finishes,
its "brain" is stored encrypted on decentralized storage, and its advice runs
inside a verified secure enclave. If this company disappears, the user's coach —
its identity, its learning history, the money it earns from rentals — still
exists and still belongs to them.

Underneath that: a complete, serious gym tracker. 1,324 exercises with images
and animations, plate-loading math, warm-up ramps, progression tracking, an
India-first nutrition engine, offline-first operation, 11 languages.

Live today at **liftwithog.vercel.app**. The audience is India-first,
mass-market — people who lift, not crypto people. **Nothing in the product may
require a crypto wallet, tokens, or blockchain knowledge from an athlete.**

## 2. The three kinds of people using it

1. **The athlete** (primary, ~99% of traffic). Wants to log sets fast, see
   progress, hit calorie targets, and get coaching. Does not know or care what
   a blockchain is. Uses a phone in a gym.
2. **The trainer** (secondary). A coach whose training method has value. Mints
   a coach agent, prices it, and rents access to athletes. Earns directly —
   payment settles to them atomically on-chain.
3. **The verifier** (rare but decisive: a judge, a journalist, a skeptic).
   Arrives with no account and no goodwill, wants to check whether our claims
   are real. Two screens exist purely for this person (Proof, Verify).

## 3. Plain-language glossary (the domain in one page)

| Term | Meaning |
|---|---|
| **Coach** | The user's AI trainer. Technically an ERC-7857 NFT on 0G Chain, token id like `#5`. In product language it is always "your coach", never "your NFT". |
| **Mint** | Creating the coach. Happens from the phone with no wallet: a key generated on the device signs; our server (the "relayer") pays the blockchain fee. Takes 10–25 seconds. |
| **Evolve / Version** | After a finished workout, the coach re-derives what it knows from real training and records a new version on-chain, in the background. `Version 7` means it has learned 7 times. This number is the public proof the coach genuinely trains with its owner. |
| **Brain / config** | The coach's knowledge, encrypted, stored on 0G Storage. The chain stores only its fingerprint (hash) and address. |
| **Ask** | Sending the coach a question. The answer is produced inside a TEE (a hardware-verified private enclave) on 0G Compute. Takes 5–30 seconds. If no verified enclave is available, the product **refuses to answer** rather than using an unverified one — surface that refusal honestly. |
| **Rent** | An athlete pays to use a trainer's coach for N days (1–365). Payment and access happen in one transaction; the whole payment goes to the trainer. Renewing extends the current window. Renting is the one flow that uses a browser crypto wallet (the renter pays). |
| **Device key** | A cryptographic key generated on the user's device, never sent anywhere. It is what owns the coach. Backed by a 12-word recovery phrase the user can view. |
| **Vault** | An encrypted backup of all training data to 0G Storage. Encrypted on the device; restoring needs the backup's "root hash" code. |
| **Passkey** | Fingerprint/face/PIN sign-in (WebAuthn). No passwords anywhere in the product. |
| **Guest mode** | Full app with all local features, data only in that browser. No account needed. |
| **RIR / RPE** | Effort scales lifters use (Reps In Reserve / Rate of Perceived Exertion). Optional per-set field, off by default. |
| **1RM** | Estimated one-rep max, computed from weight × reps. |
| **Testnet** | The current chain is 0G's test network: rentals move test tokens, not real money. This honesty note must appear wherever payment appears. Mainnet is imminent; the copy already accounts for both. |

## 4. Complete screen inventory — the job of every screen

Routes are hash-based (`/#/home` etc.). Every screen below exists today and
must exist in your build. What each shows is its **data contract**; how it
shows it is yours.

### Login (unauthenticated landing)
Three paths: sign in with passkey · create a new profile (asks display name,
then passkey ceremony) · continue without account (guest). Communicates that
passkeys use fingerprint/face/PIN and that each profile keeps separate data.
This is also the first screen a judge sees — it carries the product one-liner.

### Home
The daily anchor. Contains: today's date · a 7-day week strip showing which
days have planned routines and which are rest (tappable to jump weeks) ·
today's card (planned routine with a start action, "rest day", or "resume" if
a workout is in progress) · **the coach card** (see §5 — the emotional core of
the product) · body weight block (latest weight, trend arrow, goal, chart,
quick log) · streak / totals. First-run: a welcome card offering a ready-made
Push/Pull/Legs starter plan or building one's own.

### Plan
Weekly schedule: 7 weekday slots, each assignable to a routine or rest.
Routines list: create, open to edit, shows exercise count. "Plan files":
export a shareable plan file, import one a friend sent, print/PDF. Empty
state offers the starter plan.

### Routine editor (`/plan/r/:id`)
Name the routine; add/remove/reorder exercises; per-exercise config: sets,
reps (or time/distance for cardio-type), starting weight, progression policy,
rest seconds; group two exercises into a superset. Uses the exercise picker
(search + filter over all 1,324).

### Workout — start state
If nothing is planned today: start today's routine · freestyle (pick
exercises as you go) · on rest days, an "ask your coach" prompt.

### Workout — active session (the most important screen in the product)
Used mid-set. One exercise focused at a time with prev/next movement between
"units" (an exercise, or a superset pair). Per exercise: name, media,
body-part tag; "last time" line (what they lifted in the previous session);
best-ever weight; a per-exercise note. Per set: weight stepper, reps stepper,
optional RIR/RPE, a done toggle. Completing a set starts the **rest timer**
(persistent countdown with beep + vibration, visible wherever the user
navigates). Barbell exercises additionally show **plate math** ("25 + 15 /
side") and a one-tap **warm-up ramp** generator. Actions: add set, remove
set, add exercise, swap exercise (keeps the set structure), discard workout
(confirm), finish workout. Elapsed time and sets-done count always available.

Completion choreography (behavior, keep it): checking the last set of a
weighted exercise asks the user to confirm their top working weight (becomes
next session's default); when every exercise is done a "whole workout done"
prompt offers finish or add-another-exercise; finishing early warns how many
sets are unchecked; the finish summary shows duration, volume, sets, any
personal records (weight PRs and estimated-1RM PRs separately), a body-map of
muscles trained — and **names any exercise it dropped** because no sets were
checked. After finish, the coach evolves in the background; never make the
user wait on it.

### Library
All 1,324 exercises. Filter chips: body part (10) and equipment (~12); text
search. Each exercise opens a detail sheet: animated demo, step-by-step
instructions (translated), muscles worked. Reachable standalone and as the
picker inside routine/workout flows.

### Stats
Tiles: total workouts, this month, week streak, 30-day weight change.
12-month activity heatmap (by time trained). Body-weight chart with goal line
and range switching (1M/3M/1Y/All) plus goal-setting and weigh-in logging.
Per-exercise progress: top-set weight over time and estimated 1RM, exercise
selectable. Muscle-load body map. Empty state points to starting a first
workout. Entry point to History.

### History
Every past workout, newest first, **grouped by month**. Each row: name, date,
duration, sets, volume. Opens a detail sheet: full sets/reps/weights, PRs
earned, notes. Delete with confirm.

### Nutrition
Two phases. **Setup**: age, height, sex, activity level, goal (lose / maintain
/ gain / recomp), diet (veg / egg / non-veg / vegan), optional pace. Weight
comes from the user's weigh-ins automatically. **Daily**: BMI with an honest
note about its limits for Indian bodies; maintenance calories; targets
(calories, protein, fat, carbs) for the chosen goal with all four goals
comparable; a generated day meal plan matched to the targets and diet, with
portion grams and a shopping list; a food log — search Indian-first foods
(IFCT data) and meals, log portions, see running totals vs targets, "same as
yesterday" one-tap copy; remove entries. Numbers are computed with hard
safety floors — the UI never shows a target below them.

### Memory — "What it knows" (`/#/memory`)
The coach's record of what it has learned, newest version first. Each entry:
version number, date, session count, and up to five plain sentences describing
what changed since the previous version (a lift that moved with both weights,
extra reps at the same weight, a lift that has stalled and for how many
sessions, a lift going backwards, bodyweight moves, a changed goal). Reached
from the coach card on Home ("Everything it knows about you") and links out to
Proof. Two empty states: no coach yet (offer to create one), and a coach that
has not recorded anything yet (explain that memories appear as it evolves —
this is the state of every coach minted before the feature existed).

### Coaches (the market)
Two halves. **The trainer's half** (only when the user owns a coach): name a
price per day in 0G and list it, update the price, or take it off the market
(confirm — rentals already paid for still run to their end). No wallet needed;
the device signs and the app pays the fee. **The market**: every coach on-chain
that is priced for rent — id, age, version ("has learned N times"), price per
day. Rent flow: pick duration, pay via browser wallet, access granted in the
same transaction. Rented coaches appear with remaining days and an "ask" action. Honesty copy: payment goes straight
to the trainer, access ends by itself, testnet tokens are not real money.
Loading state matters here — chain reads take 1–3 seconds.

### Proof (personal verification, reached from Settings)
"Is *my* coach real?" — read live from the chain: token id, version, owner
address (and that the owner address holds zero gas — that's the point),
brain location on 0G Storage, last-learned time, chain id, block, contract
address. Device key address and recovery-phrase status. Ends with "what is
NOT proven" — honest limits. Everything links to the public explorer.

### Verify (public verification, `/#/verify` — outside the sign-in wall)
For the visitor with no account. Live chain tiles (chain id, block, total
coaches minted — read by *their* browser). The contract address with explorer
link. Four claims, each with its mechanism. Copy-paste commands to run our
test suites. "What we do not claim." This page must remain reachable without
any authentication.

### Settings
Account (create passkey profile / sign in / sign out; guest notice) ·
Language (11) · weight unit kg/lb · RIR/RPE mode · theme (dark/light — both
must be fully supported) · body-diagram sex · accent color choice · sound ·
keep-screen-awake · daily workout reminder (time + timezone-aware) · the 0G
section: Proof, Verify, back up to 0G Storage, restore from a backup · data:
starter plan, import from other apps (FitNotes/Strong/Hevy CSV, Apple Health
body weight), JSON import/export, reset everything (confirm) · install-to-
home-screen tip (platform-aware) · self-hosting pointer.

### Admin (`/#/admin`, operator only)
Users table (workouts, last sync, push status, live presence), per-user
drill-down, enable/disable accounts, invite codes when invite-only mode is
on. English-only by design. Low priority for design attention but must work.

### Overlay system (not a route, used everywhere)
The app runs on bottom sheets and centered dialogs: exercise picker, exercise
config, exercise detail, notes, weigh-in, goal, day-assign, workout detail,
confirms, plan files, vault backup/restore, coach ask, top-weight, workout
complete, finish summary. Behavioral contract: the device/browser **back
gesture closes the top sheet and stays on the page** (does not navigate);
tapping outside closes unless the sheet is locked (finish summary is locked);
sheets are drag-dismissable; a sheet that closes and navigates must not
bounce back.

## 5. The coach card (Home) — states that must all exist

1. No coach yet, enough data → explain + "create my coach" (mention it takes
   a few seconds and needs no wallet).
2. No coach, thin data → same, plus honesty: "it only has N sessions to go on."
3. Minting → in-progress state, 10–25s, must not block using the rest of the app.
4. Coach exists → token id, version, sessions known, next-evolve hint.
5. Evolving (background) → subtle, non-blocking.
6. Ask flow → question in, streaming/slow answer out (5–30s), TEE-refusal error
   possible and must read as principled, not broken.
7. Server unreachable → the card degrades honestly (local coaching data still
   shows; chain actions disabled with a reason).
8. Hosted-preview/demo variant → if the build has no server, the card says so
   and routes to the market instead of offering a dead button.

## 6. Global product behaviors the design must carry

- **Offline is normal, not an error.** The whole tracker works with zero
  network (guest data is local; the app shell is pre-cached). Chain/AI/sync
  features degrade with clear reasons. Never show a blank screen because a
  fetch failed.
- **Never block on the blockchain.** Everything on-chain happens in the
  background or with visible progress; the user can always keep training.
- **Units everywhere**: kg/lb global toggle affects every weight, plate math,
  and chart. Weights step in 0.5 (kg) / typical plate increments.
- **Two themes** (dark default, light) — full support, not an afterthought.
- **11 languages** via a translation function; design for text that grows
  30–50% (German/Russian) and different scripts (Hindi, Korean, Chinese).
  Never hard-code user-facing strings.
- **Accessibility floor already achieved and must not regress**: every
  interactive target ≥44px to the touch; WCAG AA contrast in both themes;
  every icon-only control carries a translated label for screen readers.
- **Destructive actions confirm** (delete workout, weigh-in, reset, restore
  overwriting data). Nothing irreversible on a single tap.
- **Empty states teach.** Every screen with no data yet says what will appear
  and offers the action that creates it.
- **Honesty is a product feature.** Testnet-money notes near payments; "what
  is not proven" on trust pages; the coach's refusal to answer unattested;
  named dropped exercises at finish. Do not design these away — they are why
  people trust the product.
- **Latency truths to design for**: chain reads 1–3s (skeletons), mint 10–25s,
  ask 5–30s, storage backup seconds-to-a-minute, sync near-instant.
- **Wake lock** keeps the screen on during an active workout only.
- **Rest timer** is app-global: started on set completion, survives
  navigation, beeps/vibrates at zero.

## 7. Data & backend contract (what the frontend talks to)

Auth is cookie-session based; the API lives on the **same origin** at `/api`
(this is a hard requirement — passkeys are bound to the origin).

Key endpoints (all JSON):

| Endpoint | Purpose |
|---|---|
| `GET /api/health` · `GET /api/config` | liveness; `invite_only` flag |
| `POST /api/register/options` → `POST /api/register/verify` | create passkey account |
| `POST /api/login/options` → `POST /api/login/verify` | passkey sign-in |
| `GET /api/me` · `POST /api/logout` | session |
| `GET /api/state` · `POST /api/state` | pull/push the whole user state; server rejects stale writes (409) — client merges and retries |
| `POST /api/coach/store` | upload the encrypted coach brain (server → 0G Storage) |
| `POST /api/coach/mint` · `POST /api/coach/evolve` | relayed on-chain writes (device-signed) |
| `POST /api/coach/advice` | ask the coach (server → 0G Compute TEE) |
| `POST /api/push/*` | web-push subscription, test, rest-timer backup alarm |
| `GET/POST /api/admin/*` | operator dashboard |

Client state is one JSON document per user (workouts, routines, week plan,
body weight, exercise weights/notes, food log, nutrition profile, settings),
kept in localStorage, synced whole, merged per-entry on conflict. The chain
is read **directly from the browser** (market, proof, verify) via the public
0G RPC — those screens work with no API at all.

Exercise media: `/img/{id}.jpg` (stills) and `/gif/{id}.gif` (animations),
1,324 of each. Media is heavy — lazy-load it.

## 8. Constraints that are non-negotiable

1. **Mobile-first, mobile-friendly, one-handed.** Primary design target is a
   ~400×850 viewport; the core loop must be comfortable standing in a gym.
   Scale up to desktop, don't scale down to phone.
2. **Installable PWA** — the app is installed to home screens and opens
   full-screen offline. Design must tolerate standalone mode (no browser
   chrome, safe-area insets on iOS).
3. **First paint carries no blockchain code** — web3 libraries load lazily on
   the screens that need them. Keep it that way; a tracker that takes seconds
   to open loses the athlete.
4. **No wallet language for athletes.** "Coach", "yours", "learns", "rent" —
   never "NFT", "gas", "transaction" outside the Proof/Verify pages, where the
   technical vocabulary is deliberately used because that reader came for it.
5. **/verify stays public** (no auth wall) and its data stays live-read.
6. **Guest mode is first-class**, not a degraded trial.

## 9. Where to dig deeper

All in the repo root: `README.md` (product + proof), `ARCHITECTURE.md`
(system, flows, trust model), `VERIFICATION.md` (every claim + how to check
it), `CHANGELOG.md` (what exists and when it shipped), `docs/SELF_HOSTING.md`.
The live app is the ultimate reference for current behavior:
**liftwithog.vercel.app** — create a guest profile and use everything.

Questions about intended behavior beat assumptions — ask the team. Everything
in this file is implemented and true today; nothing here is aspirational.
