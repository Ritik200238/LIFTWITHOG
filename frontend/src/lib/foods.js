/**
 * The food this app can actually plan with.
 *
 * **Where the numbers come from.** Per 100 g of the raw, edible portion, taken
 * from standard food composition tables — IFCT 2017 for the Indian staples and
 * USDA FoodData Central for the generic items — and rounded. They are not
 * invented and they are not precise: the same dal varies by lentil, the same
 * chicken breast by bird, and every table in the world publishes a mean rather
 * than a promise. The UI says so, because a target displayed to the calorie is
 * a claim this data cannot support.
 *
 * **Why meals are built from ingredients.** A table of finished dishes would
 * mean a hundred hand-typed macro rows, each an opportunity for a digit to be
 * wrong in a way nothing could detect. Composing them means every dish's macros
 * are derived, one arithmetic path is under test, and a portion can be scaled
 * to a person's actual target instead of being served as a fixed number.
 *
 * The composition is checked against itself in the tests: protein, fat and
 * carbohydrate at 4/9/4 have to add up to the stated calories for every row
 * here, which is what catches a transposed digit.
 */

/** kcal, protein, fat, carbohydrate — per 100 g. */
export const INGREDIENTS = {
  atta: { name: 'Whole wheat flour', kcal: 340, p: 12, f: 2.5, c: 64 },
  rice: { name: 'Rice', kcal: 350, p: 7.5, f: 0.6, c: 78 },
  poha: { name: 'Poha', kcal: 350, p: 6.6, f: 1.2, c: 77 },
  suji: { name: 'Suji', kcal: 360, p: 12, f: 1, c: 73 },
  oats: { name: 'Oats', kcal: 389, p: 17, f: 7, c: 66 },
  besan: { name: 'Besan', kcal: 387, p: 22, f: 6.7, c: 58 },

  toorDal: { name: 'Toor dal', kcal: 335, p: 22, f: 1.7, c: 57 },
  moong: { name: 'Moong', kcal: 347, p: 24, f: 1.2, c: 59 },
  rajma: { name: 'Rajma', kcal: 335, p: 23, f: 1.3, c: 60 },
  chana: { name: 'Chana', kcal: 360, p: 19, f: 6, c: 61 },
  soya: { name: 'Soya chunks', kcal: 345, p: 52, f: 0.5, c: 33 },

  paneer: { name: 'Paneer', kcal: 265, p: 18, f: 20, c: 3 },
  tofu: { name: 'Tofu', kcal: 76, p: 8, f: 4.8, c: 1.9, vegan: true },
  curd: { name: 'Curd', kcal: 60, p: 3.1, f: 4, c: 3 },
  milk: { name: 'Milk', kcal: 58, p: 3.2, f: 3, c: 4.7 },
  whey: { name: 'Whey protein', kcal: 400, p: 80, f: 6, c: 8 },
  plantProtein: { name: 'Soy or pea protein', kcal: 380, p: 78, f: 4, c: 8 },

  egg: { name: 'Egg', kcal: 143, p: 12.6, f: 9.5, c: 0.7 },
  chicken: { name: 'Chicken breast', kcal: 165, p: 31, f: 3.6, c: 0 },
  fish: { name: 'Fish', kcal: 97, p: 17, f: 3, c: 0 },

  potato: { name: 'Potato', kcal: 77, p: 2, f: 0.1, c: 17 },
  spinach: { name: 'Palak', kcal: 23, p: 2.9, f: 0.4, c: 3.6 },
  mixedVeg: { name: 'Mixed vegetables', kcal: 40, p: 2, f: 0.3, c: 8 },
  banana: { name: 'Banana', kcal: 89, p: 1.1, f: 0.3, c: 23 },
  apple: { name: 'Apple', kcal: 52, p: 0.3, f: 0.2, c: 14 },

  peanuts: { name: 'Peanuts', kcal: 567, p: 26, f: 49, c: 16 },
  almonds: { name: 'Almonds', kcal: 579, p: 21, f: 50, c: 22 },
  peanutButter: { name: 'Peanut butter', kcal: 588, p: 25, f: 50, c: 20 },
  oil: { name: 'Oil', kcal: 900, p: 0, f: 100, c: 0 },
  ghee: { name: 'Ghee', kcal: 900, p: 0, f: 100, c: 0 },
}

