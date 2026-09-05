/**
 * The little markdown a model actually writes, turned into blocks a sheet can draw.
 *
 * The coach's answer was rendered as one centred paragraph, asterisks and hash
 * marks included: "### Main Workout: #### Bench Press: - **Warm-up Set:**". The
 * model was asked for plain prose and wrote markdown anyway, as models do, and
 * the one screen that shows off 0G Compute looked like a broken text dump.
 *
 * This is deliberately not a markdown library. It handles what a coaching
 * answer contains — headings, bullets, bold runs, paragraphs — and renders
 * anything else as the text it is. No HTML is produced, so nothing here can
 * be injected: the caller maps blocks to elements itself.
 *
 * @returns {Array<{type:'heading'|'bullet'|'paragraph', runs:Array<{text:string,bold:boolean}>}>}
 */
export function parseAnswer(text) {
  const blocks = []
  let para = []

  const flush = () => {
    if (para.length) blocks.push({ type: 'paragraph', runs: runsOf(para.join(' ')) })
    para = []
  }

  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim()
    if (!line) { flush(); continue }

    const heading = line.match(/^#{1,6}\s+(.*)$/)
    if (heading) { flush(); blocks.push({ type: 'heading', runs: runsOf(heading[1].replace(/:\s*$/, '')) }); continue }

    const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/)
    if (bullet) { flush(); blocks.push({ type: 'bullet', runs: runsOf(bullet[1]) }); continue }

    para.push(line)
  }
  flush()
  return blocks
}

/** Split "a **b** c" into runs; unmatched asterisks stay as text. */
export function runsOf(s) {
  const out = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0, m
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), bold: false })
    out.push({ text: m[1], bold: true })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ text: s.slice(last), bold: false })
  return out.length ? out : [{ text: '', bold: false }]
}

/** The same answer as plain text, for a toast or a share sheet. */
export function plainAnswer(text) {
  return parseAnswer(text)
    .map((b) => (b.type === 'bullet' ? '• ' : '') + b.runs.map((r) => r.text).join(''))
    .join('\n')
}
