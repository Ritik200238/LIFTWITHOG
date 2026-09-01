/**
 * What your coach knows about you.
 *
 * The screen this whole product was missing. "Your coach learns from your
 * training" was true and unverifiable: the chain showed a version counter
 * climbing and nothing said what any of those versions contained. Somebody
 * could own a coach at version twelve and have no way to answer the obvious
 * question — what does it know that a fresh one wouldn't?
 *
 * Every entry here was written at the moment the coach evolved, from the
 * difference between what it knew before and after, and travelled inside the
 * encrypted payload whose hash the chain records. So this is not a log the app
 * keeps beside the blockchain; it is the content the blockchain committed to.
 */

import { useNavigate } from 'react-router-dom'
import { useCoach } from '../store/useCoach.js'
import { dateLocale, t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

const KIND_ICON = {
  progress: 'arrowUp',
  reps: 'arrowUp',
  stall: 'minus',
  regression: 'arrowDown',
  'new-lift': 'plus',
  bodyweight: 'scale',
  goal: 'target',
  origin: 'sparkles',
}

const KIND_TINT = {
  progress: 'var(--acc)',
  reps: 'var(--acc)',
  stall: 'var(--yellow)',
  regression: 'var(--orange)',
}

function when(at) {
  if (!at) return null
  try {
    return new Date(at).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return null
  }
}

export default function Memory() {
  const nav = useNavigate()
  const tokenId = useCoach((s) => s.tokenId)
  const version = useCoach((s) => s.version)
  const memory = useCoach((s) => s.memory)

  const entries = Array.isArray(memory) ? memory : []

  return (
    <div className="narrow">
      <div className="hdr">
        <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}>
          <Icon name="chevronLeft" />
        </button>
        <div style={{ flex: 1, marginLeft: 12 }}>
          <h1>{t('What it knows')}</h1>
          <div className="sub">
            {tokenId
              ? t('Coach #{0}, version {1} — written as it learned.', tokenId, version ?? 1)
              : t('Your coach’s memory')}
          </div>
        </div>
      </div>

      {/* No coach: this screen has nothing to be about yet. */}
      {!tokenId && (
        <div className="card">
          <h3 style={{ margin: '0 0 4px' }}>{t('No coach yet')}</h3>
          <div className="muted small">
            {t('Create your coach and it starts keeping a record — what moved, what stalled, and when.')}
          </div>
          <div style={{ height: 12 }} />
          <Button variant="primary" icon="chevronLeft" onClick={() => nav('/home')}>
            {t('Back to home')}
          </Button>
        </div>
      )}

      {/*
        * A coach exists but has recorded nothing yet — every coach minted
        * before this feature existed is in exactly this state, and telling
        * them why is better than an empty page that reads like a bug.
        */}
      {tokenId && entries.length === 0 && (
        <div className="card">
          <h3 style={{ margin: '0 0 4px' }}>{t('Nothing written down yet')}</h3>
          <div className="muted small">
            {t('Your coach records what it learned each time it evolves. Finish a session or two and its first memory appears here.')}
          </div>
        </div>
      )}

      {entries.map((entry) => (
        <div className="card" key={entry.version} style={{ marginBottom: 12 }}>
          <div className="row between" style={{ marginBottom: 8, alignItems: 'baseline' }}>
            <h3 style={{ margin: 0 }}>
              {t('Version {0}', entry.version)}
            </h3>
            <span className="dim small">
              {[when(entry.at), entry.sessions ? t('{0} sessions', entry.sessions) : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>

          {(entry.notes ?? []).length === 0 ? (
            <div className="muted small">{t('Recorded, with nothing new to say.')}</div>
          ) : (
            (entry.notes ?? []).map((note, i) => (
              <div
                className="row"
                key={i}
                style={{ gap: 8, alignItems: 'flex-start', padding: '4px 0' }}
              >
                <Icon
                  name={KIND_ICON[note.kind] ?? 'dot'}
                  style={{ color: KIND_TINT[note.kind] ?? 'var(--label-3)', marginTop: 3, flexShrink: 0, fontSize: 15 }}
                />
                <div className="small">{note.text}</div>
              </div>
            ))
          )}
        </div>
      ))}

      {entries.length > 0 && (
        <div className="card">
          <div className="muted small" style={{ lineHeight: 1.5 }}>
            {t('Each version’s memory was encrypted and stored on 0G Storage, and the hash of that record is what the chain holds against this version. It is also what your coach reads before answering a question — which is why its advice changes as this list grows.')}
          </div>
          <div style={{ height: 12 }} />
          <Button icon="shield" onClick={() => nav('/proof')}>
            {t('See it on the chain')}
          </Button>
        </div>
      )}

      <div style={{ height: 24 }} />
    </div>
  )
}
