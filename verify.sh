#!/usr/bin/env bash
#
# Everything this project claims, split by what kind of evidence it is.
#
#   ./verify.sh unit       the suites
#   ./verify.sh mutation   the suites, checked by breaking the code
#   ./verify.sh contracts  Foundry, including the interface control
#   ./verify.sh guards     the tests that exist because something shipped broken
#   ./verify.sh release    all of the above, plus the documents
#   ./verify.sh live       the deployed contract and the deployed app
#   ./verify.sh            everything except mutation (which is slow)
#
# The split is the point. "The tests pass" and "the thing that is deployed works"
# are different claims, and a repository that runs them together can report the
# first while the second is false — which is exactly the state this project was
# in when every coach a real person created could not be opened.
#
# `live` therefore refuses to accept anything local as evidence. It reads the
# chain.

set -uo pipefail
cd "$(dirname "$0")"

FILTER="${1:-default}"
pass=0
fail=0
ran=0

check() {
  local tag="$1" desc="$2"; shift 2
  case "$FILTER" in
    default) [ "$tag" = "live" ] || [ "$tag" = "mutation" ] && return 0 ;;
    all) ;;
    "$tag") ;;
    *) return 0 ;;
  esac

  ran=$((ran + 1))
  printf '  %-9s %s ... ' "[$tag]" "$desc"

  # Output is captured rather than discarded, and printed when a check fails.
  #
  # Silencing it keeps the summary readable, which is the whole point of this
  # script — but the first time CI went red, the summary said which check failed
  # and nothing about why, and the answer was not reproducible locally. A report
  # that cannot explain its own failure sends you to re-run things by hand,
  # which is the situation this script exists to remove.
  local output
  if output=$("$@" 2>&1); then
    printf 'PASS\n'; pass=$((pass + 1))
  else
    printf 'FAIL\n'; fail=$((fail + 1))
    printf '%s\n' "$output" | tail -30 | sed 's/^/             | /'
  fi
}

# ------------------------------------------------------------------- unit

check unit "frontend suite" npm --prefix frontend test
check unit "server suite" npm --prefix server test
check unit "the counts the documents quote" node scripts/counts.mjs

# --------------------------------------------------------------- contracts

check contracts "forge test" bash -c 'cd contracts && forge test'
check contracts "the interface control is asserted in Solidity too" \
  bash -c 'grep -q "0xdeadbeef" contracts/test/*.t.sol'

# ------------------------------------------------------------------ guards
#
# Each of these exists because something shipped broken in exactly that way.
# They are listed separately so that deleting one is a visible act.

check guards "the device seal and the server reader agree" \
  bash -c 'cd server && node --test coachEnvelope.test.js'
check guards "attestation is checked per response and fails closed" \
  bash -c 'cd server && node --test coachCompute.test.js'
check guards "nothing sensitive reaches 0G Storage in the clear" \
  bash -c 'cd server && node --test redaction.test.js'
check guards "the image copies every module the server imports" \
  bash -c 'cd server && node --test dockerfile.test.js'
check guards "the frontend ABI declares every call it makes" \
  bash -c 'cd frontend && npx vitest run src/lib/coachAbi.test.js'
check guards "the relayer ABI declares every call it makes" \
  bash -c 'cd server && node --test relayer.test.js'
check guards "every refusal the failure matrix names exists" \
  bash -c 'cd server && node --test failureMatrix.test.js'
check guards "the anchored policy is still the policy" \
  bash -c 'cd server && node --test policyProvenance.test.js'
check guards "a transaction hash is not a payment" \
  bash -c 'cd server && node --test x402.test.js'
check guards "a progress card cannot claim more than the chain says" \
  bash -c 'cd server && node --test progressCard.test.js'
check guards "an out-of-scope question never reaches the model" \
  bash -c 'cd server && node --test referral.test.js'
check guards "no proof is claimed that cannot be re-checked" \
  bash -c 'cd server && node --test attestation.test.js'
check guards "vercel.json is a config Vercel will accept" \
  bash -c 'cd server && node --test vercelConfig.test.js'
check guards "importing a module writes nothing to disk" \
  bash -c 'cd server && node --test storePath.test.js'
check guards "the 0G Compute SDK actually loads" \
  bash -c 'cd server && node --test computeSdk.test.js'
check guards "every control a person can operate has a name" \
  bash -c 'cd frontend && npx vitest run src/lib/controlNames.test.js'
check guards "the counts script reads a coloured CI log, not just a plain one" \
  node --test scripts/countsParse.test.mjs

# ---------------------------------------------------------------- mutation

check mutation "174 seeded faults are caught" node scripts/mutate.mjs

# ----------------------------------------------------------------- release

