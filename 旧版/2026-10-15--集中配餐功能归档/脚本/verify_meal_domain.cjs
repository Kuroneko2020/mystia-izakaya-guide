/* Node built-ins only. Load the WHOLE pure module inside the build-style IIFE.
 * Default: stdout. --out-dir creates a report exclusively, never replaces one.
 * Python oracle: py -B export_meal_domain.py --oracle --out-dir <new evidence dir>
 */
'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = __dirname.replace(/[\\/]脚本$/, '');
const resolve = value => /^(?:[A-Za-z]:[\\/]|[\\/])/.test(value) ? value : `${root}/${value}`;
const args = process.argv.slice(2);
const options = {};
for (let index = 0; index < args.length; index++) {
  const key = args[index];
  if (!['--out-dir', '--oracle'].includes(key) || index + 1 === args.length) throw new Error(`Unknown or incomplete option ${key}`);
  options[key] = resolve(args[++index]);
}
const sourcePath = `${root}/脚本/ryotei_meal_domain.js`;
const dataPath = `${root}/中间数据/MEAL_DOMAIN_DATA.json`;
const source = fs.readFileSync(sourcePath, 'utf8');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const hash = content => crypto.createHash('sha256').update(content).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const context = vm.createContext({});
const api = new vm.Script(`(() => {\n${source}\nreturn RyoteiMealDomain;\n})()`, { filename: sourcePath }).runInContext(context);
const catalog = api.createCatalog(data);
const groups = [];
let assertions = 0;
const equal = (actual, expected, message) => { assert.deepEqual(plain(actual), plain(expected), message); assertions++; };
const ok = (value, message) => { assert.ok(value, message); assertions++; };
const throws = (fn, pattern) => { assert.throws(fn, pattern); assertions++; };
const group = (name, fn) => {
  const before = assertions;
  fn();
  groups.push({ name, status: 'PASS', assertions: assertions - before });
};
const byName = (rows, name) => [...rows.values()].find(row => row.name === name || row.displayName === name);
const ctx = key => ({ guestKey: key });
const reimu = byName(catalog.guests, '博丽灵梦');
const keine = byName(catalog.guests, '上白泽慧音');
const fourteen = byName(catalog.beverages, '十四夜');
const peach = byName(catalog.ingredients, '桃子');
const chocolate = byName(catalog.ingredients, '可可豆');
const tea = byName(catalog.beverages, '绿茶');
const dragonsPeach = byName(catalog.foods, '龙吟桃子');
const wellington = byName(catalog.foods, '惠灵顿牛排');
const smallFour = byName(catalog.foods, '三文鱼天妇罗');
const foodTag = label => Number(Object.entries(catalog.tagMaps.food).find(([, value]) => value === label)[0]);
const bevTag = label => Number(Object.entries(catalog.tagMaps.beverage).find(([, value]) => value === label)[0]);
const meal = (draft, key = reimu.key) => api.evaluateMeal(catalog, draft, ctx(key));
const paidTea = meal({ beverageId: tea.id });
let oracleCounts = null;

