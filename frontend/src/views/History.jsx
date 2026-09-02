import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { WorkoutRow, workoutDetailSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { MONTHS_LONG } from '../lib/format.js'

export default function History() {
  const nav = useNavigate()
  const S = useStore(s => s.S)

  /** Newest month first, newest session first inside it. */
  const groupByMonth = workouts => {
    const groups = new Map()
    for (const w of [...workouts].reverse()) {
      const key = String(w.d).slice(0, 7)
      if (!groups.has(key)) {
        const when = new Date(`${key}-01T12:00:00`)
        groups.set(key, {
          key,
          label: `${t(MONTHS_LONG[when.getMonth()])} ${when.getFullYear()}`,
          workouts: [],
        })
      }
      groups.get(key).workouts.push(w)
    }
    return [...groups.values()]
  }

  return <>
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 12 }}><h1>{t('History')}</h1><div className="sub">{t(S.workouts.length === 1 ? '{0} workout' : '{0} workouts', S.workouts.length)}</div></div></div>
    {/*
      * Grouped by month. This was one unbroken reversed list, so a year of
      * training was about a hundred and fifty identical rows and the only way
      * to reach an old session was to keep scrolling with nothing to aim at.
      */}
    {S.workouts.length ? <>{groupByMonth(S.workouts).map(group => (
      <div key={group.key}>
        <h4 className="sec">{group.label}</h4>
        <div className="list">{group.workouts.map(w => (
          <WorkoutRow key={w.id} w={w} onClick={() => workoutDetailSheet(w)} />
        ))}</div>
      </div>
    ))}</>
      : <>
        <div className="empty"><div className="ico"><Icon name="history" /></div>{t('No workouts yet.')}</div>
        {/* An empty screen should offer the thing that fills it. */}
        <Button variant="primary" icon="play" onClick={() => nav('/workout')}>{t('Start your first workout')}</Button>
      </>}
  </>
}