check release "frontend builds" npm --prefix frontend run build
# Was a blocklist of numbers that had been wrong once, which could only catch a
# mistake somebody had already made — and did not: ARCHITECTURE.md sat at "796
# tests: 542 frontend · 151 server · 103 contract" through four refreshes of
# every other document, green the whole time, because nobody had added those
# five numbers to the list of numbers to look for. This reads the counts out of
# the prose and compares them to the suites instead.
check release "every test count in the documents matches the suites" \
  node scripts/counts.mjs --check
check release "the security documents exist and name their open risks" \
  bash -c 'grep -q "Open risks" SECURITY.md && grep -q "Non-capabilities" THREAT-MODEL.md'
check release "the contract still has no admin, pause or upgrade" \
  bash -c '! grep -rqE "Ownable|AccessControl|onlyOwner|onlyRole|Pausable|whenNotPaused|UUPS|upgradeTo|_authorizeUpgrade|selfdestruct|delegatecall" contracts/src'
# Every address this project has ever deployed, except the current one. A stale
# address in a document is the failure that once had README showing two
# different owners for token #1, and it is invisible to every other check here
# because they all read the chain rather than the prose.
check release "no stale contract address survives in the documents" \
  bash -c '! grep -rni "0x640eecC824D54d7ECF05fa423E18673E70342809\|0xE6CAcDcf1D370E64041Ac9e42D0550A78014259A\|0x70c4dE9D0edbE53733821558Bf6b14b64451e56E\|0xe0bd5144dd254422c1fE4eA8a62A23C3ca52AfB2\|0xc0d95348dA0eD829f400FA3eF04fDb7e67A5a12B" README.md VERIFICATION.md ARCHITECTURE.md SECURITY.md SUBMISSION.md frontend/public/agent-card.json scripts/evidence.mjs render.yaml server/.env.example'

# -------------------------------------------------------------------- live
#
# Nothing below reads a file in this repository. If the deployed contract stops
# answering, or answers differently, these fail — which is the entire reason
# they are not folded into the suites above.

RPC="${OG_RPC_URL:-https://evmrpc-testnet.0g.ai}"
COACH="${COACH_ADDRESS:-0x0253fb92F9e88E82Fb0632C076C88204e4400025}"

rpc_call() {
  curl -s --max-time 20 -X POST "$RPC" \
    -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{\"to\":\"$COACH\",\"data\":\"$1\"},\"latest\"]}"
}

# supportsInterface(bytes4) selector is 0x01ffc9a7.
supports() { rpc_call "0x01ffc9a7${1}00000000000000000000000000000000000000000000000000000000"; }

check live "the contract has bytecode on 0G" bash -c "
  curl -s --max-time 20 -X POST '$RPC' -H 'content-type: application/json' \
    -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getCode\",\"params\":[\"$COACH\",\"latest\"]}' \
  | grep -qE '\"result\":\"0x[0-9a-f]{100,}'"

check live "it answers true for ERC-7857" bash -c "$(declare -f rpc_call supports); RPC='$RPC' COACH='$COACH'; supports 4b396f04 | grep -q '0000001\"'"
check live "it answers true for ERC-7857 Authorize" bash -c "$(declare -f rpc_call supports); RPC='$RPC' COACH='$COACH'; supports 35d39512 | grep -q '0000001\"'"

# The control. A contract answering true to everything passes the two above and
# fails only this — which is why it is a separate line rather than a footnote.
check live "it answers FALSE for an interface nothing implements" bash -c "$(declare -f rpc_call supports); RPC='$RPC' COACH='$COACH'; supports deadbeef | grep -q '0000000\"'"

check live "every claim npm run evidence makes still holds" node scripts/evidence.mjs

# The deployed app, not the repository.
#
# `VITE_COACH_ADDRESS` is baked in at build time, and when it is missing the
# coach card renders nothing at all — correct for a fork somebody just cloned,
# and indistinguishable from a broken deploy for anybody else. This catches both
# that and the quieter one: a site still serving the contract from two deploys
# ago, which passes every other check in this file because every other check
# reads the chain rather than the bundle.
SITE="${SITE_URL:-https://liftwithog.vercel.app}"

check live "the deployed app carries the contract this repo deploys" bash -c "
  asset=\$(curl -s --max-time 25 '$SITE/' | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
  [ -n \"\$asset\" ] || exit 1
  curl -s --max-time 40 \"$SITE/\$asset\" | grep -qi '$COACH'"

# -------------------------------------------------------------------------

echo
if [ "$ran" -eq 0 ]; then
  echo "No checks matched '$FILTER'. That is a failure, not a pass —"
  echo "a typo in a filter must not look like a green run."
  exit 1
fi

echo "$pass passed, $fail failed, out of $ran."

if [ "$FILTER" = "live" ] || [ "$FILTER" = "all" ]; then
  cat <<'NOTE'

Not automated, and not claimed to be:
  - that the app is usable on a 390x844 screen
  - that the coach's advice is any good
  - that a human lifted what the device signed
NOTE
fi

[ "$fail" -eq 0 ]
