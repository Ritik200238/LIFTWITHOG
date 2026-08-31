import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { MOBILE } from './lib/mobile.js'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>
)

/*
 * Not in the mobile build: the native shell already serves everything from disk.
 *
 * localhost is a secure context, so a real build served by `vite preview` can
 * register too — which is the only way to actually test offline before
 * shipping. The dev server stays excluded on purpose: a worker caching
 * unbundled modules turns every subsequent edit into a debugging session about
 * why the change did not appear.
 */
const LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1'

if (!MOBILE && !import.meta.env.DEV && 'serviceWorker' in navigator && (location.protocol === 'https:' || LOCAL)) {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}
