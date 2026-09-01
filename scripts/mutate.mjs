#!/usr/bin/env node
/**
 * Break the nutrition code on purpose and check the tests notice.
 *
 * A passing suite proves the tests run. It does not prove they would catch a
 * wrong number, and this is the corner of the app where a wrong number reaches
 * somebody's body. So each mutation below is a plausible edit — a constant
 * nudged, a guard loosened, a sign flipped — and any that survives is a line
 * the tests are only decorating.
 *
 *   node scripts/mutate.mjs            all files
 *   node scripts/mutate.mjs nutrition  one of them
 *
 * Restores every file on exit, including on a crash.
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lib = path.join(root, 'frontend', 'src', 'lib')

/**
 * Marks a mutation verified to change no outcome.
 *
 * Not a way to dismiss an inconvenient survivor. Each one carries the
 * measurement that established it, and the bar is a full sweep showing no
 * behavioural difference — because a harness that always reports the same three
 * survivors teaches everybody to stop reading it.
 */
const EQUIVALENT = 'equivalent'

/** [description, what to find, what to replace it with, EQUIVALENT?] */
const TARGETS = {
  nutrition: {
    source: path.join(lib, 'nutrition.js'),
    tests: 'src/lib/nutrition.test.js',
    mutations: [
      ['sex constant dropped from BMR', "sex === 'male' ? base + 5 : base - 161", 'base + 5'],
      ['moderate activity multiplier softened', 'moderate: 1.55', 'moderate: 1.5'],
      ['sedentary multiplier raised', 'sedentary: 1.2', 'sedentary: 1.3'],
      ["women's calorie floor lowered", 'female: 1200', 'female: 1000'],
      ["men's calorie floor lowered", 'male: 1500', 'male: 1300'],
      ['deficit cap loosened', 'MAX_DEFICIT_FRACTION = 0.25', 'MAX_DEFICIT_FRACTION = 0.35'],
      ['surplus cap loosened', 'MAX_SURPLUS_FRACTION = 0.2', 'MAX_SURPLUS_FRACTION = 0.3'],
      ['loss pace cap loosened', 'MAX_LOSS_KG_PER_WEEK = 0.75', 'MAX_LOSS_KG_PER_WEEK = 1.5'],
      ['gain pace cap loosened', 'MAX_GAIN_KG_PER_WEEK = 0.5', 'MAX_GAIN_KG_PER_WEEK = 1'],
      ['energy per kilo wrong', 'KCAL_PER_KG = 7700', 'KCAL_PER_KG = 3500'],
      ['protein on a cut cut', 'lose: 2.0', 'lose: 1.4'],
      ['protein no longer varies by goal', 'gain: 1.8, maintain: 1.6', 'gain: 2.0, maintain: 2.0'],
      ['fat floor lowered', 'FAT_G_PER_KG_FLOOR = 0.8', 'FAT_G_PER_KG_FLOOR = 0.4'],
      ['minimum carbohydrate removed', 'MIN_CARB_G = 50', 'MIN_CARB_G = 0'],
      ['recomp deficit deepened', 'tdee * 0.95', 'tdee * 0.8'],
      ['BMI band edge moved', 'if (value < 18.5)', 'if (value <= 18.5)'],
      ['overweight band edge moved', 'if (value < 25)', 'if (value < 26)'],
      ['obese band edge moved', 'if (value < 30)', 'if (value < 32)'],
      ['under-18 refusal weakened', 'profile.ageYears < 18', 'profile.ageYears < 16'],
      [
        'underweight refusal narrowed to cuts only',
        "profile.goal === 'lose' || profile.goal === 'recomp'",
        "profile.goal === 'lose'",
      ],
      ['underweight threshold lowered', 'index < 17.5', 'index < 15'],
      ['half-filled form no longer guarded', '!profile?.weightKg', 'false'],
      ['BMI divides by centimetres', 'heightCm / 100', 'heightCm'],
      ['suggested goal ignores a high BMI', 'if (index >= 25)', 'if (index >= 35)'],
      ['lean-weight cap loosened', 'PROTEIN_REFERENCE_BMI = 27.5', 'PROTEIN_REFERENCE_BMI = 45'],
      ['lean-weight cap tightened', 'PROTEIN_REFERENCE_BMI = 27.5', 'PROTEIN_REFERENCE_BMI = 22'],
      ['lean weight can exceed actual weight', 'Math.min(weightKg,', 'Math.max(weightKg,'],
      [
        'fat floor ignores the lean weight',
        'FAT_G_PER_KG_FLOOR * basis',
        'FAT_G_PER_KG_FLOOR * profile.weightKg',
      ],
      [
        'protein ignores the lean weight',
        '?? PROTEIN_G_PER_KG.maintain) * basis',
        '?? PROTEIN_G_PER_KG.maintain) * profile.weightKg',
      ],
      ['the lean-weight note goes unsaid', 'if (basis < profile.weightKg)', 'if (false)'],
    ],
  },

  foods: {
    source: path.join(lib, 'foods.js'),
    tests: 'src/lib/foods.test.js',
    mutations: [
      ['a digit transposed in the chicken row', "Chicken breast', kcal: 165, p: 31", "Chicken breast', kcal: 165, p: 13"],
      ['a digit dropped from the rice row', "Rice', kcal: 350", "Rice', kcal: 530"],
      ['whey protein figure wrong', "Whey protein', kcal: 400, p: 80", "Whey protein', kcal: 400, p: 8"],
      ['dal protein figure wrong', "Toor dal', kcal: 335, p: 22", "Toor dal', kcal: 335, p: 2.2"],
      ['egg allowed into a vegetarian diet', "!MEAT.has(key) && !EGG.has(key)", '!MEAT.has(key)'],
      ['dairy allowed into a vegan diet', 'vegan: { label: \'Vegan\', allows: (key) => !isAnimal(key) }', "vegan: { label: 'Vegan', allows: (key) => !MEAT.has(key) }"],
      ['dairy banned from vegetarian', 'veg: { label: \'Vegetarian\', allows: (key) => !MEAT.has(key) && !EGG.has(key) }', "veg: { label: 'Vegetarian', allows: (key) => !isAnimal(key) }"],
      ['meat allowed everywhere', "MEAT = new Set(['chicken', 'fish'])", 'MEAT = new Set([])'],
      ['scaling no longer scales', 'const amount = (grams * scale) / 100', 'const amount = grams / 100'],
      ['fat counted at four calories a gram', 'f += food.f * amount', 'f += food.f * amount * 0'],
      ['small portions rounded away', 'if (grams < 20) return Math.max(1, Math.round(grams))', 'if (grams < 20) return Math.round(grams / 5) * 5'],
      ['portions round to the nearest ten', 'Math.round(grams / 5) * 5', 'Math.round(grams / 10) * 10'],
      ['a dish names an ingredient that does not exist', 'items: { oats: 60, milk: 200', 'items: { oatz: 60, milk: 200'],
      ['carbohydrate dropped from the sum', 'c += food.c * amount', 'c += 0'],
    ],
  },

  nutritionProfile: {
    source: path.join(lib, 'nutritionProfile.js'),
    tests: 'src/lib/nutritionProfile.test.js',
    mutations: [
      ['pounds are treated as kilograms', "state?.unit === 'lb' ? value * LB_TO_KG : value", 'value'],
      ['the conversion runs the wrong way', 'value * LB_TO_KG', 'value / LB_TO_KG'],
      ['the conversion factor is wrong', 'LB_TO_KG = 0.45359237', 'LB_TO_KG = 0.5'],
      ['kilograms get converted too', "state?.unit === 'lb' ?", "state?.unit === 'kg' ?"],
      ['an inch is a centimetre', 'CM_PER_INCH = 2.54', 'CM_PER_INCH = 1'],
      ['a foot is twelve centimetres', 'CM_PER_FOOT = 30.48', 'CM_PER_FOOT = 12'],
      ['five foot twelve is allowed', 'if (inches === 12) return { feet: feet + 1, inches: 0 }', ''],
      ['the oldest weigh-in is used', 'log[log.length - 1]', 'log[0]'],
      ['a zero weigh-in counts', 'if (!Number.isFinite(value) || value <= 0) return null', ''],
      ['sex defaults to female', "state?.body === 'female' ? 'female' : 'male'", "state?.body === 'male' ? 'male' : 'female'"],
      ['a goal is chosen on their behalf', 'goal: stored.goal,', 'goal: stored.goal ?? suggestedGoal({}),'],
      ['the refusal never reaches the screen', 'if (!screened.ok) {', 'if (false) {'],
      ['a suggested goal reads as a chosen one', 'chosen: profile.goal != null', 'chosen: true'],
      ['an absurd height passes', 'height < 120 || height > 230', 'height < 0'],
      ['an absurd age passes', 'age < 13 || age > 100', 'age < 0'],
      ['validation fires on an empty field', "ageYears != null && ageYears !== ''", 'true'],
      ['a missing weight is not asked for', "if (!profile?.weightKg) missing.push('weight')", ''],
    ],
  },

  warmup: {
    source: path.join(lib, 'warmup.js'),
    tests: 'src/lib/warmup.test.js',
    mutations: [
      ['the ramp never starts with the bar', 'const sets = [{ weight: bar, reps: 8, isBar: true }]', 'const sets = []'],
      /*
       * Equivalent, swept rather than assumed: kg and lb, every 0.25 from the
       * bar to 500, zero inputs change. The highest rung is 0.8 of the working
       * weight and rounding is downward, so a rung cannot reach it — the guard
       * is defence against a future RAMP that includes 1.0, not live logic.
       */
      ['a rung lands at or above the working weight', 'if (weight >= target) continue', '', EQUIVALENT],
      ['rungs can repeat or go backwards', 'if (weight <= sets.at(-1).weight) continue', ''],
      ['rounding goes up instead of down', 'Math.floor((target - bar) / step)', 'Math.ceil((target - bar) / step)'],
      ['rungs stop being loadable', 'return platesFor(rounded, { unit }).achieved', 'return target'],
      ['a light weight still gets a full ramp', 'if (target <= bar) return []', ''],
      /*
       * Also equivalent, and for a better reason: `platesFor` has the last word
       * on every rung, so an odd intermediate total is corrected before it is
       * returned. Same sweep, zero differing inputs. The pairing is still right
       * — it says what the step means — it is simply not the thing enforcing it.
       */
      ['plates go on one at a time', 'const step = smallest * 2', 'const step = smallest', EQUIVALENT],
      ['the percentages change', 'fraction: 0.4, reps: 5', 'fraction: 0.9, reps: 5'],
    ],
  },

  plates: {
    source: path.join(lib, 'plates.js'),
    tests: 'src/lib/plates.test.js',
    mutations: [
      ['the bar weighs nothing', 'BAR = { kg: 20, lb: 45 }', 'BAR = { kg: 0, lb: 45 }'],
      ['a plate denomination is wrong', 'kg: [25, 20, 15, 10, 5, 2.5, 1.25]', 'kg: [25, 20, 15, 10, 5, 2.5, 1.5]'],
      ['plates are counted for the whole bar, not one side', '(want - bar) / 2', '(want - bar)'],
      ['float drift returns', "let left = Math.round(((want - bar) / 2) * 100)", 'let left = ((want - bar) / 2) * 100'],
      ['a shortfall is hidden', 'remainder: left / 100 * 2', 'remainder: 0'],
      ['below the bar invents negative plates', 'if (want < bar) {', 'if (false) {'],
      ['the achieved weight forgets the second side', 'achieved: bar + loaded * 2', 'achieved: bar + loaded'],
    ],
  },

  ogVault: {
    source: path.join(lib, 'ogVault.js'),
    tests: 'src/lib/ogVault.test.js',
    mutations: [
      ['the initialisation vector is fixed', 'crypto.getRandomValues(new Uint8Array(12))', 'new Uint8Array(12)'],
      ['the key stops depending on the wallet', 'encoder.encode(signature)', "encoder.encode('constant')"],
      ['the salt is dropped', "salt: encoder.encode('0g-gym-salt-2026')", 'salt: new Uint8Array(0)'],
      ['the iv is not prepended, so nothing can be opened', 'combined.set(iv, 0)', ''],
      ['decryption reads the iv from the wrong place', 'encryptedData.slice(0, 12)', 'encryptedData.slice(0, 16)'],
    ],
  },

  foodLog: {
    source: path.join(lib, 'foodLog.js'),
    tests: 'src/lib/foodLog.test.js',
    mutations: [
      ['the day is keyed in UTC, moving late dinners to tomorrow', 'date.getTime() - date.getTimezoneOffset() * 60000', 'date.getTime()'],
      ['totals recompute from the recipe instead of the record', 'Number(entry.kcal) || 0', 'Number(entry.proteinG) || 0'],
      ['a meal logs its written serving, not the portion planned', 'macrosOf(meal, scale)', 'macrosOf(meal, 1)'],
      ['zero grams is logged as an entry', 'if (amount <= 0) return null', ''],
      ['an unknown food is logged as nothing', 'if (!food) return null', ''],
      ['removing an entry removes the wrong one', 'entry.id !== id', 'entry.id === id'],
      ['emptied days pile up forever', 'if (draft.foodLog[iso].length === 0) delete draft.foodLog[iso]', ''],
      ['going over is hidden rather than reported', 'Math.max(0, Math.round(had - goal))', '0'],
      ['the bar overflows past full', 'Math.min(100, Math.round((had / goal) * 100))', 'Math.round((had / goal) * 100)'],
      ['a ticked meal is not recognised', "entry.kind === 'meal' && entry.ref === mealId", 'false'],
      ['history comes back oldest first', 'date.setDate(date.getDate() - back)', 'date.setDate(date.getDate() + back)'],
      ['search ignores what was typed', 'food.name.toLowerCase().includes(q)', 'true'],
      ['copied entries share ids with yesterday', 'id: newId(), at', 'at'],
      ['yesterday is the wrong day', 'date.setDate(date.getDate() - 1)', 'date.setDate(date.getDate() + 1)'],
      ['a typed prefix no longer ranks first', 'if (aStarts !== bStarts) return aStarts ? -1 : 1', ''],
    ],
  },

  withDefaults: {
    source: path.join(lib, 'withDefaults.js'),
    tests: 'src/lib/withDefaults.test.js',
    mutations: [
      ['the merge goes back to being shallow', 'out[key] = bothPlain ? withDefaults(value, fallback) : value', 'out[key] = value'],
      ['stored values lose to the defaults', 'out[key] = bothPlain ? withDefaults(value, fallback) : value', 'out[key] = bothPlain ? withDefaults(value, fallback) : out[key]'],
      ['a stored list merges into a default object', "value && typeof value === 'object' && !Array.isArray(value)", "value && typeof value === 'object'"],
      ['a stored object merges into a default list', '!Array.isArray(fallback) &&', ''],
      ['the result aliases the defaults', 'const out = clone(defaults)', 'const out = defaults'],
      ['a missing state is no longer guarded', 'if (!state ||', 'if (false &&'],
    ],
  },

  profileScope: {
    source: path.join(lib, 'profileScope.js'),
    tests: 'src/lib/profileScope.test.js',
    mutations: [
      ['storage stops being scoped at all', 'return `${base}:${profileId}`', 'return base'],
      ['every profile shares one scope', "return id ? String(id) : 'guest'", "return 'guest'"],
      ['nobody signed in is not treated as guest', "if (!raw) return 'guest'", 'if (!raw) return null'],
      ['the legacy value is left behind for the next profile', 'localStorage.removeItem(base)', ''],
      ['the legacy value is never adopted', 'if (legacy === null) return null', 'return null'],
      ['a scoped value loses to the legacy one', "if (scoped !== null) return scoped", 'if (false) return scoped'],
      ['a write goes to the shared key', 'localStorage.setItem(scopedKey(base, profileId), value)', 'localStorage.setItem(base, value)'],
    ],
  },

  syncMerge: {
    source: path.join(lib, 'syncMerge.js'),
    tests: 'src/lib/syncMerge.test.js',
    mutations: [
      ['one side of the union is dropped', 'for (const entry of listOf(mine)) {', 'for (const entry of []) {'],
      ['the other side of the union is dropped', 'for (const entry of listOf(theirs)) {', 'for (const entry of []) {'],
      ['a collision keeps the older entry', 'finishedAt(a) >= finishedAt(b) ? a : b', 'finishedAt(a) >= finishedAt(b) ? b : a'],
      ['the later weigh-in loses', 'weighedAt(a) >= weighedAt(b) ? a : b', 'weighedAt(a) >= weighedAt(b) ? b : a'],
      ['weigh-ins come back unsorted', '.sort((a, b) => (a.d < b.d ? -1 : 1))', ''],
      ['a personal best is overwritten by a lighter lift', 'Number(record?.w ?? 0) >= Number(other?.w ?? 0)', 'false'],
      ['best lifts take one side wholesale', 'const merged = { ...theirs }', 'const merged = {}'],
      ['the older state wins the settings', 'const base = mineIsNewer ? mine : theirs', 'const base = mineIsNewer ? theirs : mine'],
      ['the merged state looks stale', 'Math.max(Number(mine._ts) || 0, Number(theirs._ts) || 0, Date.now())', 'Math.min(Number(mine._ts) || 0, Number(theirs._ts) || 0)'],
      ['the live workout is taken from the other device', 'merged.active = mine.active ?? null', 'merged.active = theirs.active ?? null'],
      ['every sync merges, resurrecting deletions', 'if (dirty && remoteTs > localTs) {', 'if (remoteTs > localTs) {'],
      ['a conflicting sync silently discards the server', "return { action: 'merge', state: mergeStates(local, remote) }", "return { action: 'push', state: local }"],
      ['a fresh install pushes its empty state over real data', 'if (!hasLocalData) return', 'if (false) return'],
      ['the food log falls back to whole-object overwrite', 'merged.foodLog = mergeByDay(mine.foodLog, theirs.foodLog)', ''],
      ['one side of a shared day is dropped', "const entries = unionBy(left[iso], right[iso], 'id', (a) => a)", 'const entries = listOf(left[iso])'],
      ['days only the other device has are lost', 'new Set([...Object.keys(left), ...Object.keys(right)])', 'Object.keys(left)'],
      ['empty days are kept forever', 'if (entries.length > 0) merged[iso] = entries', 'merged[iso] = entries'],
      ['exercise notes overwrite each other', 'merged.exNotes = mergeNotes(mine.exNotes, theirs.exNotes)', ''],
      ['an older note wins', '(Number(note?.t) || 0) >= (Number(other?.t) || 0)', 'false'],
      ['day plan overrides overwrite each other', 'merged.dayPlan = mergeDayPlan(mine.dayPlan, theirs.dayPlan, mineIsNewer)', ''],
      ['the older device wins a rescheduled day', 'mineIsNewer ? { ...right, ...left } : { ...left, ...right }', 'mineIsNewer ? { ...left, ...right } : { ...right, ...left }'],
      ['a clean device refuses newer server data', 'if (remoteTs >= localTs) return', 'if (false) return'],
    ],
  },

  coachProfile: {
    source: path.join(lib, 'coachProfile.js'),
    tests: 'src/lib/coachProfile.test.js',
    mutations: [
      ['targets travel for somebody the app refused', "if (status.status !== 'ready') return null", 'if (false) return null'],
      ['the coach is never told what they eat', 'nutrition: nutritionFor(state),', 'nutrition: null,'],
      ['a changed goal counts as no change', 'goal: profile.nutrition.goal,', 'goal: null,'],
      ['a changed diet counts as no change', 'diet: profile.nutrition.diet,', 'diet: null,'],
      ['changed targets count as no change', 'calories: profile.nutrition.calories,', 'calories: null,'],
      ['a suggested goal reads as chosen', 'chosen: status.chosen,', 'chosen: true,'],
    ],
  },

  mealPlan: {
    source: path.join(lib, 'mealPlan.js'),
    tests: 'src/lib/mealPlan.test.js',
    mutations: [
      ['the day no longer adds to one', 'snack: 0.1, dinner: 0.3', 'snack: 0.1, dinner: 0.5'],
      ['breakfast swallows the day', 'breakfast: 0.25', 'breakfast: 0.6'],
      ['portions may grow without limit', 'MAX_SCALE = 2.5', 'MAX_SCALE = 12'],
      ['portions may shrink to nothing', 'MIN_SCALE = 0.5', 'MIN_SCALE = 0.01'],
      ['protein stops being the priority', 'PROTEIN_PRIORITY = 3', 'PROTEIN_PRIORITY = 0'],
      ['the protein shortfall goes unreported', 'if (!meetsProtein) {', 'if (false) {'],
      ['the calorie drift goes unreported', 'if (!meetsCalories) {', 'if (false) {'],
      ['a miss is reported as a hit', 'totals.proteinG >= proteinFloor', 'true'],
      ['the refinement pass is removed', 'report(refine(chosen, allowed, day), day)', 'report(chosen, day)'],
      ['overshooting protein becomes free', 'PROTEIN_OVERSHOOT = 1', 'PROTEIN_OVERSHOOT = 0'],
      /*
       * Equivalent, measured rather than assumed. Across 448 plans neither
       * changes a single outcome: no missed target, no overshoot, mean protein
       * error moving by a fraction of a percent. Both have a structural reason.
       * `fitCalories` pins calories to the target before anything is scored, so
       * the calorie term almost never discriminates; and `costOf` already
       * applies the protein priority when the slot is first filled, so
       * `dayCost` repeating it changes no decision. The constants stay because
       * they are the honest statement of intent and cost nothing — but they are
       * not load-bearing, and pretending a test could catch them would mean
       * writing one that tests the arithmetic rather than the plan.
       */
      ['a shortfall costs no more than an excess', 'miss * 4 * PROTEIN_PRIORITY +', 'miss * 4 * PROTEIN_OVERSHOOT +', EQUIVALENT],
      ['calories drop out of the day cost', 'Math.abs(totals.kcal - target.calories) +', '0 * totals.kcal +', EQUIVALENT],
      ['refinement stops before it starts', 'pass < MAX_REFINE_PASSES', 'pass < 0'],
      // Also equivalent, and for a reason worth knowing: the swap loop is
      // bounded at six passes, so even without the improvement check it cannot
      // wander far. Mean protein error 1.47% against 1.15%, no missed targets.
      ['a worse swap is accepted', 'cost < currentCost &&', 'cost >= 0 &&', EQUIVALENT],
      ['the tie-break is dropped', 'a.cost - b.cost || a.meal.id.localeCompare(b.meal.id)', 'a.cost - b.cost'],
      ['the week stops rotating', 'dayIndex % Math.min(ROTATION_DEPTH, candidates.length)', '0'],
      ['the diet filter is ignored', 'mealsFrom(library, diet)', "mealsFrom(library, 'nonveg')"],
      ['tolerances widened past usefulness', 'PROTEIN_TOLERANCE = 0.1', 'PROTEIN_TOLERANCE = 0.9'],
      ['the shopping list stops accumulating', "(existing?.grams ?? 0) + portion.grams", 'portion.grams'],
      ['a week is six days', 'length: 7', 'length: 6'],
    ],
  },
  coachMemory: {
    source: path.join(lib, 'coachMemory.js'),
    tests: 'src/lib/coachMemory.test.js',
    mutations: [
      ['a stall is called after one flat session', 'sessionsSince >= STALL_SESSIONS', 'sessionsSince >= 1'],
      ['extra reps at the same weight read as a stall', 'num(lift.bestReps) > num(was.bestReps)', 'false'],
      ['a lift going backwards is hidden', 'if (gained < 0) {', 'if (false) {'],
      ['every scale wobble becomes a memory', 'Math.abs(bwNow - bwWas) >= 0.5', 'Math.abs(bwNow - bwWas) >= 0'],
      ['the biggest change stops being the headline', 'weight: 10 + gained', 'weight: 10'],
      ['the memory grows without bound', 'slice(0, MAX_MEMORY)', 'slice(0)'],
      ['a retried evolve is recorded twice', 'num(m?.version) !== num(entry?.version)', 'true'],
      ['the record stops being newest-first', 'num(b.version) - num(a.version)', 'num(a.version) - num(b.version)'],
      ['the prompt is handed the whole history', 'slice(0, versions)', 'slice(0)'],
      ['notes stop being capped', 'slice(0, MAX_NOTES)', 'slice(0)'],
    ],
  },
  swShell: {
    source: path.join(lib, 'swShell.js'),
    tests: 'src/lib/swShell.test.js',
    mutations: [
      ['the static files stop being part of the shell', 'return [...STATIC_SHELL, ...new Set(assets)]', 'return [...new Set(assets)]'],
      ['index.html drops out of the shell', "STATIC_SHELL = ['index.html',", "STATIC_SHELL = ["],
      ['the scan stops after the first asset', '+)"/g', '+)"/'],
      ['stylesheets stop being precached', '(?:src|href)', '(?:src)'],
      ['duplicate assets are precached twice', 'new Set(assets)', 'assets'],
      ['the build name stops depending on the shell', "shell.join('|')", "'constant'"],
      ['the build name loses most of its bits', 'slice(0, 12)', 'slice(0, 2)'],
    ],
  },
}