group('Whole IIFE module, machine source provenance and independent catalog', () => {
  equal(Object.keys(api).sort(), ['version', 'createCatalog', 'sanitizeDraft', 'evaluateMeal', 'composeMeal', 'compose',
    'suggestAddons', 'aggregatePreparation', 'createSession', 'makeSession', 'newSession', 'sanitizeSession',
    'recordConsumption', 'record', 'undoConsumption', 'undo', 'setActualSnapshot', 'snapshot', 'budgetFacts'].sort());
  for (const globalName of ['window', 'document', 'state', 'localStorage']) {
    ok(!new RegExp(`\\b${globalName}\\b`).test(source), `Forbidden UI dependency ${globalName}`);
  }
  equal(data.rules, JSON.parse(fs.readFileSync(`${root}/中间数据/GAME_TAG_RULES.json`, 'utf8')), 'Rules not recopied by hand');
  equal(data.provenance.counts, { foods: 164, cookableFoods: 163, recipes: 163, ingredients: 62, beverages: 46, guests: 106, maps: 16 });
  equal(catalog.rules.foodCoverPairs.length, 7);
  const original = JSON.parse(fs.readFileSync(`${root}/验证记录/2026-10-13--全量数据核查/游戏原始核验/game_catalog_raw_normalized.json`, 'utf8'));
  equal(data.recipes.map(recipe => ({ id: recipe.id, foodID: recipe.foodId,
    ingredients: recipe.baseIngredients, cookerType: recipe.cookerType })).sort((a, b) => a.id - b.id),
  original.recipes.map(recipe => ({ id: recipe.id, foodID: recipe.foodID,
    ingredients: recipe.ingredients, cookerType: recipe.cookerType })).sort((a, b) => a.id - b.id));
  equal(catalog.tagMaps.food, original.idNameMaps.foodTag);
  equal(catalog.tagMaps.beverage, original.idNameMaps.beverageTag);
  for (const row of data.provenance.sources) equal(hash(fs.readFileSync(resolve(row.path))), row.sha256, row.path);
  equal(plain(data.foods.find(food => food.id === wellington.id)).rawTags,
    plain(original.entries.find(food => food.type === 'food' && food.id === wellington.id)).rawTags);
  const originalJSON = JSON.stringify(data);
  const before = JSON.stringify(catalog.data);
  api.evaluateMeal(catalog, { foodId: wellington.id });
  equal(JSON.stringify(data), originalJSON);
  equal(JSON.stringify(catalog.data), before, 'Pure evaluator must not mutate catalog');
  throws(() => api.createCatalog({ ...data, recipes: [data.recipes[0], data.recipes[0]] }), /Duplicate/);
});

group('Recipe != food ID, duplicate base and extra slots, full capacity', () => {
  const selected = meal({ foodId: wellington.id });
  equal(selected.recipe.id, 58);
  equal(selected.food.id, 43);
  ok(selected.recipe.id !== selected.food.id);
  equal(meal({ recipeId: 58 }).food.id, 43);
  ok(meal({ recipeId: 43, foodId: 43 }).errors.some(error => error.code === 'RECIPE_FOOD_MISMATCH'));
  const dragon = meal({ foodId: dragonsPeach.id });
  equal(dragon.recipe.baseIngredients, [chocolate.id, peach.id, peach.id, peach.id, peach.id]);
  equal(dragon.slots.used, 5);
  equal(dragon.slots.free, 0);
  ok(dragon.tags.food.includes(foodTag('大份')));
  equal(api.suggestAddons(catalog, dragon.draft, ctx(keine.key)).suggestions.length, 0);
  const overflow = meal({ foodId: dragonsPeach.id, extras: [peach.id] });
  ok(overflow.errors.some(error => error.code === 'SLOT_OVERFLOW'));
  ok(!overflow.canRecord);
  const simple = [...catalog.recipes.values()].find(recipe => recipe.baseIngredients.length === 1 &&
    !catalog.getFood(recipe.foodId).banTags.some(tag => peach.rawTags.includes(tag)));
  const repeated = meal({ recipeId: simple.id, extras: [peach.id, peach.id, peach.id, peach.id] });
  equal(repeated.extras.length, 4);
  equal(repeated.slots.used, 5);
  equal(repeated.draft.extras, [peach.id, peach.id, peach.id, peach.id]);
  ok(repeated.tags.food.includes(foodTag('大份')));
  ok(meal({ recipeId: simple.id, extras: Array(5).fill(peach.id) }).errors.some(error => error.code === 'SLOT_OVERFLOW'));
});

