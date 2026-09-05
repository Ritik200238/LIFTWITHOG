import { describe, it, expect } from 'vitest'
import { parseAnswer, runsOf, plainAnswer } from './markdownLite.js'

/*
 * Written from a real answer coach #24 gave on 2026-09-05, which the sheet drew
 * as "### Main Workout: #### Bench Press: - **Warm-up Set:** 3 sets" — one
 * centred paragraph, markup and all, on the screen meant to show off 0G Compute.
 */
const REAL = `However, based on general principles for push day workouts, here's a suggested routine:
### Warm-Up:
- **Dynamic Stretching:** 5 minutes of dynamic stretches focusing on major muscle groups.
- **Mobility Drills:** 5 minutes of mobility drills targeting shoulders, chest, and back.
### Main Workout:
#### Bench Press:
- **Warm-up Set:** 3 sets of 10 reps with an empty barbell.
- **Work Sets:**
1. **Set 1:** 3 sets of 8 reps with 90% of your estimated 1RM.`

describe('the coach answer, as blocks', () => {
  it('turns headings, bullets and bold into structure, with no markup left', () => {
    const blocks = parseAnswer(REAL)
    const text = blocks.flatMap((b) => b.runs.map((r) => r.text)).join(' ')
    expect(text).not.toMatch(/[#*]/)
    expect(blocks.filter((b) => b.type === 'heading').map((b) => b.runs[0].text)).toEqual(['Warm-Up', 'Main Workout', 'Bench Press'])
    expect(blocks.filter((b) => b.type === 'bullet')).toHaveLength(5)
  })

  it('keeps the bold run bold and the rest not', () => {
    expect(runsOf('**Warm-up Set:** 3 sets')).toEqual([
      { text: 'Warm-up Set:', bold: true },
      { text: ' 3 sets', bold: false },
    ])
  })

  it('leaves an unmatched asterisk alone rather than eating text', () => {
    expect(runsOf('5 x 5 ** heavy')).toEqual([{ text: '5 x 5 ** heavy', bold: false }])
  })

  it('joins a wrapped paragraph and splits on blank lines', () => {
    const blocks = parseAnswer('one\ntwo\n\nthree')
    expect(blocks.map((b) => b.runs[0].text)).toEqual(['one two', 'three'])
  })

  it('renders numbered lists as bullets too', () => {
    expect(parseAnswer('1. first\n2) second').every((b) => b.type === 'bullet')).toBe(true)
  })

  it('never throws on nothing', () => {
    expect(parseAnswer('')).toEqual([])
    expect(parseAnswer(null)).toEqual([])
    expect(plainAnswer(undefined)).toBe('')
  })

  it('produces text a toast can show', () => {
    expect(plainAnswer('### A\n- **b** c')).toBe('A\n• b c')
  })
})
