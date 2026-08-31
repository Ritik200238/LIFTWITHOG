import { create } from 'zustand'
import { api } from '../lib/api.js'
import { localTZ } from '../lib/format.js'
import { registerCustom } from '../lib/exercises.js'
import { DEMO, DEMO_SEEDED } from '../lib/demo.js'
import { MOBILE, nativeLoad, nativeSave, syncReminder } from '../lib/mobile.js'
import { mergeStates, reconcile } from '../lib/syncMerge.js'
import { withDefaults as fill } from '../lib/withDefaults.js'

const KEY = 'gym_state_v1'
export const DEF = {
  unit: 'kg', restSec: 90, sound: true, keepAwake: true, lang: 'en',
  theme: 'dark', accent: 'lime', body: 'male', targetW: null,
  bodyweight: [], routines: [], week: {}, dayPlan: {},
  exWeights: {}, workouts: [], active: null, customEx: [],
  /*
   * Minimised by default. At 'full' the animation is 320px of a ~700px phone,
   * so the sets — the thing you touch twenty times a session — start below the
   * fold and you scroll to log every one. Nothing is removed: one tap expands
   * it, and the choice is remembered across exercises and future workouts.
   */
  // No 'gifSizeMigrated' here on purpose: the defaults are filled in before
  // the migration runs, so putting the flag in DEF marks every existing profile
  // as already migrated and the migration never fires for the people it exists
  // for.
  gifSize: 'mini',
  // What was actually eaten, by local date. The nutrition tab planned a day
  // and never asked whether any of it happened.
  foodLog: {},
  // Root hashes of 0G Storage backups this profile has made, oldest first.
  // Restoring used to mean hand-typing a 66-character hex string that the app
  // had only ever shown truncated in a toast — so the backup was unrestorable
  // by anybody who had not written it down off-screen.
  vaultBackups: [],
  // A note per exercise — cue, niggle, setup — shown the next time it comes up.
  // Keyed by exercise id: `{ [exId]: { text, t } }`.
  exNotes: {},
  // effort: which per-set effort scale is logged — 'none' | 'rir' | 'rpe'. null, not 'none', so
  // that a profile which never chose (loaded state is overlaid on DEF, on every path: local,
  // server pull, backup import) still falls back to the `showRir` boolean this replaced and
  // keeps the column it had. See effortOf.
  reminder: { on: false, time: '08:00', tz: null }, effort: null,
  // Age and height, which nothing else in the app needs, plus the three
  // choices behind a calorie target. Weight is deliberately absent: it lives in
  // `bodyweight` and a second copy here would drift out of step with the log.
  nutrition: { ageYears: null, heightCm: null, activity: 'light', goal: null, diet: 'nonveg', paceKgPerWeek: null }
}
const clone = o => JSON.parse(JSON.stringify(o))


/**
 * Changes to a stored profile that a new default cannot reach on its own.
 *
 * A default only applies to somebody who has never opened the app. Everyone who
 * already has is carrying the old value, so shipping a better default changes
 * nothing for the people actually using it — which is the entire point of
 * changing it.
 */
function migrate(state) {
  /*
   * The exercise animation was 320px of a ~700px phone, so the sets started
   * below the fold and you scrolled to log every one. Nobody chose that — it
   * was the default and the control to change it sat on top of the animation
   * itself. Moving them to the minimised size once is undone by one tap on
   * Expand, and that choice then sticks.
   */
  if (state.gifSize === 'full' && !state.gifSizeMigrated) {
    state.gifSize = 'mini'
    state.gifSizeMigrated = true
  }
  return state
}

function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return migrate(fill(JSON.parse(raw), DEF))
  } catch (e) { /* ignore */ }
  return clone(DEF)
}

const hasData = st => !!((st.workouts || []).length || (st.routines || []).length || (st.bodyweight || []).length)

