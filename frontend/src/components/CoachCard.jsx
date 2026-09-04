/**
 * The coach, on the home screen.
 *
 * Placed here rather than in settings because a coach kept in a settings screen
 * is a feature nobody uses. This is meant to be the thing the app is about: it
 * watches what you lift, and what it learns is recorded somewhere that outlives
 * the browser it was learned in.
 *
 * The card only ever shows one action at a time. A person on a home screen has
 * about a second of attention for this, and a panel offering mint, evolve,
 * refresh and rent at once is a panel that gets scrolled past.
 */

import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { useCoach } from '../store/useCoach.js'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { buildCoachProfile, MIN_SESSIONS_FOR_CONFIDENCE } from '../lib/coachProfile.js'
import { sessionsUntilNextEvolve, SESSIONS_PER_EVOLVE } from '../lib/flywheel.js'
import { DEMO } from '../lib/demo.js'
import { nav } from '../lib/nav.js'
import Icon from './Icon.jsx'
import Logo from './Logo.jsx'
import { Button } from './ui.jsx'
import { askTheCoach, defaultQuestion } from '../lib/askFlow.js'
import { confirmSheet, coachKeySheet } from '../sheets.jsx'
import { effectiveRoutine } from '../lib/history.js'
import { todayISO } from '../lib/format.js'

/*
 * Named after what is on the wire, not after the functions.
 *
 * "Signing" and "Uploading" would be the code's words. These are the person's:
 * they say which of the three things this app claims — a key that is yours,
 * storage on 0G, a token on 0G Chain — is being done right now, so the wait
 * itself is the explanation.
 */
const MINT_STEPS = {
  key: 'Making a key on this device…',
  storage: 'Encrypting your coach and storing it on 0G…',
  sign: 'Signing it with your key…',
  chain: 'Waiting for 0G Chain to confirm…',
}

