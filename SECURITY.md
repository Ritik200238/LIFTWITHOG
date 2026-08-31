# Security Policy

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting** on this repository
(Security → Report a vulnerability), so the report and the fix can travel
together before anything is public. If that is unavailable, open an issue that
says only "security — requesting a private channel" and a maintainer will
provide one; put no details in the public issue.

You can expect an acknowledgement within 72 hours. Please give us a reasonable
window to ship a fix before disclosing.

## What is in scope

- The smart contract (`contracts/src/CoachAgent.sol`) — anything that moves a
  coach, money, or access to somebody the owner did not choose.
- The server (`server/`) — account takeover, another user's data, forged
  sessions, relayer abuse.
- The frontend's key handling (`frontend/src/lib/deviceKey.js`,
  `frontend/src/lib/ogVault.js`) — anything that exfiltrates a device key,
  recovery phrase, or vault plaintext.

Self-hosted instances are configured by their operators; misconfiguration of
somebody's own deployment is theirs, but a default that *invites*
misconfiguration is ours — report those.

## How keys and secrets are handled

Stated here so reports can point at the gap between this policy and the code:

- **The device key never leaves the device.** It is generated in the browser,
  stored locally per profile, and signs EIP-712 messages; the server and
  relayer see signatures, never the key.
- **Vault backups are encrypted before they travel.** AES-256-GCM under a key
  derived on the device; 0G Storage holds ciphertext only.
- **Session cookies are HMAC-signed** with a per-instance secret. A session
  key that was once committed to this repository is recognised **by hash** at
  boot and replaced automatically, signing everyone out rather than carrying
  on with a published key.
- **The relayer key exists only in server configuration** (environment or
  `server/.env`), never in the repository. `render.yaml` marks it `sync:false`
  so platform blueprints prompt for it instead of storing it.
- **The contract has no owner, no admin, and no pause.** Nobody can freeze,
  reassign, or upgrade a coach out from under its owner. The ERC-7857 transfer
  verifier is immutable at deployment for the same reason.

## What a report should include

The shortest path to reproducing what you found: the request, transaction, or
state that demonstrates it, and what you expected instead. A working proof of
concept is welcome; mass-testing against instances you do not operate is not.