group('Four ingredients + one derives large, removes small and adds Keine hate', () => {
  const base = meal({ foodId: smallFour.id }, keine.key);
  const added = meal({ foodId: smallFour.id, extras: [peach.id] }, keine.key);
  equal(base.slots.used, 4);
  ok(base.tags.food.includes(foodTag('小巧')));
  equal(added.slots.used, 5);
  ok(added.tags.food.includes(foodTag('大份')));
  ok(!added.tags.food.includes(foodTag('小巧')));
  ok(added.dislikes.food.includes(foodTag('大份')));
  ok(added.changes.some(change => change.type === 'covered' && change.tagId === foodTag('小巧')));
  const suggestions = api.suggestAddons(catalog, base.draft, ctx(keine.key));
  equal(suggestions.suggestions.length, 0, 'No added ingredient can evade derived large-portion hate');
  ok(suggestions.excluded.some(candidate => candidate.addedHates?.includes(foodTag('大份'))));
});

group('Water product overrides vegetarian; raw bans checked before covers', () => {
  const warmRice = byName(catalog.foods, '温暖饭团');
  const result = meal({ foodId: warmRice.id });
  ok(warmRice.rawTags.includes(foodTag('素')));
  ok(result.tags.food.includes(foodTag('水产')));
  ok(!result.tags.food.includes(foodTag('素')));
  const conflictRecipe = [...catalog.recipes.values()].find(recipe => recipe.baseIngredients.length < 5 &&
    catalog.getFood(recipe.foodId).banTags.some(tag => peach.rawTags.includes(tag)));
  const dark = meal({ recipeId: conflictRecipe.id, extras: [peach.id] });
  ok(dark.conflicts.length > 0);
  ok(dark.isDarkMatter);
  equal(dark.tags.food, [catalog.specialIds.darkMatterTag]);
  equal(dark.requests.food.status, 'unknown');
  throws(() => api.recordConsumption(api.createSession(), dark), /INVALID_MEAL/);
});

group('Price tags strict at 20/60, override 0/61, independent ingredient cost', () => {
  const selectedFood = [...catalog.foods.values()].find(food => food.cookable &&
    !food.rawTags.includes(foodTag('实惠')) && !food.rawTags.includes(foodTag('昂贵')));
  for (const price of [20, 60]) {
    const result = meal({ foodId: selectedFood.id, beverageId: tea.id, foodPrice: price, bevPrice: price });
    ok(!result.tags.food.includes(foodTag('昂贵')) && !result.tags.food.includes(foodTag('实惠')));
    ok(!result.tags.beverage.includes(bevTag('昂贵')) && !result.tags.beverage.includes(bevTag('便宜')));
    equal(result.price.total, price * 2);
  }
  const zero = meal({ foodId: selectedFood.id, beverageId: tea.id, foodPrice: 0, beveragePrice: 0 });
  ok(zero.tags.food.includes(foodTag('实惠')));
  ok(zero.tags.beverage.includes(bevTag('便宜')));
  equal(zero.price.total, 0);
  equal(zero.price.foodSource, 'override');
  const sixtyOne = meal({ foodId: selectedFood.id, beverageId: tea.id, foodPrice: 61, bevPrice: 61 });
  ok(sixtyOne.tags.food.includes(foodTag('昂贵')));
  ok(sixtyOne.tags.beverage.includes(bevTag('昂贵')));
  equal(sixtyOne.price.total, 122);
  equal(sixtyOne.price.ingredientCost, sixtyOne.recipe.baseIngredients.reduce((sum, id) => sum + catalog.getIngredient(id).price, 0));
  const withExtra = meal({ foodId: smallFour.id, beverageId: tea.id, extras: [peach.id], foodPrice: 61, bevPrice: 61 });
  equal(withExtra.price.total, 122);
  ok(withExtra.price.ingredientCost > meal({ foodId: smallFour.id }).price.ingredientCost);
  const free = meal({ beverageId: tea.id, free: true });
  equal(free.price.total, tea.price);
  equal(free.price.chargedTotal, 0);
});