/**
 * Which ingredients each diet allows.
 *
 * Stated as what comes from an animal, once, rather than as a flag on every
 * ingredient. The flag version is what this was first, and it was already
 * wrong: the grains and the pulses had not been marked, so vegan resolved to
 * two snacks and nothing else — an option the planner could offer and never
 * fill. A rule with one place to be wrong beats thirty.
 *
 * `veg` is Indian vegetarian — dairy in, egg out. Most apps lump it with vegan
 * and then offer somebody a paneer paratha.
 */
const MEAT = new Set(['chicken', 'fish'])
const EGG = new Set(['egg'])
const DAIRY = new Set(['paneer', 'curd', 'milk', 'whey', 'ghee'])

const isAnimal = (key) => MEAT.has(key) || EGG.has(key) || DAIRY.has(key)

export const DIETS = {
  vegan: { label: 'Vegan', allows: (key) => !isAnimal(key) },
  veg: { label: 'Vegetarian', allows: (key) => !MEAT.has(key) && !EGG.has(key) },
  egg: { label: 'Vegetarian + egg', allows: (key) => !MEAT.has(key) },
  nonveg: { label: 'Anything', allows: () => true },
}

/**
 * The dishes.
 *
 * `grams` is one ordinary serving of each component, not a target — the planner
 * scales the whole dish to fit the person it is planning for. Written the way
 * somebody would describe the meal to a friend, because a plan somebody cannot
 * picture is a plan they do not cook.
 */
export const MEALS = [
  // ---------------------------------------------------------------- breakfast
  {
    id: 'oats-milk-banana',
    name: 'Oats with milk, banana and peanuts',
    slot: 'breakfast',
    items: { oats: 60, milk: 200, banana: 100, peanuts: 15 },
  },
  {
    id: 'poha',
    name: 'Poha with peanuts',
    slot: 'breakfast',
    items: { poha: 70, potato: 50, peanuts: 15, oil: 5 },
  },
  {
    id: 'besan-chilla',
    name: 'Besan chilla with palak',
    slot: 'breakfast',
    items: { besan: 60, spinach: 40, oil: 6 },
  },
  {
    id: 'upma',
    name: 'Upma with vegetables',
    slot: 'breakfast',
    items: { suji: 70, mixedVeg: 80, peanuts: 10, oil: 6 },
  },
  {
    id: 'paneer-paratha',
    name: 'Paneer paratha with curd',
    slot: 'breakfast',
    items: { atta: 60, paneer: 60, curd: 100, ghee: 5 },
  },
  {
    id: 'egg-bhurji-roti',
    name: 'Egg bhurji with roti',
    slot: 'breakfast',
    items: { egg: 150, atta: 40, oil: 5 },
  },
  {
    id: 'oats-whey',
    name: 'Masala oats with a scoop of whey',
    slot: 'breakfast',
    items: { oats: 50, whey: 30, milk: 150 },
  },
  {
    id: 'tofu-bhurji-roti',
    name: 'Tofu bhurji with roti',
    slot: 'breakfast',
    items: { tofu: 250, atta: 30, oil: 5 },
  },

  // -------------------------------------------------------------------- lunch
  {
    id: 'dal-chawal',
    name: 'Dal, rice and a vegetable',
    slot: 'lunch',
    items: { toorDal: 60, rice: 80, mixedVeg: 100, oil: 8 },
  },
  {
    id: 'rajma-chawal',
    name: 'Rajma chawal',
    slot: 'lunch',
    items: { rajma: 70, rice: 80, oil: 8 },
  },
  {
    id: 'chana-roti',
    name: 'Chana masala with roti',
    slot: 'lunch',
    items: { chana: 70, atta: 80, oil: 8 },
  },
  {
    id: 'chicken-rice',
    name: 'Chicken curry with rice',
    slot: 'lunch',
    items: { chicken: 150, rice: 80, oil: 10 },
  },
  {
    id: 'fish-rice',
    name: 'Fish curry with rice',
    slot: 'lunch',
    items: { fish: 150, rice: 80, oil: 8 },
  },
  {
    id: 'paneer-bhurji-roti',
    name: 'Paneer bhurji with roti',
    slot: 'lunch',
    items: { paneer: 100, atta: 60, oil: 6 },
  },
  {
    id: 'soya-rice',
    name: 'Soya chunk curry with rice',
    slot: 'lunch',
    items: { soya: 40, rice: 80, mixedVeg: 60, oil: 8 },
  },
  {
    id: 'soya-dal-roti',
    name: 'Soya and dal with roti',
    slot: 'lunch',
    items: { soya: 55, toorDal: 40, atta: 50, oil: 6 },
  },

  // ------------------------------------------------------------------- dinner
  {
    id: 'roti-dal-palak',
    name: 'Roti, dal and palak',
    slot: 'dinner',
    items: { atta: 60, toorDal: 50, spinach: 100, oil: 6 },
  },
  {
    id: 'grilled-chicken-roti',
    name: 'Grilled chicken with roti and salad',
    slot: 'dinner',
    items: { chicken: 180, atta: 40, mixedVeg: 80, oil: 6 },
  },
  {
    id: 'paneer-tikka',
    name: 'Paneer tikka with salad',
    slot: 'dinner',
    items: { paneer: 120, mixedVeg: 120, oil: 5 },
  },
  {
    id: 'egg-curry-rice',
    name: 'Egg curry with rice',
    slot: 'dinner',
    items: { egg: 150, rice: 70, oil: 8 },
  },
  {
    id: 'khichdi',
    name: 'Khichdi with curd',
    slot: 'dinner',
    items: { rice: 60, moong: 40, curd: 150, ghee: 8 },
  },
  {
    id: 'tofu-rice',
    name: 'Tofu stir fry with rice',
    slot: 'dinner',
    items: { tofu: 200, rice: 60, mixedVeg: 80, oil: 8 },
  },
  {
    id: 'soya-bhurji',
    name: 'Soya bhurji with salad',
    slot: 'dinner',
    items: { soya: 60, mixedVeg: 100, oil: 6 },
  },

  // -------------------------------------------------------------------- snack
  {
    id: 'curd-peanuts',
    name: 'Curd with peanuts',
    slot: 'snack',
    items: { curd: 200, peanuts: 20 },
  },
  {
    id: 'whey-shake',
    name: 'Whey shake with milk',
    slot: 'snack',
    items: { whey: 30, milk: 250 },
  },
  {
    id: 'plant-shake',
    name: 'Plant protein shake with banana',
    slot: 'snack',
    items: { plantProtein: 30, banana: 80 },
  },
  {
    id: 'sprouts',
    name: 'Moong sprouts chaat',
    slot: 'snack',
    items: { moong: 50, mixedVeg: 50 },
  },
  {
    id: 'banana-pb',
    name: 'Banana with peanut butter',
    slot: 'snack',
    items: { banana: 120, peanutButter: 25 },
  },
  {
    id: 'boiled-eggs',
    name: 'Boiled eggs',
    slot: 'snack',
    items: { egg: 150 },
  },
  {
    id: 'roasted-chana',
    name: 'Roasted chana',
    slot: 'snack',
    items: { chana: 50 },
  },
  {
    id: 'apple-almonds',
    name: 'Apple with almonds',
    slot: 'snack',
    items: { apple: 150, almonds: 20 },
  },
]