export const useStore = create((set, get) => {
  let pushTm = null
  let saveTm = null

  // Mobile build: mirror the state into a file in the app's data directory (survives WebView
  // storage eviction) and keep the native reminder schedule in step with the weekly plan.
  const nativePersist = () => {
    clearTimeout(saveTm)
    saveTm = setTimeout(() => { saveTm = null; nativeSave(get().S); syncReminder(get().S) }, 800)
  }

  const persist = (S, push = true) => {
    S._ts = Date.now()
    registerCustom(S.customEx)
    localStorage.setItem(KEY, JSON.stringify(S))
    set({ S })
    if (MOBILE) nativePersist()
    if (push && get().user) {
      clearTimeout(pushTm)
      pushTm = setTimeout(() => get().pushState(), 1500)
    }
  }

  // A setting changed right before switching away/closing the tab must not get lost mid-debounce
  // (e.g. setting the reminder time then immediately backgrounding to test it). On mobile the
  // same applies to the file mirror — backgrounding is often the last thing before the OS
  // kills the app.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    if (MOBILE && saveTm) {
      clearTimeout(saveTm)
      saveTm = null
      nativeSave(get().S)
    }
    if (pushTm) {
      clearTimeout(pushTm)
      pushTm = null
      get().pushState()
    }
  })

  // Everything a sign-out leaves behind on this device, whichever way it was triggered.
  const clearLocalSession = () => {
    get().setUser(null)
    localStorage.removeItem('gym_guest')
    localStorage.removeItem('gym_dirty')
    localStorage.removeItem(KEY)
    persist(clone(DEF), false)
  }

  return {
    S: (() => { const s = loadState(); registerCustom(s.customEx); return s })(),
    user: (() => { try { return JSON.parse(localStorage.getItem('gym_user')) || null } catch { return null } })(),
    ready: false,

    // Mutate a draft of S via producer fn, then persist + schedule sync.
    update(mut, push = true) {
      const S = clone(get().S)
      mut(S)
      persist(S, push)
    },
    replaceState(S, push = false) { persist(clone(S), push) },

    isGuest: () => localStorage.getItem('gym_guest') === '1',
    setGuest(v) { if (v) localStorage.setItem('gym_guest', '1'); else localStorage.removeItem('gym_guest'); set({}) },

    setUser(u) {
      if (u) { localStorage.setItem('gym_user', JSON.stringify(u)); localStorage.removeItem('gym_guest') }
      else localStorage.removeItem('gym_user')
      set({ user: u })
    },

    async pushState() {
      if (!get().user) return
      clearTimeout(pushTm)
      try {
        await api('/api/data', { method: 'PUT', body: JSON.stringify({ state: get().S }) })
        localStorage.removeItem('gym_dirty')
      } catch (e) {
        /*
         * The server refused this write because it already held something
         * newer — another device got there first. Losing the race is normal;
         * losing the work is not, so the two are merged and sent again rather
         * than this device simply marking itself dirty and hoping.
         */
        if (e.status === 409 && e.data?.state) {
          const merged = fill(mergeStates(get().S, e.data.state), DEF)
          merged.active = get().S.active
          persist(merged, false)
          try {
            await api('/api/data', { method: 'PUT', body: JSON.stringify({ state: merged }) })
            localStorage.removeItem('gym_dirty')
            return
          } catch { /* fall through: keep it here and try again later */ }
        }
        localStorage.setItem('gym_dirty', '1')
      }
    },
    async pullState() {
      try {
        const { state } = await api('/api/data')
        const S = get().S
        const dirty = localStorage.getItem('gym_dirty') === '1'

        /*
         * This used to discard one side whenever both had moved. A device with
         * unsent changes refused the server's copy and pushed straight over it,
         * so whatever another device had logged in the meantime was gone — with
         * no error, and nothing to point at afterwards.
         *
         * `reconcile` still takes the newer copy whole in the ordinary case,
         * which is what keeps deleted workouts deleted. It only merges when
         * both sides genuinely changed, which is the case that used to lose
         * training.
         */
        const { action, state: next } = reconcile({
          local: S,
          remote: state,
          dirty,
          hasLocalData: hasData(S),
        })

        if (action === 'push') { await get().pushState(); return }

        const active = S.active
        const merged = fill(next, DEF)
        if (active) merged.active = active
        persist(merged, false)

        // A merge is work the server has not seen: it holds only the other
        // half. Leaving it here would lose this device's entries the moment
        // anything else pushed.
        if (action === 'merge') await get().pushState()
      } catch (e) { /* offline — keep local */ }
    },

    async signOut() {
      try { await get().pushState(); await api('/api/logout', { method: 'POST', body: '{}' }) } catch (e) { /* */ }
      clearLocalSession()
    },

    // "Sign out everywhere": the server bumps this profile's session version, which kills every
    // session it has on any device — this browser included, so the app has to end up exactly
    // where a normal signOut leaves it. Unlike signOut the request is NOT swallowed: if it fails
    // the sessions elsewhere are all still valid, and wiping this device's copy of the data
    // would sign the user out of the one place the bump didn't reach. Caller reports the error.
    async signOutAll() {
      await get().pushState()   // never throws — stores gym_dirty and moves on when offline
      await api('/api/logout/all', { method: 'POST', body: '{}' })
      clearLocalSession()
    },

    // Demo build only: drop the seeded example profile back in (Settings → "Reset demo data").
    // Dynamic import so the generator never ships in a self-hosted bundle.
    async resetDemo() {
      const { buildDemoState } = await import('../lib/demoSeed.js')
      localStorage.removeItem('gym_dirty')
      persist(fill(buildDemoState(), DEF), false)
    },

    // Boot: ask the server who we are, then pull.
    async boot() {
      // Mobile build: no backend either — restore from the file mirror (the durable copy;
      // localStorage may have been evicted since the last run) and go straight in.
      if (MOBILE) {
        const saved = await nativeLoad()
        const S = get().S
        if (saved && (!hasData(S) || (saved._ts || 0) >= (S._ts || 0))) {
          persist(fill(saved, DEF), false)
        } else if (hasData(S)) {
          nativeSave(S)   // first run after an update from a file-less version: seed the mirror
        }
        get().setGuest(true)
        syncReminder(get().S)
        set({ ready: true })
        return
      }
      // Demo build (GitHub Pages): no backend at all — seed once, stay in guest mode.
      if (DEMO) {
        if (!localStorage.getItem(DEMO_SEEDED)) {
          localStorage.setItem(DEMO_SEEDED, '1')
          await get().resetDemo()
        }
        get().setGuest(true)
        set({ ready: true })
        return
      }
      /*
       * Somebody who chose "Continue without account" has no session to ask
       * about. Asking anyway 401s on every single load — handled, but it puts
       * a red error in the console of a working app and spends a round trip
       * before the first paint to learn what the guest flag already says.
       */
      if (get().isGuest()) { set({ ready: true }); return }

      try {
        const me = await api('/api/me')
        get().setUser(me.user)
        await get().pullState()
        // Re-stamp the reminder's timezone on every load — keeps it correct if you're travelling,
        // without needing to revisit Settings.
        const tz = localTZ()
        if (get().S.reminder?.on && get().S.reminder.tz !== tz) {
          get().update(s => { s.reminder = { ...s.reminder, tz } })
        }
      } catch (e) {
        if (e.status === 401) get().setUser(null)
      }
      set({ ready: true })
    }
  }
})

export { hasData }