group('Request categories, nullable unknown and uncounted machine trend attitude', () => {
  const result = meal({ foodId: smallFour.id, beverageId: tea.id, foodRequest: smallFour.rawTags[0], beverageRequest: bevTag('无酒精') });
  equal(result.requests.food.status, result.tags.food.includes(smallFour.rawTags[0]) ? 'satisfied' : 'missing');
  equal(result.requests.beverage.status, 'satisfied');
  equal(meal({ beverageId: tea.id, beverageRequest: bevTag('高酒精') }).requests.beverage.status, 'missing');
  equal(meal({ beverageId: tea.id }).requests.beverage.status, 'unknown');
  const missingCategory = meal({ beverageId: tea.id, foodRequest: foodTag('素') });
  equal(missingCategory.requests.food.status, 'unknown');
  const base = meal({ foodId: smallFour.id }, keine.key);
  const withTrend = meal({ foodId: smallFour.id, dailyTrend: { tagId: foodTag('小巧'), isNegative: false } }, keine.key);
  equal(withTrend.tags, base.tags);
  equal(withTrend.hits, base.hits);
  equal(withTrend.trend.status, 'not-counted');
  ok(withTrend.trend.attitude.rawReaction);
  equal(meal({ foodId: smallFour.id, foodRequest: catalog.dynamicTagIds.popularPositive }).requests.food.status, 'unknown');
  const ordinary = [...catalog.guests.values()].find(guest => guest.kind === 'normal');
  equal(meal({ foodId: smallFour.id }, ordinary.key).knowledge.foodHates, 'unknown');
  const wildcard = [...catalog.guests.values()].find(guest => guest.isLikeAllFoodTags);
  ok(wildcard);
  equal(meal({ foodId: smallFour.id }, wildcard.key).likes.food, base.tags.food);
});

group('Sanitize external input, unknown versus zero and malformed drafts', () => {
  const valid = api.sanitizeDraft(catalog, { foodId: `${smallFour.id}`, beverageId: '0', extras: [`${peach.id}`],
    foodPrice: '0', bevPrice: ' 20 ', foodRequest: '', beverageRequest: null });
  equal(valid.errors, []);
  equal(valid.draft.foodPrice, 0);
  equal(valid.draft.beveragePrice, 20);
  equal(valid.draft.beverageId, 0);
  equal(valid.draft.foodRequest, null);
  for (const invalid of [true, Infinity, NaN, '-1', 'abc', '0x10']) {
    ok(api.sanitizeDraft(catalog, { foodId: smallFour.id, foodPrice: invalid }).errors.length > 0);
  }
  ok(api.sanitizeDraft(catalog, { beverageId: true }).errors.length > 0);
  ok(api.sanitizeDraft(catalog, { extras: 'bad' }).errors.length > 0);
  ok(api.sanitizeDraft(catalog, { extras: [null, ''], foodId: smallFour.id }).errors.length > 0);
  ok(api.sanitizeDraft(catalog, { foodId: Number.MAX_SAFE_INTEGER }).errors.length > 0);
  ok(api.sanitizeDraft(catalog, { foodPrice: 1, beveragePrice: 1, bevPrice: 2 }).errors.length > 0);
  const empty = meal({});
  equal(empty.price.total, null);
  ok(!empty.canRecord);
  const badPrice = meal({ beverageId: tea.id, bevPrice: 'bad' });
  equal(badPrice.price.total, null);
  ok(!badPrice.canRecord);
  throws(() => api.recordConsumption(api.createSession(), badPrice), /INVALID_MEAL/);
  const overflowPrice = meal({ foodId: smallFour.id, beverageId: tea.id,
    foodPrice: Number.MAX_VALUE, beveragePrice: Number.MAX_VALUE });
  equal(overflowPrice.price.total, null);
  ok(!overflowPrice.canRecord);
  ok(overflowPrice.errors.some(error => error.code === 'PRICE_OVERFLOW'));
  const hugePrice = meal({ beverageId: tea.id, beveragePrice: Number.MAX_VALUE });
  const hugeReceipt = api.recordConsumption(api.createSession(), hugePrice);
  throws(() => api.recordConsumption(hugeReceipt, hugePrice), /LEDGER_OVERFLOW/);
  const hugeBalance = api.budgetFacts(reimu, api.createSession({ actualBalance: -Number.MAX_VALUE }), hugePrice);
  equal(hugeBalance.after, null);
  ok(hugeBalance.warnings.includes('BALANCE_OVERFLOW'));
});

