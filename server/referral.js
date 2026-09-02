/**
 * When a coach should say "not me, them".
 *
 * Real coaches refer. A strength coach who is asked about rehabilitating a torn
 * meniscus, or about eating through a pregnancy, says so and names somebody
 * else — and the ones who do not are the ones people get hurt by.
 *
 * A language model does the opposite by default. Asked anything, it answers,
 * confidently, in the register of the thing it was asked. That is fine when the
 * question is about squat volume and dangerous when it is about a joint that
 * hurts in a way joints should not.
 *
 * So scope is decided here, before the model is called, and a question outside
 * it never becomes advice. The coach names a listed specialist instead.
 *
 * ## Why detection lives here and not in the prompt
 *
 * The prompt already asks the model to stay in scope. `leaksConfig` exists
 * because that same prompt asks it never to reveal the profile and it did
 * anyway, when asked plainly. A sentence in a prompt is a request; this is the
 * check — and for a health product the check has to run *before* the model, not
 * after, because the harm is the answer existing at all.
 *
 * ## What this deliberately is not
 *
 * It does not hire the specialist. The rails for that exist — the x402 endpoint
 * takes a payment and returns an answer, and ERC-8004 makes a coach findable —
 * but with a handful of listed specialists a coach that spends somebody's money
 * on another coach by itself would be a demo rather than a product. The person
 * is shown who, and taps if they want to. Auto-hire is a roadmap line, not a
 * claim.
 */

import { CoachError } from './coach.js';

/**
 * The scopes a strength-and-nutrition coach must hand off.
 *
 * Each is a thing where the right answer is a qualified human, and where a
 * plausible-sounding wrong answer does damage that training advice does not.
 * Written as words rather than a model call because a refusal that depends on
 * an inference is a refusal that fails when inference does.
 */
export const OUT_OF_SCOPE = [
  {
    specialty: 'rehab',
    label: 'injury rehabilitation',
    because: 'A painful joint needs somebody who can examine it. Training around an injury without a diagnosis is how a small one becomes permanent.',
    patterns: [
      /\b(torn|tear|rupture[d]?|snapped)\b/i,
      /\b(acl|mcl|meniscus|rotator cuff|labrum|herniat|slipped disc|sciatica)\b/i,
      /\b(sharp|shooting|stabbing)\s+pain\b/i,
      /\bpain\b[^.?!]{0,40}\b(weeks|months|won'?t go away|getting worse)\b/i,
      /\b(physio|physiotherap|rehab)\b/i,
    ],
  },
  {
    specialty: 'prenatal',
    label: 'pregnancy and postpartum',
    because: 'Training and eating through a pregnancy is managed with a clinician, and the safe answer changes by trimester.',
    patterns: [/\bpregnan|\bexpecting\b|\bpostpartum\b|\bpost-partum\b|\btrimester\b|\bbreastfeed/i],
  },
  {
    specialty: 'clinical-nutrition',
    label: 'clinical nutrition',
    because: 'Eating with a condition that changes how the body handles food is a dietitian’s job, not a coach’s.',
    patterns: [
      /\b(diabet|type ?1|type ?2|insulin|thyroid|hypothyroid|pcos|coeliac|celiac|crohn|ibs|kidney disease|renal)\b/i,
      /\b(eating disorder|anorexi|bulimi|binge eating|purg)/i,
    ],
  },
  {
    specialty: 'medical',
    label: 'anything a doctor decides',
    because: 'Doses, drugs and diagnoses are not a coach’s to give, at any confidence.',
    patterns: [
      /\b(prescrib|dosage|dose of|mg of|steroid|anabolic|trt|testosterone replacement|sarms?|clenbuterol|ozempic|semaglutide)\b/i,
      /\b(chest pain|dizzy|fainted|passed out|blood pressure|heart (rate|condition)|palpitation)\b/i,
    ],
  },
];

/**
 * Which scope, if any, this question belongs to somebody else.
 *
 * Returns null for the ordinary case, which is nearly every question. Matching
 * is deliberately generous: the cost of handing off a question a coach could
 * have answered is one extra tap, and the cost of the other mistake is somebody
 * training on a torn ligament.
 */
export function outOfScope(question) {
  const text = String(question ?? '');
  if (!text.trim()) return null;

  for (const scope of OUT_OF_SCOPE) {
    if (scope.patterns.some((pattern) => pattern.test(text))) {
      return { specialty: scope.specialty, label: scope.label, because: scope.because };
    }
  }
  return null;
}

/**
 * A referral instead of an answer.
 *
 * Shaped as a normal result rather than an error, because to the person asking
 * this is not a failure — it is the coach doing its job. The caller renders a
 * card; nothing about the flow breaks.
 *
 * `specialists` comes from the marketplace, so a referral names a coach that is
 * actually listed and can actually be rented. When none is listed the referral
 * still happens and simply has nobody to name: "not me" is the load-bearing
 * half, and withholding it because we have no one to suggest would be the worst
 * possible reading of a safety check.
 */
export async function referralFor(question, deps = {}) {
  const scope = outOfScope(question);
  if (!scope) return null;

  let specialists = [];
  try {
    specialists = (await deps.findSpecialists?.(scope.specialty)) ?? [];
  } catch {
    // A marketplace read that fails must not turn a refusal into an answer.
  }

  return {
    action: 'refer',
    specialty: scope.specialty,
    reason: scope.because,
    message: `That is ${scope.label}, and it is outside what this coach should answer. ${scope.because}`,
    specialists: specialists.slice(0, 3),
  };
}

/**
 * The whole check, as the ask path uses it.
 *
 * Throws a typed refusal carrying the referral, so every existing caller that
 * already handles `CoachError` renders it correctly without being changed, and
 * a caller that forgets cannot accidentally fall through to an answer.
 */
export async function assertInScope(question, deps = {}) {
  const referral = await referralFor(question, deps);
  if (!referral) return;

  const error = new CoachError(422, 'out_of_scope', referral.message);
  error.referral = referral;
  throw error;
}