export default function CoachCard() {
  const S = useStore((s) => s.S)
  const coach = useCoach()
  const toast = useUI((s) => s.toast)

  const configured = Boolean(coach.available())

  useEffect(() => {
    // The chain is the authority on the version; the local copy is a cache that
    // is wrong the moment somebody uses another device.
    if (coach.tokenId) void coach.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coach.tokenId])

  /*
   * Not configured is not an error, and must not look like one. It means this
   * build has no contract address, which is the normal state of a fork somebody
   * just cloned. Saying nothing at all is better than a broken-looking card.
   */
  if (!configured) return null

  const profile = buildCoachProfile(S, { now: 0 })
  const sessionsKnown = profile.sessions
  const hasNew = coach.hasSomethingToLearn(S)

  /*
   * How far through the current block of training the coach is, as a fraction
   * rather than a sentence. Derived from the same call the caption uses, so the
   * bar and the words can never disagree — a bar that says one thing while the
   * text says another is worse than no bar.
   */
  const untilEvolve = sessionsUntilNextEvolve(coach, sessionsKnown)
  const evolvePct = untilEvolve == null
    ? 0
    : Math.round(((SESSIONS_PER_EVOLVE - untilEvolve) / SESSIONS_PER_EVOLVE) * 100)

  // What the Ask button asks about when nobody has typed a question.
  const todayRoutine = effectiveRoutine(S, todayISO())

  // The newest sentence the coach wrote about this person, if it has written any.
  const latestNote = coach.memory?.[0]?.notes?.[0]?.text ?? null

  const mint = async () => {
    try {
      await coach.mint(S)
      /*
       * A sheet, not a toast.
       *
       * "It is yours" was true and was the whole message, which left out the
       * part that costs somebody their coach: it is held by a key in this
       * browser, the contract has no admin, and clearing site data ends it.
       * A toast that says so scrolls away in three seconds; this is the one
       * moment the sentence is worth interrupting for, because it is the
       * moment it becomes true.
       */
      confirmSheet({
        title: t('Coach #{0} is yours', useCoach.getState().tokenId),
        message: t('It is owned by a key this app made on this device — no company account, and no admin who can give it back. Save the twelve words now and you can reach it from any device.'),
        confirmText: t('Show my twelve words'),
        cancelText: t('Later'),
        onConfirm: coachKeySheet,
      })
    } catch (error) {
      toast(error.message || t('Could not create the coach.'))
    }
  }

  const teach = async () => {
    try {
      const { evolved } = await coach.evolve(S)
      toast(evolved ? 'Recorded. Your coach knows more than it did.' : 'Nothing new to record yet.')
    } catch (error) {
      toast(error.message || 'Could not record what it learned.')
    }
  }

  return (
    <div className="card coachcard" style={{ marginTop: 12 }}>
      {/*
        * The coach, as the design draws it: a mark, a name, what it knows, and
        * one thing to do with it.
        *
        * The old header said "Your coach" above a version string, which spends
        * the most valuable line on the screen restating the section it is in.
        * The name carries the id instead, and the sentence underneath is what
        * it has actually learned — which is the thing that makes a version
        * number mean anything.
        */}
      <div className="coachcard-top">
        <span className="coachcard-mark" aria-hidden="true"><Logo size={20} /></span>

        <div className="coachcard-id">
          <div className="coachcard-name">
            {coach.tokenId ? `${t('Your coach')} #${coach.tokenId}` : t('Your coach')}
          </div>
          <div className="coachcard-sub">
            {coach.tokenId
              ? t('{0} learned · yours', sessionsKnown === 1
                  ? t('{0} session', sessionsKnown)
                  : t('{0} sessions', sessionsKnown))
              : t('Owned by you, on 0G. It outlives this app.')}
          </div>
        </div>

        {/*
          * Ask lives on the card because the card is the coach. It was only on
          * the workout start screen, which is a place you go to train rather
          * than to ask something.
          */}
        {coach.tokenId && (
          <Button className="coachcard-ask" size="sm" onClick={() => askTheCoach(defaultQuestion(todayRoutine))}>
            {t('Ask')}
          </Button>
        )}
      </div>

      {/*
        * The hosted preview has no server, and minting needs one: a device key
        * signs, and the app's relayer pays the fee so nobody needs a wallet.
        *
        * Offering the button anyway ended in "Start the API (npm start in
        * api/)" — true, and useless to somebody who just opened a link. So the
        * preview says what it cannot do and sends them to the coaches that
        * really are on 0G, read live from the chain in this same browser.
        */}
      {!coach.tokenId && DEMO && (
        <>
          <div className="muted small" style={{ marginBottom: 8 }}>
            Creating one needs this app's own server, which this preview does not run.
            The coaches already on 0G are real — open them and check any of it on the explorer.
          </div>
          <Button icon="sparkles" onClick={() => nav('/coaches')}>See the coaches on 0G</Button>
        </>
      )}

      {!coach.tokenId && !DEMO && (
        <>
          {/*
            * Said before minting rather than after. A coach built on three
            * sessions is a guess, and somebody should know that before they pay
            * a fee to make it permanent.
            */}
          {sessionsKnown < MIN_SESSIONS_FOR_CONFIDENCE && (
            <div className="muted small" style={{ marginBottom: 8 }}>
              It only has {sessionsKnown} {sessionsKnown === 1 ? 'session' : 'sessions'} to go on.
              It will learn as you train.
            </div>
          )}
          <Button variant="primary" icon="sparkles" disabled={coach.busy} onClick={mint}>
            {coach.busy ? t('Creating…') : t('Create my coach')}
          </Button>
          {/*
            * What is actually happening, while it happens.
            *
            * A mint is four round trips and took 26 seconds on the deployment
            * this was measured against — a button reading "Creating…" for that
            * long is indistinguishable from a hang, and the reflex when a
            * button looks hung is to press it again. (The store refuses the
            * second press; that is not the same as the person knowing why.)
            *
            * aria-live so it is spoken as it changes rather than sitting there
            * as text nobody is told about.
            */}
          {coach.busy && (
            <div className="muted small" role="status" aria-live="polite" style={{ marginTop: 8 }}>
              {MINT_STEPS[coach.step] ? t(MINT_STEPS[coach.step]) : t('Working…')}
            </div>
          )}
        </>
      )}

      {coach.tokenId && (
        <>
          {/*
            * The countdown, drawn as well as said. It records by itself every
            * block of training, so this is progress rather than a button — and
            * a bar moving is what makes the flywheel something somebody
            * notices instead of a background task nobody knows about.
            */}
          <div className="coachcard-bar" aria-hidden="true">
            <i style={{ width: `${evolvePct}%` }} />
          </div>
          <div className="coachcard-foot">
            <span>{t('Version {0}', coach.version)}</span>
            <span>{(() => {
            /*
             * The loop, said out loud. It records by itself every block of
             * training — so this is a countdown, not a button, and the number
             * moving is what makes the flywheel something somebody notices
             * rather than a background task nobody knows exists.
             */
            const until = sessionsUntilNextEvolve(coach, sessionsKnown)

            if (coach.busy) return 'Recording what it learned…'
            if (!hasNew) return 'Up to date. It learns again the next time you train.'
            if (until === 0) return 'It records what it learned after your next session.'

            return `It records what it learned in ${until} more ${
              until === 1 ? 'session' : 'sessions'
            }.`
          })()}</span>
          </div>
        </>
      )}

      {/*
        * The last thing it learned, on the card.
        *
        * "Version 7" is a number; this is the sentence behind it. Showing the
        * newest memory here is what turns the version counter from a claim
        * into something the owner can check against their own training —
        * and it is the reason to open the full record.
        */}
      {coach.tokenId && latestNote && (
        <div
          className="small"
          style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--sep)' }}
        >
          <div className="dim" style={{ marginBottom: 2 }}>
            {t('Last thing it learned')}
          </div>
          <div>{latestNote}</div>
          <button type="button" className="quiet" style={{ marginTop: 6 }} onClick={() => nav('/memory')}>
            {t('Everything it knows about you')}
          </button>
        </div>
      )}

      {/*
        * Still here, and deliberately quiet: the flywheel handles this on its
        * own, and this is for somebody who wants it now rather than in four
        * sessions' time.
        */}
      {coach.tokenId && hasNew && !coach.busy && (
        <button type="button" className="quiet" style={{ marginTop: 8 }} onClick={teach}>
          Record it now
        </button>
      )}

      {coach.error && (
        <div className="small" role="alert" style={{ marginTop: 8, color: 'var(--bad, #f87171)' }}>
          {coach.error}
        </div>
      )}
    </div>
  )
}