group('Budget unknown/range/actual, strict bounds, optional expensive selection', () => {
  const expensive = meal({ beverageId: fourteen.id }, reimu.key);
  equal(expensive.price.total, 440);
  ok(expensive.canRecord && expensive.likes.beverage.length > 0);
  const start = api.createSession({ guestKey: reimu.key });
  equal(api.budgetFacts(reimu, start, expensive).mode, 'unknown');
  equal(api.budgetFacts(reimu, start, expensive).remaining, null);
  const rangeSession = api.createSession({ guestKey: reimu.key, priorSpend: 0, priorConfirmed: true, ledgerComplete: true });
  const facts = api.budgetFacts(reimu, rangeSession, expensive);
  equal(facts.mode, 'range');
  equal(facts.remaining, { min: 150, max: 300 });
  equal(facts.after, { min: -290, max: -140 });
  equal(facts.risk, 'over-upper');
  ok(facts.canServe && !facts.hardFilter);
  equal(api.budgetFacts(reimu, { ...rangeSession, ledgerComplete: false }, expensive).mode, 'unknown');
  equal(api.budgetFacts(reimu, { ...rangeSession, priorSpend: 1 }, expensive).mode, 'unknown');
  equal(api.budgetFacts(reimu, { ...rangeSession, priorSpend: null }, expensive).mode, 'unknown');
  for (const [price, risk] of [[150, 'within-lower'], [151, 'within-range'], [300, 'within-range'], [301, 'over-upper']]) {
    equal(api.budgetFacts([150, 300], rangeSession, meal({ beverageId: tea.id, beveragePrice: price })).risk, risk);
  }
  const ordinary = [...catalog.guests.values()].find(guest => guest.kind === 'normal');
  equal(ordinary.budgetRange, null);
  equal(api.budgetFacts(ordinary, api.createSession({ priorSpend: 0, priorConfirmed: true, ledgerComplete: true }), expensive).mode, 'unknown');
  const zero = api.createSession({ guestKey: reimu.key, actualBalance: 0 });
  equal(api.budgetFacts(reimu, zero, paidTea).mode, 'actual');
  equal(api.budgetFacts(reimu, zero, paidTea).remaining, { min: 0, max: 0 });
  equal(api.budgetFacts(reimu, zero, paidTea).after, { min: -1, max: -1 });
  equal(api.budgetFacts(reimu, api.createSession({ actualBalance: '' }), paidTea).mode, 'unknown');
  equal(api.budgetFacts(reimu, api.createSession({ actualBalance: -20 }), paidTea).remaining, { min: -20, max: -20 });
  equal(api.budgetFacts(keine, zero, paidTea).mode, 'unknown', 'A different customer must not inherit a wallet');
});

