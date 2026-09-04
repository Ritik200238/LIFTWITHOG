/*
 * Every control a person can operate has a name a screen reader can say.
 *
 * This exists because the app failed that in three separate ways at once, and
 * none of them were visible on screen:
 *
 *   · every Switch in Settings announced as "switch, on" — the row drew the
 *     word "Sounds" next to it, but the button was a sibling of that text, not
 *     labelled by it
 *   · every stepper in a sheet had two buttons called "Decrease" and
 *     "Increase", four steppers deep, with nothing to tell them apart
 *   · every weight and rep field in a live workout was an unnamed text box, a
 *     dozen rows of "edit text, blank"
 *
 * The check is on the source rather than on a rendered tree because these are
 * one-line omissions at the call site, and the failure mode is a new control
 * added next year with no label — which a render test of today's screens would
 * not catch either. Reading the JSX catches it wherever it is written.
 *
 * `components/ui.jsx` is the primitive layer and is checked by its own rules
 * below: its inputs take their name from the caller through `...rest`, so an
 * attribute scan of that file would only ever find the forwarding.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('..', import.meta.url))

function jsxFiles(dir = SRC, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      // Generated data packs, not hand-written UI.
      if (name === 'locales' || name === 'instr' || name === 'data') continue
      jsxFiles(full, out)
    } else if (name.endsWith('.jsx')) out.push(full)
  }
  return out
}

/*
 * Pull whole JSX elements, not lines. Half of these attributes are written on a
 * continuation line, so a line-oriented grep reports a missing label on an
 * element that has one two lines down — the kind of check that gets deleted
 * for being wrong rather than fixed.
 *
 * Depth counting on < and > inside the tag handles the `style={{ ... }}` and
 * arrow-function attributes that make up most of this codebase's props.
 */
function elements(source, tag) {
  const found = []
  const open = new RegExp('<' + tag + '(?![A-Za-z0-9_])', 'g')
  let m
  while ((m = open.exec(source))) {
    let i = m.index + m[0].length
    let braces = 0, quote = null
    for (; i < source.length; i++) {
      const c = source[i]
      if (quote) { if (c === quote) quote = null; continue }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue }
      if (c === '{') braces++
      else if (c === '}') braces--
      else if (c === '>' && braces === 0) break
    }
    found.push({
      attrs: source.slice(m.index, i + 1),
      line: source.slice(0, m.index).split('\n').length,
      at: m.index
    })
  }
  return found
}

const NAMED = /\baria-label(ledby)?\s*=/
const files = jsxFiles()

// Matched on either separator: this repo is developed on Windows, where the
// paths come back with backslashes and a `endsWith('components/ui.jsx')` test
// silently exempts nothing.
const isPrimitives = f => /[\\/]components[\\/]ui\.jsx$/.test(f)

