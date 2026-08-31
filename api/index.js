/**
 * The API, as a single Vercel function.
 *
 * Vercel maps every file under /api to its own endpoint, so this directory
 * holds exactly one: the implementation lives in ../server, and vercel.json
 * rewrites every /api/* path here. One function rather than a dozen keeps the
 * routing identical to the self-hosted server and stays well inside the Hobby
 * plan's limit.
 *
 * The frontend is served from this same domain, which is not a detail —
 * passkeys are bound to an origin, and an API on a second hostname would stop
 * sign-in working at all.
 */

import { handle } from '../server/server.js';

export default function handler(req, res) {
  return handle(req, res);
}