group('Snapshot anchors receipts, no double deduction, save/free/undo/new session', () => {
  const original = api.createSession({ guestKey: reimu.key, priorSpend: 0, priorConfirmed: true, ledgerComplete: true });
  const savedDraft = plain(paidTea.draft); // Pure data save has no accounting effect.
  ok(savedDraft);
  equal(original.ledger.length, 0);
  let recorded = api.recordConsumption(original, paidTea);
  equal(original.ledger.length, 0, 'Recording must not mutate an older session');
  equal(recorded.ledger.length, 1);
  recorded = api.recordConsumption(recorded, meal({ beverageId: tea.id, beveragePrice: 20 }));
  const snapshot = api.setActualSnapshot(recorded, 100);
  equal(snapshot.actualSnapshot.ledgerCount, 2);
  equal(snapshot.actualSnapshot.ledgerSpend, 21);
  equal(api.budgetFacts(reimu, snapshot, paidTea).remaining, { min: 100, max: 100 });
  const consumed = api.recordConsumption(snapshot, paidTea);
  equal(api.budgetFacts(reimu, consumed, paidTea).remaining, { min: 99, max: 99 });
  const free = api.recordConsumption(consumed, meal({ beverageId: fourteen.id, free: true }));
  equal(api.budgetFacts(reimu, free, paidTea).remaining, { min: 99, max: 99 });
  equal(api.budgetFacts(reimu, free, paidTea).recordedSpend, 22);
  equal(api.budgetFacts(reimu, api.undoConsumption(free), paidTea).remaining, { min: 99, max: 99 });
  const undoPaid = api.undoConsumption(api.undoConsumption(free));
  equal(api.budgetFacts(reimu, undoPaid, paidTea).remaining, { min: 100, max: 100 });
  const undoBeforeAnchor = api.undoConsumption(undoPaid);
  equal(api.budgetFacts(reimu, undoBeforeAnchor, paidTea).mode, 'unknown');
  ok(api.budgetFacts(reimu, undoBeforeAnchor, paidTea).warnings.includes('SNAPSHOT_INVALIDATED_BY_UNDO'));
  equal(api.budgetFacts(reimu, api.setActualSnapshot(consumed, null), paidTea).mode, 'range');
  equal(api.budgetFacts(reimu, { ...snapshot, actualSnapshot: null, priorConfirmed: false, ledgerComplete: false }, paidTea).mode, 'unknown');
  const corrupted = plain(consumed);
  corrupted.ledger[0].chargedTotal += 10;
  equal(api.budgetFacts(reimu, corrupted, paidTea).mode, 'unknown');
  throws(() => api.recordConsumption(corrupted, paidTea), /INVALID_SESSION/);
  const remapped = plain(consumed);
  remapped.ledger[0].id = 'r999';
  equal(api.budgetFacts(reimu, remapped, paidTea).mode, 'unknown');
  const restored = api.sanitizeSession(plain(consumed));
  equal(restored.errors, []);
  equal(api.budgetFacts(reimu, restored.session, paidTea).remaining, { min: 99, max: 99 });
  const next = api.newSession({ guestKey: reimu.key });
  equal(next.ledger.length, 0);
  equal(next.actualSnapshot, null);
  equal(api.budgetFacts(reimu, next, paidTea).mode, 'unknown');
  equal(api.budgetFacts(reimu, api.recordConsumption(api.createSession({ actualBalance: 0 }), paidTea), paidTea).remaining, { min: -1, max: -1 });
});

group('Preparation material quantities include duplicate slots and extras', () => {
  const result = api.aggregatePreparation(catalog,
    [{ draft: { foodId: dragonsPeach.id, beverageId: tea.id }, quantity: 2 },
      { draft: { foodId: smallFour.id, extras: [peach.id] }, quantity: 3 }], { guestKeys: [keine.key, reimu.key] });
  equal(result.errors, []);
  equal(result.materials.find(row => row.id === peach.id).quantity, 11);
  equal(result.materials.find(row => row.id === peach.id).baseQuantity, 8);
  equal(result.materials.find(row => row.id === peach.id).extraQuantity, 3);
  equal(result.materials.find(row => row.id === chocolate.id).quantity, 2);
  equal(result.beverages[0].quantity, 2);
  equal(result.coverage.totalGuestCount, 2);
  equal(result.coverage.guests.find(guest => guest.key === keine.key).foodMeals.length, 0);
  equal(result.price.total, 2 * (dragonsPeach.price + tea.price) + 3 * smallFour.price);
  ok(api.aggregatePreparation(catalog, [{ draft: { foodId: smallFour.id }, quantity: 0 }]).errors.length > 0);
});