/** What a dish comes to, at whatever portion of it is being served. */
export function macrosOf(meal, scale = 1) {
  let kcal = 0
  let p = 0
  let f = 0
  let c = 0

  for (const [key, grams] of Object.entries(meal.items)) {
    const food = INGREDIENTS[key]
    if (!food) continue

    const amount = (grams * scale) / 100
    kcal += food.kcal * amount
    p += food.p * amount
    f += food.f * amount
    c += food.c * amount
  }

  return { kcal, proteinG: p, fatG: f, carbG: c }
}

/** The components, at the portion actually being served, for the shopping list. */
export function portionsOf(meal, scale = 1) {
  return Object.entries(meal.items).map(([key, grams]) => ({
    key,
    name: INGREDIENTS[key]?.name ?? key,
    grams: roundGrams(grams * scale),
  }))
}

/**
 * Grams, rounded to something somebody can actually measure.
 *
 * Nobody weighs 63.4 g of dal. Below 20 g — the oils and the nuts — five grams
 * is still a meaningful difference, so those keep a finer step.
 */
export function roundGrams(grams) {
  if (grams < 20) return Math.max(1, Math.round(grams))
  return Math.round(grams / 5) * 5
}

/**
 * The dishes in a given list that a given diet permits.
 *
 * Takes the list rather than reaching for `MEALS`, so the order it is given in
 * is the order that comes back. The planner's tie-breaking depends on that, and
 * a filter that quietly re-sorted from the module's own array made the planner
 * look order-independent in a test while remaining order-dependent in fact.
 */
export function mealsFrom(library, diet) {
  const allows = (DIETS[diet] ?? DIETS.nonveg).allows
  return library.filter((meal) => Object.keys(meal.items).every(allows))
}

export function mealsFor(diet) {
  return mealsFrom(MEALS, diet)
}
