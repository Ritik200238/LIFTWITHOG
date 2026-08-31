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
import { sessionsUntilNextEvolve } from '../lib/flywheel.js'
import { DEMO } from '../lib/demo.js'
import { nav } from '../lib/nav.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

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

  const mint = async () => {
    try {
      await coach.mint(S)
      toast('Your coach exists now, and it is yours.')
    } catch (error) {
      toast(error.message || 'Could not create the coach.')
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
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <div>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="sparkles" /> Your coach
          </h3>
          <div className="muted small">
            {coach.tokenId
              ? `Version ${coach.version} · knows ${sessionsKnown} ${
                  sessionsKnown === 1 ? 'session' : 'sessions'
                }`
              : 'Owned by you, on 0G. It outlives this app.'}
          </div>
        </div>

        {coach.tokenId && (
          <span className="tag acc" title={t('Its id on 0G Chain')}>
            #{coach.tokenId}
          </span>
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
            {coach.busy ? 'Creating…' : 'Create my coach'}
          </Button>
        </>
      )}

      {coach.tokenId && (
        <div className="muted small">
          {(() => {
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
          })()}
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