if (options['--oracle']) {
  group('Python synthesis crosscheck: 209 defaults and every addon/repetition/price boundary', () => {
    const oracle = JSON.parse(fs.readFileSync(options['--oracle'], 'utf8'));
    equal(oracle.catalogFingerprint, hash(fs.readFileSync(dataPath)), 'Oracle uses the same raw machine catalog');
    equal(oracle.counts.defaults, 209);
    oracleCounts = oracle.counts;
    for (const cases of [oracle.defaults, oracle.addonCases, oracle.repeatedAddonCases, oracle.priceCases]) {
      for (const item of cases) {
        const actual = api.evaluateMeal(catalog, item.draft);
        const expected = item.expected;
        const identity = JSON.stringify(item.draft);
        if ('foodTags' in expected) {
          equal(actual.tags.food, expected.foodTags, `Food tags ${identity}`);
          equal(actual.intendedTags.food, expected.intendedFoodTags, `Intended food tags ${identity}`);
          equal(actual.slots.used, expected.used, `Slots ${identity}`);
          equal(actual.slots.free, expected.free, `Free slots ${identity}`);
          equal([...new Set(actual.conflicts.map(conflict => conflict.tagId))].sort((a, b) => a - b), expected.conflictTags, `Bans ${identity}`);
          equal(actual.isDarkMatter, expected.isDarkMatter, `Dark matter ${identity}`);
          equal(actual.price.food, expected.foodPrice, `Food price ${identity}`);
        }
        if ('beverageTags' in expected) {
          equal(actual.tags.beverage, expected.beverageTags, `Beverage tags ${identity}`);
          equal(actual.price.beverage, expected.beveragePrice, `Beverage price ${identity}`);
        }
      }
    }
  });
} else {
  groups.push({ name: 'Python crosscheck', status: 'NOT_RUN', reason: 'Pass --oracle <generated meal_domain_python_oracle.json>' });
}

const report = { schemaVersion: 1, status: 'PASS', checks: groups, assertions, oracleCounts,
  source: { path: sourcePath, sha256: hash(fs.readFileSync(sourcePath)) },
  data: { path: dataPath, sha256: hash(fs.readFileSync(dataPath)), counts: data.provenance.counts },
  oracle: options['--oracle'] ? { path: options['--oracle'], sha256: hash(fs.readFileSync(options['--oracle'])) } : null,
  runtime: process.version, scope: 'pure domain automatic tests only; no site build/browser/game validation',
  changedFiles: ['脚本/export_meal_domain.py', '脚本/ryotei_meal_domain.js', '脚本/verify_meal_domain.cjs', '中间数据/MEAL_DOMAIN_DATA.json'],
  authorization: 'no changes to other production files; no installs, commits, game/save writes or site build',
  limitations: ['No trend score or reaction enum simulation', 'No Endurance/mood or actual-income prediction',
    'Base-budget range requires confirmed zero prior spend and complete ledger', 'Current catalog prices are not guaranteed runtime TrueValue'],
  git: { committed: false, existingChangesPreserved: 'pre-existing input snapshot and patch supplied by coordinator' } };
const text = `${JSON.stringify(report, null, 2)}\n`;
if (options['--out-dir']) {
  fs.mkdirSync(options['--out-dir'], { recursive: true });
  const output = `${options['--out-dir']}/meal_domain_test_report.json`;
  fs.writeFileSync(output, text, { encoding: 'utf8', flag: 'wx' });
  console.log(JSON.stringify({ status: 'PASS', assertions, oracleCounts, output, sha256: hash(Buffer.from(text)) }));
} else process.stdout.write(text);