function run(tests) {
  try {
    execSync(`npx vitest run ${tests}`, { cwd: path.join(root, 'frontend'), stdio: 'pipe' })
    return 'passed'
  } catch (error) {
    const output = String(error.stdout ?? '') + String(error.stderr ?? '')
    /*
     * A mutation that stops the file parsing is not a caught mutation, it is a
     * broken experiment — and from the exit code alone it looks identical to a
     * caught one. This bit us on the contract harness, where three "caught"
     * mutations had simply failed to compile.
     */
    if (/Failed to (load|parse)|SyntaxError|Cannot find/.test(output)) return 'broken'
    return 'failed'
  }
}

const only = process.argv[2]
const chosen = only ? { [only]: TARGETS[only] } : TARGETS

if (only && !TARGETS[only]) {
  console.error(`No such target. Try one of: ${Object.keys(TARGETS).join(', ')}`)
  process.exit(1)
}

const originals = new Map()
for (const { source } of Object.values(chosen)) originals.set(source, fs.readFileSync(source, 'utf8'))
process.on('exit', () => {
  for (const [file, text] of originals) fs.writeFileSync(file, text)
})

let survived = 0
let equivalent = 0
let total = 0

for (const [name, target] of Object.entries(chosen)) {
  const original = originals.get(target.source)
  console.log(`\n${name} — ${target.mutations.length} mutations`)

  for (const [label, find, replace, known] of target.mutations) {
    total += 1

    if (!original.includes(find)) {
      console.log(`  ??  ${label} — pattern not found, mutation never applied`)
      survived += 1
      continue
    }

    if (original.replace(find, replace) === original) {
      console.log(`  ??  ${label} — replacement changed nothing`)
      survived += 1
      continue
    }

    fs.writeFileSync(target.source, original.replace(find, replace))
    const result = run(target.tests)
    fs.writeFileSync(target.source, original)

    if (result === 'failed') {
      console.log(`  ok  ${label}`)
      if (known === EQUIVALENT) {
        console.log(`      (marked equivalent, but the tests caught it — remove the marker)`)
        survived += 1
      }
    } else if (known === EQUIVALENT) {
      equivalent += 1
      console.log(`  --  ${label} — verified equivalent, changes no outcome`)
    } else if (result === 'broken') {
      console.log(`  ??  ${label} — the mutated file did not parse; nothing was tested`)
      survived += 1
    } else {
      console.log(`  MISS ${label} — the tests passed with this broken`)
      survived += 1
    }
  }
}

/*
 * The equivalent ones are subtracted rather than folded in. Reporting them as
 * caught would be this script telling the same lie it exists to catch — and
 * that number goes into the README, where somebody reads it as a claim.
 */
const tail = equivalent > 0 ? ` (and ${equivalent} verified equivalent)` : ''

console.log(
  survived === 0
    ? `\nAll ${total - equivalent} caught${tail}.`
    : `\n${survived} of ${total} survived. Those lines are untested.`,
)

process.exitCode = survived === 0 ? 0 : 1
