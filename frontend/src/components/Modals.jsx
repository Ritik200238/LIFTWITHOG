import { useEffect, useRef } from 'react'
import { useUI } from '../store/useUI.js'

// One bottom sheet (or centered dialog) with swipe-to-dismiss.
function Sheet({ sheet }) {
  const { closeSheet } = useUI()
  const ref = useRef(null)
  const drag = useRef({ startY: null, delta: 0 })

  const onTouchStart = e => {
    const el = ref.current
    // a gesture that begins on a slider (or opted-out control) belongs to that control,
    // not to the sheet's swipe-to-dismiss — so it keeps working while you drag
    if (e.target.closest && e.target.closest('input[type=range], [data-nodrag]')) {
      drag.current = { startY: null, delta: 0 }
      return
    }
    drag.current = { startY: el.scrollTop <= 0 ? e.touches[0].clientY : null, delta: 0 }
  }
  const onTouchMove = e => {
    const el = ref.current, d = drag.current
    if (d.startY === null) return
    d.delta = e.touches[0].clientY - d.startY
    if (d.delta > 0 && el.scrollTop <= 0) {
      e.preventDefault()
      el.style.transition = 'none'
      el.style.transform = `translateY(${d.delta}px)`
    } else d.delta = 0
  }
  const onTouchEnd = () => {
    const el = ref.current, d = drag.current
    if (d.startY === null) return
    el.style.transition = 'transform .2s'
    if (d.delta > 90 && !sheet.locked) { el.style.transform = 'translateY(110%)'; setTimeout(() => closeSheet(sheet.id), 180) }
    else el.style.transform = ''
    d.startY = null
  }

  // non-passive touchmove so preventDefault works (bottom sheets only; centered dialogs have no ref)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [])

  const close = () => closeSheet(sheet.id)
  if (sheet.kind === 'center') {
    return (
      <div>
        <div className="mback" onClick={() => { if (!sheet.locked) close() }} />
        <div className="center" role="dialog" aria-modal="true">{sheet.render(close)}</div>
      </div>
    )
  }
  return (
    <div>
      <div className="mback" onClick={() => { if (!sheet.locked) close() }} />
      <div
        className="sheet"
        ref={ref}
        role="dialog"
        aria-modal="true"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="grab" />
        {sheet.render(close)}
      </div>
    </div>
  )
}

export default function Modals() {
  const sheets = useUI(s => s.sheets)
  const guarded = useRef(null)   // the URL when the back-guard entry was pushed

  /*
   * Back closes the sheet, not the screen.
   *
   * On Android the system back gesture is how people dismiss a bottom sheet.
   * This app navigated instead: the route underneath changed and the sheet
   * stayed up, so dismissing it afterwards left you on a screen you never
   * asked for. Measured — open the plan sheet, press back, and you are on
   * Stats with the plan sheet still covering it.
   *
   * The fix is a history entry that exists only while a sheet is open. It does
   * not change the URL, so the router never sees a navigation; back simply
   * spends it, and we close the top sheet instead. Nested sheets each get
   * their own, and a locked sheet — the finish summary, mid-write flows —
   * swallows back and puts the entry straight back.
   */
  useEffect(() => {
    if (!sheets.length) return

    // The URL at push time decides, on the way out, whether spending the entry
    // is safe — see the cleanup below.
    const push = () => { history.pushState({ sheetGuard: true }, ''); guarded.current = location.href }
    push()

    const onPop = () => {
      guarded.current = null
      const ui = useUI.getState()
      const top = ui.sheets[ui.sheets.length - 1]
      if (!top) return
      if (!top.locked) ui.closeSheet(top.id)
      if (useUI.getState().sheets.length) push()
    }

    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      /*
       * Closed by a tap instead of by back: the entry we added is still on the
       * stack, and leaving it there would make the next back do nothing.
       *
       * Unless the sheet navigated on its way out — the finish summary's
       * "Nice!" closes and goes Home in the same breath. The guard is then
       * buried under that navigation, and spending it would undo the
       * navigation instead: measured, that landed on the workout screen of the
       * session just finished. Left buried it is invisible, and the next back
       * goes exactly where it would have anyway.
       */
      if (guarded.current && guarded.current === location.href) {
        guarded.current = null
        history.back()
      }
    }
  }, [sheets.length > 0])

  // lock the page behind any open sheet (iOS-safe)
  /*
   * Escape closes the top sheet — the keyboard's version of the back gesture.
   *
   * The whole app runs on sheets, and until now the only ways out were a tap on
   * the backdrop, a drag, or the device's back button. All three are touch or
   * platform gestures, so somebody on a keyboard could open the exercise picker
   * and have no way to leave it. It mirrors the back handler exactly, including
   * the lock: a locked sheet — the finish summary, a mid-write flow — refuses
   * both.
   */
  useEffect(() => {
    if (!sheets.length) return

    const onKey = (e) => {
      if (e.key !== 'Escape') return
      const ui = useUI.getState()
      const top = ui.sheets[ui.sheets.length - 1]
      if (!top || top.locked) return
      e.preventDefault()
      ui.closeSheet(top.id)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheets.length])

  useEffect(() => {
    if (!sheets.length) return
    const y = window.scrollY || 0
    const b = document.body.style
    b.position = 'fixed'; b.top = -y + 'px'; b.left = '0'; b.right = '0'; b.width = '100%'
    return () => {
      b.position = b.top = b.left = b.right = b.width = ''
      window.scrollTo(0, y)
    }
  }, [sheets.length > 0])

  if (!sheets.length) return null
  return (
    <div id="modal-root" className="open">
      {sheets.map(s => <Sheet key={s.id} sheet={s} />)}
    </div>
  )
}
