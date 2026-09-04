/**
 * What to eat, and why that number.
 *
 * The app already knows what somebody lifted. This is the other half of the
 * same question, and the half most lifters get from a calculator that asks for
 * four numbers, returns one, and never explains it.
 *
 * Two decisions shape this screen:
 *
 * **Every goal is shown before one is chosen.** Most apps ask "what do you
 * want?" and then reveal the consequence. Somebody deciding between cutting and
 * building deserves to see both numbers side by side first, because the
 * decision is the number.
 *
 * **The plan is food, not a target.** "Eat 2200 calories with 160 g of protein"
 * is the answer to a question nobody asked. The meals below are portioned from
 * those exact figures, and where they cannot reach them the screen says so
 * instead of quietly handing over a plan that misses.
 */

import { useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { bwSheet } from '../sheets.jsx'
import {
  ACTIVITY_LABELS,
  GOAL_LABELS,
  allGoals,
  bmiCategory,
  computeTargets,
} from '../lib/nutrition.js'
import { DIETS, MEALS } from '../lib/foods.js'
import { SLOT_LABELS, planDay, planWeek, shoppingList } from '../lib/mealPlan.js'
import {
  addEntry,
  copyOfDay,
  dayKey,
  entriesFor,
  foodEntry,
  isLogged,
  mealEntry,
  previousDay,
  progress,
  removeEntry,
  searchFoods,
  totalsFor,
} from '../lib/foodLog.js'
import {
  cmToHeight,
  heightToCm,
  latestWeightKg,
  nutritionState,
  validate,
  weightInUnit,
} from '../lib/nutritionProfile.js'
import Icon from '../components/Icon.jsx'
import { Button, Section, Row, Segmented } from '../components/ui.jsx'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The dish behind a planned row, so ticking logs its real macros. */
const MEAL_BY_ID = Object.fromEntries(MEALS.map((meal) => [meal.id, meal]))

/** A macro, said the way it is read: a number and what it is. */
function Macro({ label, value, unit, tint }) {
  return (
    <div className="tile">
      <div className="l">{label}</div>
      <div className="v" style={{ fontSize: 22, color: tint }}>
        {value}
        <span className="muted" style={{ fontSize: '0.8rem', marginLeft: 2 }}>
          {unit}
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ setup */

/**
 * A number somebody is still in the middle of typing.
 *
 * The reason this exists instead of a plain `NumberField`. Every keystroke used
 * to go straight to the stored profile, and a height is typed one digit at a
 * time — so clearing 180 to correct it destroyed the whole screen, and typing
 * it back went "1" (plan gone, red error), "18" (still an error), "180" (plan
 * returns). Three jarring states to change one digit.
 *
 * So the draft lives here while it is being typed, and only a plausible value
 * reaches the store. An implausible one is committed on blur, where it belongs:
 * a warning when you have finished is help, and the same warning after one
 * keystroke is an app arguing with you mid-sentence.
 */
function DraftNumber({ value, onCommit, plausible, width = 72, label }) {
  const [draft, setDraft] = useState(null)
  const box = useRef(null)

  /*
   * Keep this field where the eye left it.
   *
   * Committing the third of the three values is what unlocks the whole plan,
   * and the plan renders *above* this form — so the moment somebody finished
   * typing their age, the results appeared and shoved the field they were
   * looking at from 355px down the page to 1933px. Off screen, still focused,
   * with the keyboard open over whatever replaced it.
   *
   * The layout is right: results belong at the top. What is wrong is the page
   * moving under a finger. So the field's position is measured before the
   * commit and the scroll is corrected by however far it travelled, which
   * leaves it visually stationary while everything else grows around it.
   */
  const anchored = (commit) => {
    const before = box.current?.getBoundingClientRect().top
    commit()
    if (before == null) return

    requestAnimationFrame(() => {
      const after = box.current?.getBoundingClientRect().top
      if (after == null) return
      const moved = after - before
      // A pixel or two is rounding, not a jump worth correcting.
      if (Math.abs(moved) > 2) window.scrollBy({ top: moved, behavior: 'instant' })
    })
  }

  const type = (raw) => {
    const clean = String(raw).replace(/\D/g, '').slice(0, 3)
    setDraft(clean)
    const next = clean === '' ? null : Number(clean)
    // Only good values move the rest of the screen. A half-typed one changes
    // nothing, which is why the plan below stays put.
    if (next !== null && plausible(next)) anchored(() => onCommit(next))
  }

  const settle = () => {
    if (draft !== null) {
      // Whatever they actually left, now that they have left it — including
      // empty, which is a real intention once you have looked away.
      onCommit(draft === '' ? null : Number(draft))
      setDraft(null)
    }
  }

  return (
    <input
      className="numin"
      type="text"
      inputMode="numeric"
      aria-label={label}
      ref={box}
      style={{ width }}
      value={draft ?? (value ?? '')}
      onFocus={(e) => e.target.select()}
      onChange={(e) => type(e.target.value)}
      onBlur={settle}
    />
  )
}

const plausibleHeight = (cm) => cm >= 120 && cm <= 230
const plausibleAge = (years) => years >= 13 && years <= 100
const plausibleFeet = (ft) => ft >= 4 && ft <= 7
const plausibleInches = (inch) => inch >= 0 && inch <= 11

/**
 * The three things the app cannot work out on its own.
 *
 * Weight is not among them — it is in the weigh-in log already, and a second
 * place to type it would eventually disagree with the first.
 */
function AboutYou({ S, update, missing = [] }) {
  const nutrition = S.nutrition ?? {}
  const imperial = S.unit === 'lb'
  const { feet, inches } = cmToHeight(nutrition.heightCm)
  const problems = validate(nutrition)

  const setField = (key, value) =>
    update((s) => {
      s.nutrition = { ...(s.nutrition ?? {}), [key]: value }
    })

  return (
    <>
      <Section title={t('About you')}>
        <Row
          icon="scale"
          iconTint="var(--ui)"
          title={t('Weight')}
          subtitle={missing.includes('weight') ? t('Not logged yet') : undefined}
          accessory="chevron"
          onClick={() => bwSheet()}
          value={
            missing.includes('weight')
              ? t('Log it')
              : `${fmtNum(weightInUnit(latestWeightKg(S), S.unit))} ${S.unit}`
          }
        />

        <Row icon="figureStrength" iconTint="var(--teal)" title={t('Height')}>
          {imperial ? (
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <DraftNumber
                value={feet}
                width={54}
                label={t('Height in feet')}
                plausible={plausibleFeet}
                onCommit={(v) => setField('heightCm', heightToCm(v, inches ?? 0))}
              />
              <span className="muted small">ft</span>
              <DraftNumber
                value={inches}
                width={54}
                label={t('Height in inches')}
                plausible={plausibleInches}
                onCommit={(v) => setField('heightCm', heightToCm(feet ?? 0, v))}
              />
              <span className="muted small">in</span>
            </div>
          ) : (
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <DraftNumber
                value={nutrition.heightCm}
                label={t('Height in centimetres')}
                plausible={plausibleHeight}
                onCommit={(v) => setField('heightCm', v)}
              />
              <span className="muted small">cm</span>
            </div>
          )}
        </Row>

        <Row icon="person" iconTint="var(--indigo)" title={t('Age')}>
          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            <DraftNumber
              value={nutrition.ageYears}
              label={t('Age in years')}
              plausible={plausibleAge}
              onCommit={(v) => setField('ageYears', v)}
            />
            <span className="muted small">{t('years')}</span>
          </div>
        </Row>
      </Section>

      {(problems.heightCm || problems.ageYears) && (
        <div className="card" role="alert">
          <div className="muted small">{problems.heightCm || problems.ageYears}</div>
        </div>
      )}
    </>
  )
}

/** Said once, while the app still has nothing to show. */
function SetupIntro() {
  return (
    <div className="card">
      <h3 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="scale" /> {t('Three things and it can start')}
      </h3>
      <div className="muted small">
        {t(
          'Your weight comes from your weigh-ins, so it stays current. Height and age it has to ask for once.',
        )}
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- activity */

function ActivityAndDiet({ S, update }) {
  const nutrition = S.nutrition ?? {}
  const setField = (key, value) =>
    update((s) => {
      s.nutrition = { ...(s.nutrition ?? {}), [key]: value }
    })

  return (
    <Section
      title={t('How you live')}
      footer={t('Activity moves the calorie number more than anything else here.')}
    >
      {Object.entries(ACTIVITY_LABELS).map(([key, label]) => (
        <Row
          key={key}
          title={t(label)}
          onClick={() => setField('activity', key)}
          accessory="none"
          value={(nutrition.activity ?? 'light') === key ? <Icon name="check" /> : null}
        />
      ))}
      {/*
        * Stacked rather than inline. Four options beside a label is wider than
        * a phone, and the control ended up printed on top of its own title.
        */}
      <div
        className="lrow"
        style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, paddingTop: 13, paddingBottom: 14 }}
      >
        <span className="lrow-t">{t('What you eat')}</span>
        <Segmented
          options={Object.entries(DIETS).map(([value, { label }]) => ({ value, label: t(label) }))}
          value={nutrition.diet ?? 'nonveg'}
          onChange={(v) => setField('diet', v)}
        />
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ plan */

/**
 * A planned meal, with the one control the whole tab was missing.
 *
 * The plan used to be read-only: it told somebody what to eat and never asked
 * whether they had. Ticking a meal writes it into the log at the exact portion
 * the planner prescribed, so the running total below is what they actually ate
 * rather than what they were told to.
 */
function MealCard({ meal, logged, onToggle }) {
  return (
    <div className="lrow" style={{ gap: 12, alignItems: 'center' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row between">
          <span className="muted small">{t(SLOT_LABELS[meal.slot])}</span>
          <span className="muted small">
            {meal.kcal} kcal · {meal.proteinG} g {t('protein')}
          </span>
        </div>
        <div style={{ fontWeight: 600, textDecoration: logged ? 'line-through' : 'none', opacity: logged ? 0.55 : 1 }}>
          {meal.name}
        </div>
        <div className="muted small">
          {meal.portions.map((p) => `${t(p.name)} ${p.grams} g`).join(' · ')}
        </div>
      </div>
      <button
        className={'mealtick' + (logged ? ' on' : '')}
        aria-pressed={logged}
        aria-label={logged ? t('Logged — tap to undo') : t('I ate this')}
        onClick={onToggle}
      >
        <Icon name="check" />
      </button>
    </div>
  )
}

/**
 * How today is actually going.
 *
 * The number somebody opens this tab for once they have a plan. Going over is
 * shown as going over rather than a bar politely stopping at full — the whole
 * reason to log a day is to find out where it landed.
 */
function Today({ totals, targets, entries, onRemove }) {
  const p = progress(totals, targets)

  const Bar = ({ label, stat, unit, tint }) => (
    <div style={{ marginTop: 10 }}>
      <div className="row between" style={{ marginBottom: 4 }}>
        <span className="small">{label}</span>
        <span className="muted small">
          {stat.eaten} / {stat.target} {unit}
          {stat.over > 0 && <span style={{ color: 'var(--orange)' }}> · {stat.over} over</span>}
        </span>
      </div>
      <div className="eatbar">
        <span
          className={'eatbar-fill' + (stat.over > 0 ? ' over' : '')}
          style={{ width: `${stat.pct}%`, background: stat.over > 0 ? 'var(--orange)' : tint }}
        />
      </div>
    </div>
  )

  return (
    <div className="card">
      <div className="row between">
        <h3 style={{ margin: 0 }}>{t('Today so far')}</h3>
        <span className="muted small">
          {entries.length === 0
            ? t('nothing logged')
            : t('{0} left', `${p.calories.left} kcal`)}
        </span>
      </div>

      <Bar label={t('Calories')} stat={p.calories} unit="kcal" tint="var(--acc)" />
      <Bar label={t('Protein')} stat={p.protein} unit="g" tint="var(--teal)" />

      {entries.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {entries.map((entry) => (
            <div key={entry.id} className="row between" style={{ padding: '6px 0' }}>
              <span className="small" style={{ flex: 1, minWidth: 0 }}>
                {t(entry.name)}
                {entry.grams ? <span className="muted"> {entry.grams} g</span> : null}
              </span>
              <span className="muted small" style={{ marginRight: 10 }}>
                {entry.kcal} kcal
              </span>
              <button
                className="iconbtn"
                aria-label={t('Remove')}
                onClick={() => onRemove(entry.id)}
                style={{ width: 30, height: 30 }}
              >
                <Icon name="xmark" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Logging something that was never in the plan.
 *
 * Most days. An app that only counts food it suggested stops matching reality
 * by Tuesday, and once the number on screen is wrong nobody opens it again.
 */
function LogAnything({ onLog }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(null)
  const [grams, setGrams] = useState('100')

  const results = useMemo(() => searchFoods(query).slice(0, 8), [query])

  const commit = () => {
    const entry = foodEntry(picked.key, Number(grams))
    if (!entry) return
    onLog(entry)
    setPicked(null)
    setQuery('')
    setGrams('100')
    setOpen(false)
  }

  if (!open) {
    return (
      <div className="card">
        <Button icon="plus" onClick={() => setOpen(true)}>
          {t('Log something else')}
        </Button>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>{t('What did you eat?')}</h3>
        <button className="iconbtn" aria-label={t('Close')} onClick={() => setOpen(false)}>
          <Icon name="xmark" />
        </button>
      </div>

      {!picked ? (
        <>
          <input
            className="field"
            autoFocus
            placeholder={t('Search food…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="list" style={{ marginTop: 8 }}>
            {results.map((food) => (
              <button
                key={food.key}
                className="goalrow"
                onClick={() => setPicked(food)}
              >
                <span style={{ flex: 1 }}>{t(food.name)}</span>
                <span className="muted small">{food.kcal} kcal / 100 g</span>
              </button>
            ))}
            {results.length === 0 && (
              <div className="muted small" style={{ padding: '8px 0' }}>
                {t('Nothing matches that yet.')}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{t(picked.name)}</div>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input
              className="numin"
              inputMode="numeric"
              aria-label={t('Grams')}
              autoFocus
              style={{ width: 90 }}
              value={grams}
              onChange={(e) => setGrams(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
            <span className="muted small">g</span>
            <span className="muted small" style={{ flex: 1, textAlign: 'right' }}>
              {Math.round((picked.kcal * (Number(grams) || 0)) / 100)} kcal
            </span>
          </div>
          <div style={{ height: 12 }} />
          <Button variant="primary" onClick={commit} disabled={!Number(grams)}>
            {t('Add it')}
          </Button>
        </>
      )}
    </div>
  )
}

function Plan({ targets, diet, S, update }) {
  const today = new Date().getDay()
  const [day, setDay] = useState(today)
  const [showWeek, setShowWeek] = useState(false)

  const iso = dayKey()
  const entries = entriesFor(S, iso)
  const totals = totalsFor(S, iso)

  /*
   * Ticking a meal writes the portion the planner actually prescribed, not the
   * dish's written serving — the plan scales to the person, so logging the
   * recipe would under-count everybody it scaled up.
   */
  const toggleMeal = (meal, planned) =>
    update((draft) => {
      const already = entriesFor(draft, iso).find((e) => e.kind === 'meal' && e.ref === meal.id)
      if (already) removeEntry(draft, already.id, iso)
      else addEntry(draft, mealEntry(planned, meal.servings), iso)
    })

  const logFood = (entry) => update((draft) => addEntry(draft, entry, iso))

  /*
   * Yesterday again. People eat the same things, and re-ticking four meals
   * every morning is the friction that ends the habit — the app already knows
   * exactly what yesterday was.
   */
  const yesterday = previousDay(iso)
  const canRepeat = entries.length === 0 && entriesFor(S, yesterday).length > 0
  const repeatYesterday = () =>
    update((draft) => {
      for (const entry of copyOfDay(draft, yesterday)) addEntry(draft, entry, iso)
    })
  const drop = (id) => update((draft) => removeEntry(draft, id, iso))

  const plan = useMemo(
    () => planDay(targets, { diet, dayIndex: day }),
    [targets.calories, targets.proteinG, diet, day],
  )

  const list = useMemo(
    () => (showWeek ? shoppingList(planWeek(targets, { diet })) : []),
    [showWeek, targets.calories, targets.proteinG, diet],
  )

  return (
    <>
      {/* The loop, closed. Everything below plans; this records. */}
      <Today totals={totals} targets={targets} entries={entries} onRemove={drop} />

      {canRepeat && (
        <div className="card">
          <Button icon="reset" onClick={repeatYesterday}>{t('Same as yesterday')}</Button>
        </div>
      )}

      <LogAnything onLog={logFood} />

      <div className="card">
        <div className="row between" style={{ marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>{t('Food for the day')}</h3>
          <span className="muted small">
            {plan.totals.kcal} kcal · {plan.totals.proteinG} g
          </span>
        </div>

        {/* Seven days, so it is not the same plate every day and somebody can
            look ahead at what they would be shopping for. */}
        {/* Seven equal columns. Wrapped, the last chip dropped onto a line of
            its own — and on a Saturday that orphan was the selected day. */}
        <div className="daybar">
          {DAY_NAMES.map((name, index) => (
            <button
              key={name}
              className={'chip' + (index === day ? ' on' : '')}
              aria-pressed={index === day}
              onClick={() => setDay(index)}
            >
              {t(name)}
            </button>
          ))}
        </div>

        {/*
          * Keyed on what the plan is for, so React replaces rather than patches
          * it and the fade actually plays. Without that the food teleports and
          * nothing connects the tap to the result.
          */}
        <div className="list planfade" key={`${day}-${diet}-${targets.calories}-${targets.proteinG}`}>
          {plan.meals.map((meal) => (
            <MealCard
              key={meal.id + meal.slot}
              meal={meal}
              logged={isLogged(S, meal.id, iso)}
              onToggle={() => toggleMeal(meal, MEAL_BY_ID[meal.id])}
            />
          ))}
        </div>
      </div>

      {/*
        * Before the meals would be nagging; after them it is a footnote nobody
        * reads. Here it is the first thing under the plan it qualifies.
        */}
      {plan.gaps.length > 0 && (
        <div className="card" role="status">
          <h3 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="info" /> {t('Where this day falls short')}
          </h3>
          {plan.gaps.map((gap) => (
            <div key={gap} className="muted small" style={{ marginTop: 6 }}>
              {gap}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        {/* `size="sm"` is what stops the button claiming the whole row — a plain
            .btn is width:100% and squeezes the heading into one word a line. */}
        <div className="row between" style={{ gap: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>{t('Shopping list')}</h3>
            <div className="muted small">{t('Everything for seven days, added up')}</div>
          </div>
          <Button size="sm" variant="tinted" onClick={() => setShowWeek((v) => !v)}>
            {showWeek ? t('Hide') : t('Show')}
          </Button>
        </div>

        {showWeek && (
          <div className="reveal" style={{ marginTop: 12 }}>
            {list.map((item) => (
              <div key={item.name} className="row between" style={{ padding: '5px 0' }}>
                <span className="small">{t(item.name)}</span>
                <span className="muted small">
                  {item.grams >= 1000
                    ? `${fmtNum(Math.round(item.grams / 100) / 10)} kg`
                    : `${item.grams} g`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ view */

export default function Nutrition() {
  const S = useStore((s) => s.S)
  const update = useStore((s) => s.update)

  const state = useMemo(() => nutritionState(S), [S])

  const goals = useMemo(
    () => (state.status === 'ready' ? allGoals(state.profile) : []),
    [state],
  )

  const targets = useMemo(
    () => (state.status === 'ready' ? computeTargets(state.profile) : null),
    [state],
  )

  const chooseGoal = (goal) =>
    update((s) => {
      s.nutrition = { ...(s.nutrition ?? {}), goal }
    })

  const band = state.bmi ? bmiCategory(state.bmi) : null

  return (
    <div className="narrow">
      <div className="hdr">
        <div>
          <h1>{t('Nutrition')}</h1>
          <div className="sub">{t('Worked out from your body, not guessed')}</div>
        </div>
      </div>

      {/*
        * Keyed on the status so the three shapes of this screen fade between
        * each other. Filling in the last field turns a short form into a full
        * day of food, and refusing turns it back — a change that large should
        * not simply blink.
        */}
      <div className="planfade" key={state.status}>

      {state.status === 'incomplete' && (
        <>
          <SetupIntro />
          <AboutYou S={S} update={update} missing={state.missing} />
        </>
      )}

      {/*
        * A refusal replaces the screen rather than sitting on top of it. Showing
        * the reason a plan was withheld beside the plan itself would be worse
        * than showing neither.
        */}
      {state.status === 'refused' && (
        <>
          <div className="card" role="alert">
            <h3 style={{ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="shield" /> {t('This one is not ours to answer')}
            </h3>
            <div className="muted small">{state.screened.message}</div>
          </div>

          {state.screened.suggest && (
            <div className="card">
              <div className="muted small" style={{ marginBottom: 10 }}>
                {t('It can help with this instead.')}
              </div>
              <Button variant="primary" onClick={() => chooseGoal(state.screened.suggest)}>
                {t(GOAL_LABELS[state.screened.suggest])}
              </Button>
            </div>
          )}

          {/*
            * Reachable from here too. A refusal triggered by a mistyped age is
            * a dead end if the field that caused it is on a screen this one
            * replaced.
            */}
          <AboutYou S={S} update={update} />
          <ActivityAndDiet S={S} update={update} />
        </>
      )}

      {state.status === 'ready' && targets && (
        <>
          <div className="card">
            <div className="row between" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>{t('Your numbers')}</h3>
              <span className="muted small">
                {t('BMI')} {fmtNum(Math.round(state.bmi * 10) / 10)}
                {band ? ` · ${t(band.label)}` : ''}
              </span>
            </div>

            <div className="tiles">
              <Macro label={t('Maintenance')} value={targets.tdee} unit="kcal" />
              <Macro label={t('At rest')} value={targets.bmr} unit="kcal" />
            </div>

            {/*
              * BMI is a signpost and the screen has to say so. It was derived
              * on European populations, the WHO publishes lower thresholds for
              * Asian ones, and it cannot tell muscle from fat at all.
              */}
            <div className="muted small" style={{ marginTop: 10 }}>
              {t(
                'BMI cannot tell muscle from fat, and its usual bands were drawn from European populations — lower thresholds apply across much of Asia. Treat it as a signpost.',
              )}
            </div>
          </div>

          <div className="card">
            <h3 style={{ margin: '0 0 4px' }}>{t('What each goal would mean')}</h3>
            <div className="muted small" style={{ marginBottom: 10 }}>
              {state.chosen
                ? t('Tap another to switch.')
                : t('All four, before you pick one. The decision is the number.')}
            </div>

            <div className="list">
              {goals.map((row) => {
                const on = row.goal === state.goal
                return (
                  <button
                    key={row.goal}
                    className={'goalrow' + (on ? ' on' : '')}
                    aria-pressed={on}
                    onClick={() => chooseGoal(row.goal)}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                        {on && <Icon name="check" />}
                        {/* Weight comes from the stylesheet: an inline one here
                            silently outranked `.goalrow.on` and the selected
                            goal was never actually bold. */}
                        <span className="goalrow-name">{t(row.label)}</span>
                      </div>
                      <div className="muted small">
                        {row.proteinG} g {t('protein')} · {row.fatG} g {t('fat')} · {row.carbG} g{' '}
                        {t('carbs')}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontWeight: 700 }}>{row.calories}</div>
                      <div className="muted small">kcal</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {targets.safetyNotes.length > 0 && (
            <div className="card">
              <h3 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="info" /> {t('What was adjusted, and why')}
              </h3>
              {/*
                * Every clamp that fired, said out loud. A number quietly changed
                * is worse than one refused: somebody plans around it, it does not
                * do what they expected, and they conclude the app is wrong.
                */}
              {targets.safetyNotes.map((note) => (
                <div key={note} className="muted small" style={{ marginTop: 6 }}>
                  {note}
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <h3 style={{ margin: '0 0 10px' }}>{t('Your day, in grams')}</h3>
            <div className="tiles">
              <Macro label={t('Calories')} value={targets.calories} unit="kcal" />
              <Macro label={t('Protein')} value={targets.proteinG} unit="g" tint="var(--acc)" />
              <Macro label={t('Fat')} value={targets.fatG} unit="g" />
              <Macro label={t('Carbs')} value={targets.carbG} unit="g" />
            </div>
          </div>

          <Plan targets={targets} diet={state.profile.diet} S={S} update={update} />

          <AboutYou S={S} update={update} />
          <ActivityAndDiet S={S} update={update} />

          <div className="card">
            <h3 style={{ margin: '0 0 4px' }}>{t('What this is not')}</h3>
            <div className="muted small">
              {t(
                'Estimates, not measurements. Every equation here predicts a population average and real metabolisms sit either side of it, so treat the first two weeks as a starting point and adjust from what the scale actually does. Food values are rounded reference figures — the same dal varies by lentil.',
              )}
              <br />
              <br />
              {t(
                'This is not medical advice. If you are pregnant, managing a condition, or recovering from an eating disorder, this app is not the right tool.',
              )}
            </div>
          </div>
        </>
      )}

      </div>

      <div style={{ height: 24 }} />
    </div>
  )
}
