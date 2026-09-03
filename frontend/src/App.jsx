import Logo from './components/Logo.jsx'
import { resolveTheme, watchSystemTheme } from './lib/theme.js'
import { Suspense, lazy, useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bindUI } from './components/ui.jsx'
import { ACCENTS } from './lib/format.js'
import { setLang, useLang } from './lib/i18n.js'
import { setNav } from './lib/nav.js'
import { useWakeLock } from './lib/wakelock.js'
import { startFlow } from './sheets.jsx'
import Icon from './components/Icon.jsx'
import TabBar from './components/TabBar.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Modals from './components/Modals.jsx'
import Toast from './components/Toast.jsx'
import RestTimer from './components/RestTimer.jsx'
import Login from './views/Login.jsx'
import Home from './views/Home.jsx'
import Plan from './views/Plan.jsx'
import RoutineEdit from './views/RoutineEdit.jsx'
import Workout from './views/Workout.jsx'
import Stats from './views/Stats.jsx'
import History from './views/History.jsx'
import Library from './views/Library.jsx'
import Nutrition from './views/Nutrition.jsx'
/*
 * Loaded when somebody opens them, not before.
 *
 * These four are the only screens that reach for ethers and the 0G SDKs, and
 * importing them here meant every first paint — including a Home screen with
 * no coach and no contract configured — downloaded and parsed the whole web3
 * stack first. On a phone on gym wifi that is the difference between the app
 * being there and the app arriving.
 *
 * Suspense falls back to the same dumbbell the boot screen uses, so a slow
 * chunk looks like the app loading rather than a blank rectangle.
 */
const Settings = lazy(() => import('./views/Settings.jsx'))
const Market = lazy(() => import('./views/Market.jsx'))
const Proof = lazy(() => import('./views/Proof.jsx'))
const Verify = lazy(() => import('./views/Verify.jsx'))
const Memory = lazy(() => import('./views/Memory.jsx'))
const Admin = lazy(() => import('./views/Admin.jsx'))

bindUI(useUI)   // lets the shared controls open sheets without importing the store at module scope

function applyPrefs(theme, accent) {
  const de = document.documentElement
  de.dataset.theme = resolveTheme(theme)
  de.dataset.accent = ACCENTS[accent] ? accent : 'ember'

  /*
   * The browser's own chrome — the status bar in a home-screen app — is
   * painted from this, so it has to move with the theme or the app sits under
   * a bar from the other one.
   */
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = de.dataset.theme === 'light' ? '#efeeeb' : '#0e0e0d'
}

function Shell() {
  const navigate = useNavigate()
  const loc = useLocation()
  const { S, user, ready } = useStore()
  const isGuest = useStore(s => s.isGuest())
  const langV = useLang()   // re-renders the whole shell when the language (pack) changes
  useEffect(() => { setNav(navigate) }, [navigate])
  useEffect(() => { applyPrefs(S.theme, S.accent) }, [S.theme, S.accent])
  /*
   * Following the system means following it *while the app is open*, not only
   * at startup — a phone on a sunset schedule flips under a running app, and an
   * app that only checked once would be the one wrong thing on the screen.
   */
  useEffect(() => {
    if (S.theme === 'light' || S.theme === 'dark') return
    return watchSystemTheme(() => applyPrefs(S.theme, S.accent))
  }, [S.theme, S.accent])
  useEffect(() => { setLang(S.lang || 'en') }, [S.lang])
  useEffect(() => { document.documentElement.lang = S.lang || 'en' }, [langV, S.lang])
  // every tab/route change starts at the top of the page
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])
  // bound to the workout, not to the route — checking Stats mid-session keeps the screen on
  useWakeLock(!!S.active && S.keepAwake !== false)

  const authed = user || isGuest
  if (!ready && !authed) return (
    <div id="app">
      <div style={{ paddingTop: '44vh', display: 'flex', justifyContent: 'center', fontSize: 34, color: 'var(--label-3)' }}>
        <Logo size={34} />
      </div>
    </div>
  )

  return (
    <>
      {/* keyed on the route: a view that throws is contained, and switching tabs
          re-mounts the boundary, so the tab bar is always a way out */}
      <div id="app" className="vfade" key={loc.pathname}>
        <ErrorBoundary>
          {/*
            * Verify is public on purpose.
            *
            * It exists for somebody who has not signed up and has no reason to
            * trust us — and behind the sign-in wall it was unreachable by
            * exactly that person. Nothing on it is private: contract addresses,
            * a live chain read, and commands anyone can run against the public
            * repository.
            */}
          {!authed && loc.pathname === '/verify' ? (
            <Suspense fallback={<div className="center" style={{ paddingTop: '38vh', fontSize: 30, color: 'var(--label-3)' }}><Logo size={34} /></div>}>
              <Verify />
            </Suspense>
          ) : !authed ? <Login /> : (
            <Suspense fallback={<div className="center" style={{ paddingTop: '38vh', fontSize: 30, color: 'var(--label-3)' }}><Logo size={34} /></div>}>
            <Routes>
              <Route path="/home" element={<Home />} />
              <Route path="/plan" element={<Plan />} />
              <Route path="/plan/r/:id" element={<RoutineEdit />} />
              <Route path="/workout" element={<Workout />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/history" element={<History />} />
              <Route path="/library" element={<Library />} />
              <Route path="/nutrition" element={<Nutrition />} />
              <Route path="/coaches" element={<Market />} />
              <Route path="/proof" element={<Proof />} />
              {/* The judge-facing door: no account, no coach, no goodwill assumed. */}
              <Route path="/verify" element={<Verify />} />
              {/* What the coach has learned, version by version. */}
              <Route path="/memory" element={<Memory />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/admin" element={user?.admin ? <Admin /> : <Navigate to="/home" replace />} />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
            </Suspense>
          )}
        </ErrorBoundary>
      </div>
      <TabBar onStart={startFlow} />
      <RestTimer />
      <Modals />
      <Toast />
    </>
  )
}

export default function App() {
  const boot = useStore(s => s.boot)
  useEffect(() => { boot() }, [boot])
  return <HashRouter><Shell /></HashRouter>
}