describe('every control carries a name', () => {
  it('finds the app to check', () => {
    // A scanner that silently matches nothing is a green tick that means nothing.
    expect(files.length).toBeGreaterThan(10)
  })

  it('the row publishes its title, and Switch points at it', () => {
    const ui = readFileSync(join(SRC, 'components/ui.jsx'), 'utf8')

    // The row's visible title is the id target...
    expect(ui).toMatch(/<span className="lrow-t" id=\{titleId\}>/)
    expect(ui).toMatch(/<RowLabel\.Provider value=\{titleId\}>/)

    // ...and the switch inside it borrows that, so the spoken name is the
    // visible name by construction and cannot drift when the title is reworded.
    const sw = ui.slice(ui.indexOf('export function Switch'))
    expect(sw).toMatch(/aria-labelledby=/)
    expect(sw).toMatch(/aria-label=/)
  })

  it('every switch is named — by its row, or by itself', () => {
    const unnamed = []
    for (const file of files) {
      if (isPrimitives(file)) continue
      const src = readFileSync(file, 'utf8')
      for (const el of elements(src, 'Switch')) {
        if (/\blabel\s*=/.test(el.attrs)) continue
        // Otherwise it must sit inside a Row that has a title to lend it. The
        // row opens within a few lines above; anything further away is not a
        // row wrapping this control.
        const before = src.slice(0, el.at).split('\n').slice(-6).join('\n')
        const row = before.lastIndexOf('<Row')
        const close = before.lastIndexOf('</Row>')
        if (row > close && /title=/.test(before.slice(row))) continue
        unnamed.push(`${relative(SRC, file)}:${el.line}`)
      }
    }
    expect(unnamed).toEqual([])
  })

  it('every input a person types into is named', () => {
    const unnamed = []
    for (const file of files) {
      // The primitives forward the caller's name; see the header note.
      if (isPrimitives(file)) continue
      const src = readFileSync(file, 'utf8')
      for (const el of elements(src, 'input')) {
        const a = el.attrs
        // A file picker is opened by a labelled button and never reached by
        // keyboard; `hidden` ones are not reachable at all.
        if (/type="file"/.test(a) || /\bhidden\b/.test(a)) continue
        // A placeholder is a weak name, but it is a real one — every screen
        // reader falls back to it — and these are search boxes whose purpose is
        // drawn in the box itself.
        if (NAMED.test(a) || /placeholder=/.test(a)) continue
        // Wrapped in its own <label>.
        const before = src.slice(0, el.at).split('\n').slice(-4).join('\n')
        if (/<label[\s>]/.test(before)) continue
        unnamed.push(`${relative(SRC, file)}:${el.line}`)
      }
    }
    expect(unnamed).toEqual([])
  })

  it('every icon-only button says what it does', () => {
    // These two classes draw a glyph and nothing else, so the label is the only
    // text that exists.
    const unnamed = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const el of elements(src, 'button')) {
        if (!/className="(iconbtn|helpbtn)"/.test(el.attrs)) continue
        if (NAMED.test(el.attrs)) continue
        unnamed.push(`${relative(SRC, file)}:${el.line}`)
      }
    }
    expect(unnamed).toEqual([])
  })

  it('a stepper names its own plus and minus', () => {
    const ui = readFileSync(join(SRC, 'components/ui.jsx'), 'utf8')
    const stepper = ui.slice(ui.indexOf('export function Stepper'), ui.indexOf('/* ============================ slider'))
    // Not the bare word: four steppers in one sheet all said "Decrease".
    expect(stepper).toMatch(/t\('Decrease \{0\}', label\)/)
    expect(stepper).toMatch(/t\('Increase \{0\}', label\)/)
  })

  it('a set field says which set and which column it is', () => {
    const workout = readFileSync(join(SRC, 'views/Workout.jsx'), 'utf8')
    expect(workout).toMatch(/t\('Set \{0\} \{1\}', i \+ 1, col\.hd\)/)
    expect(workout).toMatch(/<NumberField aria-label=\{name\}/)
  })
})

describe('the scanner itself', () => {
  // Written after the first version of this file passed on JSX it had not
  // actually parsed. A check that cannot fail is not a check.
  it('reads attributes that continue onto later lines', () => {
    const src = '<input\n  className="x"\n  aria-label={t("Grams")}\n/>'
    expect(elements(src, 'input')[0].attrs).toMatch(NAMED)
  })

  it('flags an input with no name at all', () => {
    const src = '<input className="x" value={v} />'
    expect(NAMED.test(elements(src, 'input')[0].attrs)).toBe(false)
  })

  it('does not mistake <inputSomething> for an input', () => {
    expect(elements('<inputGroup a="1" />', 'input')).toEqual([])
  })

  it('is not confused by a > inside a prop', () => {
    const src = '<input onChange={e => e.x > 1 && f()} aria-label="n" />'
    const el = elements(src, 'input')
    expect(el).toHaveLength(1)
    expect(el[0].attrs).toMatch(NAMED)
  })
})
