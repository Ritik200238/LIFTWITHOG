import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';

import { OUT_OF_SCOPE, assertInScope, outOfScope, referralFor } from './referral.js';
import { advise, challengeFor } from './coach.js';

/**
 * The questions a strength coach must not answer.
 *
 * This is the one place in the product where being wrong hurts somebody
 * physically. A model asked about a torn meniscus answers about a torn
 * meniscus — fluently, in the register of the question, with no signal that it
 * should not have. The prompt asks it to stay in scope; `leaksConfig` exists
 * because that same prompt asks it never to reveal the profile and it did
 * anyway when asked plainly.
 *
 * So these tests assert two things, and the second matters more than the first:
 * that out-of-scope questions produce a referral, and that they never reach the
 * model at all. A refusal generated *after* inference is a refusal that already
 * cost somebody the answer.
 */

const OWNER = ethers.Wallet.createRandom();
const NOW = 1_700_000_000_000;

const contractStub = { hasAccess: async () => true, coachOf: async () => [ethers.ZeroHash, 'og://root', 3n, 0n] };

const askDeps = (over = {}) => ({
  contract: contractStub,
  now: NOW,
  loadConfig: async () => 'the trainer’s method, at length, and not to be repeated',
  runModel: async ({ question }) => `advice about: ${question}`,
  ...over,
});

const ask = async (question, over = {}) =>
  advise(
    { tokenId: '1', issuedAt: NOW, signature: await OWNER.signMessage(challengeFor('1', NOW)), question },
    askDeps(over),
  );

// ------------------------------------------------------------- what is caught

test('an injury that needs examining is handed off, not trained around', async () => {
  for (const question of [
    'I think I tore my meniscus last week, what should I squat',
    'my shoulder has sharp pain when I press overhead',
    'my lower back pain has been getting worse for months, plan my week',
    'is my ACL tear ok to train on',
  ]) {
    const scope = outOfScope(question);
    assert.ok(scope, `not caught: ${question}`);
    assert.equal(scope.specialty, 'rehab');
  }
});

test('pregnancy is a clinician’s call, at every trimester', async () => {
  for (const question of [
    'I am 14 weeks pregnant, how should I change my lifting',
    'what should I eat postpartum while breastfeeding',
  ]) {
    assert.equal(outOfScope(question)?.specialty, 'prenatal', `not caught: ${question}`);
  }
});

test('eating with a condition is a dietitian’s job', async () => {
  for (const question of [
    'I am type 1 diabetic, how do I time carbs around training',
    'I have PCOS, what should my calories be',
    'I am recovering from anorexia and want to start lifting',
  ]) {
    assert.equal(outOfScope(question)?.specialty, 'clinical-nutrition', `not caught: ${question}`);
  }
});

test('doses, drugs and chest pain are never a coach’s to answer', async () => {
  for (const question of [
    'what dosage of testosterone should I run',
    'should I take clenbuterol to cut',
    'I get chest pain during squats, is that normal',
    'how many mg of ozempic for fat loss',
  ]) {
    assert.ok(outOfScope(question), `not caught: ${question}`);
  }
});

// ------------------------------------------------- what must still be answered

test('ordinary coaching questions are not swept up', async () => {
  /*
   * The other half of the trade. A safety check that refuses everything is a
   * broken product, and "sore" or "hurts a bit" is the language of ordinary
   * training rather than of an injury.
   */
  for (const question of [
    'my legs are sore after squats, should I still train tomorrow',
    'how do I get past a bench plateau at 80 kg',
    'what should I eat before a morning session',
    'how many sets of pull-ups per week',
    'should I deload this week',
    'my grip gives out before my back on deadlifts',
  ]) {
    assert.equal(outOfScope(question), null, `wrongly refused: ${question}`);
  }
});

// ------------------------------------------------------ the model is not asked

test('an out-of-scope question never reaches the model', async () => {
  /*
   * The property that matters most. A refusal produced after inference is a
   * refusal that already generated the answer — it exists, it was paid for, and
   * it is one bug away from being returned.
   */
  let reachedModel = false;
  let loadedConfig = false;

  await assert.rejects(
    () =>
      ask('I tore my ACL, what should I squat', {
        loadConfig: async () => { loadedConfig = true; return 'method'; },
        runModel: async () => { reachedModel = true; return 'you should…'; },
      }),
    (e) => e.code === 'out_of_scope' && e.status === 422,
  );

  assert.equal(reachedModel, false, 'the model was asked a question it should never see');
  assert.equal(loadedConfig, false, 'the coach method was decrypted for a question that was refused');
});

test('the refusal carries the referral, so it can be rendered as help', async () => {
  /*
   * To the person asking, this is not an error — it is the coach doing its job.
   * Flattening it to a message would make the product feel broken at exactly
   * the moment it is behaving best.
   */
  try {
    await ask('I am pregnant, should I keep deadlifting');
    assert.fail('should have referred');
  } catch (e) {
    assert.equal(e.code, 'out_of_scope');
    assert.equal(e.referral.action, 'refer');
    assert.equal(e.referral.specialty, 'prenatal');
    assert.match(e.referral.message, /outside what this coach should answer/i);
    assert.ok(e.referral.reason.length > 20, 'a referral with no reason is a dead end');
  }
});

test('a referral names specialists when the market has any', async () => {
  const referral = await referralFor('my rotator cuff is torn', {
    findSpecialists: async () => [{ tokenId: '9', pricePerDay: '1000', currency: '0G' }],
  });

  assert.equal(referral.specialists.length, 1);
  assert.equal(referral.specialists[0].tokenId, '9');
});

test('an empty marketplace still refuses — "not me" is the load-bearing half', async () => {
  /*
   * Withholding a safety refusal because there is nobody to suggest would be
   * the worst possible reading of a safety check.
   */
  const referral = await referralFor('I am type 1 diabetic, plan my carbs', {
    findSpecialists: async () => [],
  });

  assert.equal(referral.action, 'refer');
  assert.deepEqual(referral.specialists, []);
});

test('a marketplace that fails does not turn a refusal into an answer', async () => {
  const referral = await referralFor('sharp pain in my knee for weeks', {
    findSpecialists: async () => { throw new Error('rpc down'); },
  });

  assert.equal(referral.action, 'refer');
  assert.deepEqual(referral.specialists, []);
});

test('every scope carries a reason a person would accept', async () => {
  // "I can't answer that" without a why reads as a broken feature, not as care.
  for (const scope of OUT_OF_SCOPE) {
    assert.ok(scope.because.length > 40, `${scope.specialty} has no real explanation`);
    assert.ok(scope.label.length > 3);
    assert.ok(scope.patterns.length > 0);
  }
});

test('an in-scope question still gets an answer', async () => {
  // The check must not have quietly broken the product.
  const result = await ask('how do I get past a bench plateau');
  assert.match(result.answer, /bench plateau/);
});

test('assertInScope is silent for the ordinary case', async () => {
  await assert.doesNotReject(() => assertInScope('what should I squat today'));
});
