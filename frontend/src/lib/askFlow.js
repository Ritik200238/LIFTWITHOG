import { askCoach, deviceSignerForAsk } from './coachAsk.js'
import { useCoach } from '../store/useCoach.js'
import { useUI } from '../store/useUI.js'
import { confirmSheet, coachAnswerSheet } from '../sheets.jsx'
import { nav } from './nav.js'
import { t } from './i18n.js'

/**
 * Ask the coach a question, from wherever the person happens to be.
 *
 * This lived inside the Workout screen's start state, which is where the
 * button was — and then the design put an Ask beside the coach on Home, which
 * is the right place for it: the card is the coach, so the coach is what you
 * talk to. Rather than a second copy of the referral and refusal handling,
 * both call this.
 *
 * Every branch below is a real state the coach has, and each is worded as what
 * it is rather than as a failure:
 *
 *   no coach     — nothing to ask yet, and the way to fix it is on Home.
 *   a referral   — the coach was asked about an injury, a pregnancy or a dose
 *                  and said "not me". That is the correct answer, and showing
 *                  it as an error would make the product feel broken at
 *                  exactly the moment it behaves best.
 *   anything else — reported as the failure it is. An earlier version toasted
 *                  "0G AI Coach ready!" with the error appended, so a refusal
 *                  read as a success.
 */
export async function askTheCoach(question) {
  const tokenId = useCoach.getState().tokenId

  if (!tokenId) {
    useUI.getState().toast(t('Create your coach first — it is on the home screen.'))
    return
  }

  try {
    useUI.getState().toast(t('Asking your coach…'))

    /*
     * The device key signs, not a browser wallet. Requiring `window.ethereum`
     * here contradicted the app's own claim that a coach needs no wallet, and
     * made this unusable in a home-screen app where that object does not exist.
     */
    const signer = await deviceSignerForAsk()
    const answer = await askCoach(signer, tokenId, question)

    coachAnswerSheet(answer)
  } catch (e) {
    if (e.referral) {
      const named = e.referral.specialists?.length
        ? t('Some coaches on the marketplace may be a better fit.')
        : ''

      confirmSheet({
        title: t('Not this coach'),
        message: `${e.referral.message}\n\n${named}`.trim(),
        confirmText: e.referral.specialists?.length ? t('See the marketplace') : t('Got it'),
        onConfirm: () => { if (e.referral.specialists?.length) nav('/coaches') },
      })
      return
    }

    useUI.getState().toast(e.message || t('Your coach could not answer.'))
  }
}

/**
 * What to ask when the person did not type anything — the Ask button on a card
 * rather than a text box. A rest day is not a missing session; asking about
 * one used to dereference a null routine and toast a raw JavaScript error.
 */
export function defaultQuestion(todayRoutine) {
  return todayRoutine
    ? `Today is ${todayRoutine.name}. Based on my history, what should I aim for?`
    : 'I have no session scheduled today. Based on my history, what should I do?'
}
