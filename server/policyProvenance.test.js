import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * The published policy must still be the policy.
 *
 * `policy-provenance.json` records a storage root and a hash for the rules the
 * coach is bound by — the literal system prompt and every nutrition bound. The
 * moment either changes in code, that record points at a document describing a
 * coach that no longer exists, and the anchor on chain makes the stale version
 * look authoritative.
 *
 * This is not hypothetical: adding four sentences to the system prompt moved
 * the hash the same afternoon the record was first written. Without this test
 * the repository would have kept citing the old one, which is the exact failure
 * the whole publication exists to prevent — a specific promise that is
 * specifically false.
 */
test('the anchored policy hash matches what the code produces today', async () => {
  const root = new URL('../', import.meta.url);
  const record = JSON.parse(await readFile(new URL('policy-provenance.json', root), 'utf8'));

  const { systemPrompt } = await import('./coach-runtime.js');
  const nutrition = await readFile(new URL('frontend/src/lib/nutrition.js', root), 'utf8');

  /*
   * Rebuilt exactly as scripts/publish-policy.mjs builds it. Duplicated
   * deliberately: a test importing the builder would pass while the builder
   * itself drifted from the record, which is the drift being checked.
   */
  const read = (pattern) => Number(nutrition.match(pattern)[1]);

  const policy = {
    schemaVersion: 1,
    product: 'LIFTWITHOG',
    what: 'The rules the coach is bound by. Published so they can be checked and argued with.',
    systemPrompt: systemPrompt(''),
    nutrition: {
      calorieFloorFemale: read(/female:\s*(\d+)/),
      calorieFloorMale: read(/[^e]male:\s*(\d+)/),
      maxDeficitFraction: read(/MAX_DEFICIT_FRACTION\s*=\s*([\d.]+)/),
      maxSurplusFraction: read(/MAX_SURPLUS_FRACTION\s*=\s*([\d.]+)/),
      maxLossKgPerWeek: read(/MAX_LOSS_KG_PER_WEEK\s*=\s*([\d.]+)/),
      maxGainKgPerWeek: read(/MAX_GAIN_KG_PER_WEEK\s*=\s*([\d.]+)/),
      minCarbG: read(/MIN_CARB_G\s*=\s*(\d+)/),
      fatFloorGPerKg: read(/FAT_G_PER_KG_FLOOR\s*=\s*([\d.]+)/),
    },
    refusals: [
      'The coach is given nutrition targets as fixed numbers and instructed never to invent, revise or extend them.',
      'It is instructed to give no medical or dietary advice beyond what those numbers already state.',
      'An answer that repeats the coach configuration verbatim is refused by the server, not by the model — see leaksConfig.',
      'Inference runs only on a TEE-attested provider; with none vouching for a response the request fails rather than falling back.',
    ],
    notClaimed: [
      'That the advice is good. Attestation proves where a model ran, not that it was right.',
      'That these bounds are medical advice. They are the limits the software will not exceed.',
    ],
  };

  const bytes = new TextEncoder().encode(JSON.stringify(policy, null, 2));
  const sha256 = '0x' + crypto.createHash('sha256').update(bytes).digest('hex');

  assert.equal(
    sha256,
    record.sha256,
    'the coach\'s rules have changed since they were published — re-run scripts/publish-policy.mjs --publish and update policy-provenance.json',
  );
});
