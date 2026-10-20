/* Pure meal-domain API. Insert this complete file inside the site's main IIFE.
 * Data and all numeric tag rules come from export_meal_domain.py; no UI globals.
 * Sessions are immutable values: saving a draft is NOT recording consumption.
 * Trend, rating, Endurance/mood and actual income are deliberately not simulated.
 */
const RyoteiMealDomain = (() => {
  'use strict';
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const clone = value => Array.isArray(value) ? value.map(clone) : object(value)
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;
  const freeze = value => {
    if (object(value) || Array.isArray(value)) {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  const unique = values => [...new Set(values)].sort((a, b) => a - b);
  const intersection = (values, other) => unique(values.filter(value => other.includes(value)));
  const difference = (values, other) => unique(values.filter(value => !other.includes(value)));
  const issue = (code, message, field = null) => ({ code, message, field });
  const nil = value => value === undefined || value === null ||
    (typeof value === 'string' && value.trim() === '');
  const numeric = (value, integer = false) => {
    if (nil(value)) return null;
    if (typeof value === 'string') {
      const text = value.trim();
      if (!(integer ? /^-?\d+$/ : /^-?(?:\d+(?:\.\d*)?|\.\d+)$/).test(text)) return NaN;
      value = Number(text);
    }
    if (typeof value !== 'number' || !Number.isFinite(value) ||
        (integer && !Number.isSafeInteger(value))) return NaN;
    return value;
  };
  const validMoney = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const keyFor = value => typeof value === 'string' && /^[sn]:-?\d+$/.test(value) ? value : null;
  const mapId = value => numeric(value, true);

  function createCatalog(input) {
    if (!object(input) || input.schemaVersion !== 1) throw new Error('Unsupported meal catalog schema');
    const data = freeze(clone(input));
    const makeMap = (rows, key, label) => {
      if (!Array.isArray(rows)) throw new Error(`Missing catalog ${label}`);
      const result = new Map();
      for (const row of rows) {
        if (!object(row) || result.has(row[key])) throw new Error(`Duplicate or invalid ${label} identity`);
        if (key === 'id' && label !== 'maps' && !Number.isSafeInteger(row.id)) throw new Error(`Invalid ${label} ID`);
        result.set(row[key], row);
      }
      return result;
    };
    const foods = makeMap(data.foods, 'id', 'foods');
    const recipes = makeMap(data.recipes, 'id', 'recipes');
    const ingredients = makeMap(data.ingredients, 'id', 'ingredients');
    const beverages = makeMap(data.beverages, 'id', 'beverages');
    const guests = makeMap(data.guests, 'key', 'guests');
    const maps = makeMap(data.maps, 'id', 'maps');
    const rules = data.rules;
    if (!rules || !Array.isArray(rules.foodCoverPairs) || !object(data.tagMaps) ||
        !validMoney(rules.priceTag?.cheapBelow) || !validMoney(rules.priceTag?.expensiveAbove) ||
        !Number.isSafeInteger(rules.mealSlots?.maxTotalIngredients) ||
        !Number.isSafeInteger(rules.largePortion?.minTotalIngredients)) throw new Error('Missing machine composition rules');
    for (const recipe of recipes.values()) {
      if (!foods.has(recipe.foodId) || !Array.isArray(recipe.baseIngredients) ||
          recipe.baseIngredients.some(id => !ingredients.has(id))) throw new Error(`Invalid recipe ${recipe.id}`);
    }
    const foodPriceIds = Object.fromEntries(Object.entries(rules.priceTag.food).map(([id, label]) => [label, Number(id)]));
    const beveragePriceIds = Object.fromEntries(Object.entries(rules.priceTag.beverage).map(([id, label]) => [label, Number(id)]));
    const catalog = {
      foods, recipes, ingredients, beverages, guests, maps, data, rules,
      tagMaps: data.tagMaps, dynamicTagIds: data.dynamicTagIds,
      contextTagIds: data.contextTagIds, specialIds: data.specialIds,
      getFood: id => foods.get(mapId(id)) || null,
      getRecipe: id => recipes.get(mapId(id)) || null,
      getIngredient: id => ingredients.get(mapId(id)) || null,
      getBeverage: id => beverages.get(mapId(id)) || null,
      getGuest: key => guests.get(key) || null,
      getMap: id => maps.get(id) || null,
      tagName: (kind, id) => data.tagMaps[kind]?.[String(id)] ?? `<${id}>`,
      priceTagIds: freeze({ food: { expensive: foodPriceIds['昂贵'], cheap: foodPriceIds['实惠'] },
        beverage: { expensive: beveragePriceIds['昂贵'], cheap: beveragePriceIds['便宜'] } })
    };
    if (Object.values(catalog.priceTagIds).some(pair => !Number.isSafeInteger(pair.expensive) ||
        !Number.isSafeInteger(pair.cheap))) throw new Error('Missing category price-tag identities');
    return Object.freeze(catalog);
  }

  function sanitizeDraft(catalog, input) {
    const errors = [];
    if (!object(input)) { errors.push(issue('INVALID_DRAFT', '套餐输入必须是对象')); input = {}; }
    const id = (field, values) => {
      const value = numeric(input[field], true);
      if (Number.isNaN(value) || (value !== null && !values.has(value))) {
        errors.push(issue('INVALID_ID', `未知或无效的 ${field}`, field)); return null;
      }
      return value;
    };
    const tag = (field, kind) => {
      const value = numeric(input[field], true);
      if (Number.isNaN(value) || (value !== null && !Object.hasOwn(catalog.tagMaps[kind], String(value)))) {
        errors.push(issue('INVALID_REQUEST', '未知或无效的点单标签', field)); return null;
      }
      return value;
    };
    const price = field => {
      const value = numeric(input[field]);
      if (value !== null && !validMoney(value)) {
        errors.push(issue('INVALID_PRICE', '计费价须为空或有限非负数；0 是实际输入值', field)); return null;
      }
      return value;
    };
    const extras = [];
    if (input.extras !== undefined && !Array.isArray(input.extras)) errors.push(issue('INVALID_EXTRAS', '加料须为数组', 'extras'));
    if (Array.isArray(input.extras)) {
      // More than the machine slot cap can never be valid; do not silently trim.
      for (const extra of input.extras) {
        const value = numeric(extra, true);
        if (value === null || Number.isNaN(value) || !catalog.ingredients.has(value)) {
          errors.push(issue('INVALID_EXTRA', '加料含未知食材', 'extras'));
        } else extras.push(value);
      }
    }
    let beveragePrice = price('beveragePrice');
    if (input.bevPrice !== undefined) {
      const alias = price('bevPrice');
      if (!nil(input.beveragePrice) && alias !== beveragePrice) errors.push(issue('CONFLICTING_PRICE', '酒水计费价别名不一致', 'bevPrice'));
      else beveragePrice = alias;
    }
    let dailyTrend = null;
    if (!nil(input.dailyTrend)) {
      if (!object(input.dailyTrend)) errors.push(issue('INVALID_TREND', '趋势须为对象或留空', 'dailyTrend'));
      else {
        const trendTag = numeric(input.dailyTrend.tagId ?? input.dailyTrend.tag, true);
        if (Number.isNaN(trendTag) || (trendTag !== null && !Object.hasOwn(catalog.tagMaps.food, String(trendTag)))) {
          errors.push(issue('INVALID_TREND', '未知趋势标签', 'dailyTrend'));
        } else {
          const isNegative = input.dailyTrend.isNegative === true;
          if (input.dailyTrend.isNegative !== undefined && typeof input.dailyTrend.isNegative !== 'boolean') {
            errors.push(issue('INVALID_TREND', '趋势方向须为布尔值', 'dailyTrend'));
          }
          dailyTrend = { tagId: trendTag, isNegative };
        }
      }
    }
    if (input.free !== undefined && typeof input.free !== 'boolean') errors.push(issue('INVALID_FREE', '免费标记须为布尔值', 'free'));
    return { draft: { recipeId: id('recipeId', catalog.recipes), foodId: id('foodId', catalog.foods),
      beverageId: id('beverageId', catalog.beverages), extras,
      foodRequest: tag('foodRequest', 'food'), beverageRequest: tag('beverageRequest', 'beverage'),
      dailyTrend, foodPrice: price('foodPrice'), beveragePrice, free: input.free === true }, errors };
  }

  function composeFood(catalog, food, recipe, extras, price, changes) {
    const tags = new Set(food.rawTags);
    const add = (tagId, type, details = {}) => {
      if (!tags.has(tagId)) { tags.add(tagId); changes.push({ type, category: 'food', action: 'added', tagId, ...details }); }
    };
    if (!catalog.rules.priceTag.skippedIds.includes(food.id) && price !== null) {
      if (price > catalog.rules.priceTag.expensiveAbove) add(catalog.priceTagIds.food.expensive, 'price-tag', { price });
      else if (price < catalog.rules.priceTag.cheapBelow) add(catalog.priceTagIds.food.cheap, 'price-tag', { price });
    }
    for (const ingredient of extras) for (const tag of ingredient.rawTags) add(tag, 'ingredient-tag', { ingredientId: ingredient.id });
    if (recipe.baseIngredients.length + extras.length >= catalog.rules.largePortion.minTotalIngredients) {
      add(catalog.rules.largePortion.tag, 'large-portion');
    }
    for (const [coverer, covered] of catalog.rules.foodCoverPairs) {
      if (tags.has(coverer) && tags.delete(covered)) changes.push({ type: 'covered', category: 'food',
        action: 'removed', tagId: covered, by: coverer });
    }
    return unique([...tags]);
  }

  function composeBeverage(catalog, beverage, price, changes) {
    const tags = new Set(beverage.rawTags);
    if (price !== null) {
      const id = price > catalog.rules.priceTag.expensiveAbove ? catalog.priceTagIds.beverage.expensive :
        price < catalog.rules.priceTag.cheapBelow ? catalog.priceTagIds.beverage.cheap : null;
      if (id !== null && !tags.has(id)) {
        tags.add(id); changes.push({ type: 'price-tag', category: 'beverage', action: 'added', tagId: id, price });
      }
    }
    return unique([...tags]);
  }

  function evaluateMeal(catalog, input, context = {}) {
    const { draft, errors } = sanitizeDraft(catalog, input);
    let recipe = catalog.getRecipe(draft.recipeId);
    let food = catalog.getFood(draft.foodId);
    if (recipe) {
      if (food && recipe.foodId !== food.id) errors.push(issue('RECIPE_FOOD_MISMATCH', '菜谱 ID 与料理 ID 不对应', 'recipeId'));
      food = catalog.getFood(recipe.foodId);
      draft.foodId = food.id;
    } else if (food) {
      if (food.recipeIds.length === 1) {
        recipe = catalog.getRecipe(food.recipeIds[0]); draft.recipeId = recipe.id;
      } else errors.push(issue('RECIPE_REQUIRED', food.recipeIds.length ? '请选择明确的菜谱' : '此失败产物没有可烹饪菜谱', 'recipeId'));
    }
    const beverage = catalog.getBeverage(draft.beverageId);
    const extras = draft.extras.map(id => catalog.getIngredient(id));
    if (!recipe && extras.length) errors.push(issue('FOOD_REQUIRED', '加料需要先选菜谱', 'extras'));
    if (!food && !beverage) errors.push(issue('EMPTY_MEAL', '尚未选择料理或酒水'));
    const max = catalog.rules.mealSlots.maxTotalIngredients;
    const used = (recipe?.baseIngredients.length || 0) + extras.length;
    const slots = { used, max, free: Math.max(0, max - used), base: recipe?.baseIngredients.length || 0,
      extras: extras.length, valid: used <= max };
    if (!slots.valid) errors.push(issue('SLOT_OVERFLOW', '主料与重复加料合计超过成餐食材位', 'extras'));
    const conflicts = [];
    if (food) extras.forEach((ingredient, extraIndex) => {
      for (const tagId of intersection(ingredient.rawTags, food.banTags)) conflicts.push({
        code: 'DARK_MATTER_CONFLICT', ingredientId: ingredient.id, extraIndex, tagId,
        message: `${ingredient.name} 的 ${catalog.tagName('food', tagId)} 与料理冲突` });
    });
    if (conflicts.length) errors.push(issue('DARK_MATTER', '加料原始标签与料理禁忌冲突，会形成黑暗物质', 'extras'));
    const isDarkMatter = conflicts.length > 0 || food?.id === catalog.specialIds.darkMatterFood;
    const foodPrice = food ? (draft.foodPrice ?? food.price) : 0;
    const beveragePrice = beverage ? (draft.beveragePrice ?? beverage.price) : 0;
    const changes = [];
    const intendedFoodTags = food && recipe ? composeFood(catalog, food, recipe, extras, foodPrice, changes) : [];
    const foodInvalid = errors.some(error => ['recipeId', 'foodId', 'extras', 'foodPrice'].includes(error.field));
    const foodTags = isDarkMatter ? [catalog.specialIds.darkMatterTag] : foodInvalid ? [] : intendedFoodTags;
    if (isDarkMatter && conflicts.length) changes.push({ type: 'dark-matter', category: 'food', action: 'replaced',
      tagId: catalog.specialIds.darkMatterTag, foodId: catalog.specialIds.darkMatterFood });
    const beverageInvalid = errors.some(error => ['beverageId', 'beveragePrice', 'bevPrice'].includes(error.field));
    const beverageTags = beverage && !beverageInvalid ? composeBeverage(catalog, beverage, beveragePrice, changes) : [];
    const guestKey = context.guestKey ?? context.session?.guestKey ?? context.guest?.key ?? null;
    const guest = context.guest ?? catalog.getGuest(guestKey);
    const fixedTags = (kind, tags) => tags.filter(id => !catalog.contextTagIds[kind].includes(id));
    const likeFoodTags = guest ? intersection(fixedTags('food', foodTags), guest.isLikeAllFoodTags ?
      fixedTags('food', foodTags) : guest.foodLikes) : [];
    const likeBeverageTags = guest ? intersection(fixedTags('beverage', beverageTags), guest.isLikeAllBevTags ?
      fixedTags('beverage', beverageTags) : guest.beverageLikes) : [];
    const hateFoodTags = guest ? intersection(fixedTags('food', foodTags), guest.foodHates) : [];
    const request = (tagId, tags, available, kind) => ({ tagId,
      status: tagId === null || !available || catalog.contextTagIds[kind].includes(tagId) ? 'unknown' :
        tags.includes(tagId) ? 'satisfied' : 'missing' });
    const ingredientIds = [...(recipe?.baseIngredients || []), ...draft.extras];
    const ingredientCost = ingredientIds.reduce((sum, id) => sum + catalog.getIngredient(id).price, 0);
    const priceErrors = errors.some(error => ['INVALID_PRICE', 'CONFLICTING_PRICE'].includes(error.code));
    const combinedPrice = foodPrice + beveragePrice;
    if (!Number.isFinite(combinedPrice)) errors.push(issue('PRICE_OVERFLOW', '合计计费价超出有限数值范围'));
    const total = (!food && !beverage) || priceErrors || !Number.isFinite(combinedPrice) ? null : combinedPrice;
    const price = { food: priceErrors && food ? null : foodPrice,
      beverage: priceErrors && beverage ? null : beveragePrice, total, ingredientCost,
      chargedTotal: total === null ? null : draft.free ? 0 : total, free: draft.free,
      foodSource: !food ? 'absent' : draft.foodPrice === null ? 'catalog' : 'override',
      beverageSource: !beverage ? 'absent' : draft.beveragePrice === null ? 'catalog' : 'override',
      source: (!food || draft.foodPrice !== null) && (!beverage || draft.beveragePrice !== null) ? 'override' :
        draft.foodPrice === null && draft.beveragePrice === null ? 'catalog' : 'mixed',
      ingredientCostSemantics: '目录材料价值独立列示；不加到料理或酒水售价',
      valid: errors.length === 0 && !isDarkMatter };
    const tags = { food: foodTags, beverage: beverageTags };
    const likes = { food: likeFoodTags, beverage: likeBeverageTags };
    const dislikes = { food: hateFoodTags };
    const result = { draft, guest, food, recipe, beverage, extras, price, tags, finalTags: tags,
      intendedTags: { food: intendedFoodTags, beverage: beverageTags }, likes, dislikes, hits: likes, hates: dislikes,
      requests: { food: request(draft.foodRequest, foodTags, !!recipe && !foodInvalid && !isDarkMatter, 'food'),
        beverage: request(draft.beverageRequest, beverageTags, !!beverage && !beverageInvalid, 'beverage') },
      slots, conflicts, errors, changes, isDarkMatter, valid: price.valid, canRecord: price.valid,
      knowledge: { foodHates: guest?.foodHatesKnown ? 'known' : 'unknown', beverageHates: 'unknown' },
      trend: { status: 'not-counted', reason: 'unverified-runtime-attitude', input: draft.dailyTrend,
        attitude: guest?.trendAttitude ?? null,
        message: '趋势态度与运行时评价关系未精确验证，未计入命中或评分' } };
    result.budget = budgetFacts(guest, context.session, result);
    return result;
  }

  function suggestAddons(catalog, draft, context = {}) {
    const base = evaluateMeal(catalog, draft, context);
    const suggestions = [], excluded = [];
    if (!base.recipe || !base.valid || base.slots.free === 0) return { base, suggestions, excluded,
      reason: !base.valid ? 'invalid-base' : 'no-free-slots' };
    for (const ingredient of catalog.ingredients.values()) {
      if (ingredient.isEasterEgg) { excluded.push({ ingredient, reason: 'easter-egg' }); continue; }
      const meal = evaluateMeal(catalog, { ...base.draft, extras: [...base.draft.extras, ingredient.id] }, context);
      const addedHates = difference(meal.dislikes.food, base.dislikes.food);
      const addedLikes = difference(meal.likes.food, base.likes.food);
      const removedLikes = difference(base.likes.food, meal.likes.food);
      const removedHates = difference(base.dislikes.food, meal.dislikes.food);
      const requestGain = base.requests.food.status === 'missing' && meal.requests.food.status === 'satisfied';
      const requestLoss = base.requests.food.status === 'satisfied' && meal.requests.food.status !== 'satisfied';
      const tagChanges = { added: difference(meal.tags.food, base.tags.food), removed: difference(base.tags.food, meal.tags.food) };
      const details = { ingredient, meal, addedLikes, removedLikes, addedHates, removedHates, requestGain, tagChanges };
      if (!meal.valid || addedHates.length || requestLoss) {
        excluded.push({ ...details, reason: !meal.valid ? 'invalid-composition' : addedHates.length ? 'new-dislike' : 'lost-request' });
      } else if (meal.likes.food.length > base.likes.food.length || removedHates.length || requestGain) {
        suggestions.push(details);
      } else excluded.push({ ...details, reason: 'no-new-benefit' });
    }
    suggestions.sort((a, b) => Number(b.requestGain) - Number(a.requestGain) ||
      b.addedLikes.length - a.addedLikes.length || a.ingredient.price - b.ingredient.price || a.ingredient.id - b.ingredient.id);
    return { base, suggestions, excluded, reason: suggestions.length ? 'available' : 'no-beneficial-addon' };
  }

  // Each function returns a new serializable value; there is no implicit session owner.
  function createSession(options = {}) {
    if (!object(options)) options = {};
    const priorSpend = numeric(options.priorSpend);
    const session = { schemaVersion: 1, guestKey: keyFor(options.guestKey),
      priorSpend: validMoney(priorSpend) ? priorSpend : null,
      priorConfirmed: options.priorConfirmed === true && priorSpend === 0,
      ledgerComplete: options.ledgerComplete === true, ledger: [], nextReceiptId: 1,
      actualSnapshot: null, snapshotInvalidated: false };
    const balance = numeric(options.actualBalance);
    if (balance !== null && !Number.isNaN(balance)) session.actualSnapshot = {
      balance, ledgerCount: 0, ledgerSpend: 0, prefix: [] };
    return session;
  }

  function sanitizeSession(input) {
    const errors = [];
    if (!object(input) || input.schemaVersion !== 1) return { session: createSession(),
      errors: [issue('INVALID_SESSION', '缺少或不支持的消费记录版本')] };
    const session = createSession(input);
    session.snapshotInvalidated = input.snapshotInvalidated === true;
    if (input.guestKey !== null && input.guestKey !== undefined && !session.guestKey) errors.push(issue('INVALID_SESSION_GUEST', '消费记录客人标识无效'));
    if (input.priorSpend !== null && input.priorSpend !== undefined && !validMoney(numeric(input.priorSpend))) errors.push(issue('INVALID_PRIOR_SPEND', '历史消费无效'));
    if (!Array.isArray(input.ledger)) errors.push(issue('INVALID_LEDGER', '账本必须是数组'));
    const ids = new Set();
    for (const row of Array.isArray(input.ledger) ? input.ledger : []) {
      if (!object(row) || typeof row.id !== 'string' || !/^r[1-9]\d*$/.test(row.id) || ids.has(row.id) ||
          !validMoney(row.total) || !validMoney(row.chargedTotal) || typeof row.free !== 'boolean' ||
          row.chargedTotal !== (row.free ? 0 : row.total)) {
        errors.push(issue('INVALID_RECEIPT', '消费记录金额、免费标记或标识无效')); continue;
      }
      ids.add(row.id); session.ledger.push(clone(row));
    }
    const greatest = session.ledger.reduce((max, row) => Math.max(max, Number(row.id.slice(1))), 0);
    const next = numeric(input.nextReceiptId, true);
    session.nextReceiptId = next !== null && !Number.isNaN(next) && next > greatest ? next : greatest + 1;
    if (!Number.isSafeInteger(session.nextReceiptId) || session.nextReceiptId >= Number.MAX_SAFE_INTEGER ||
        !Number.isFinite(session.ledger.reduce((sum, row) => sum + row.chargedTotal, 0))) {
      errors.push(issue('LEDGER_OVERFLOW', '账本累计金额或消费标识超出可用数值范围'));
    }
    session.actualSnapshot = null;
    if (!nil(input.actualSnapshot)) {
      const snapshot = input.actualSnapshot;
      if (!object(snapshot) || numeric(snapshot.balance) === null || Number.isNaN(numeric(snapshot.balance)) ||
          !Number.isSafeInteger(snapshot.ledgerCount) || snapshot.ledgerCount < 0 ||
          !validMoney(snapshot.ledgerSpend) || !Array.isArray(snapshot.prefix) ||
          snapshot.prefix.length !== snapshot.ledgerCount || snapshot.ledgerCount > session.ledger.length) {
        errors.push(issue('INVALID_SNAPSHOT', '余额快照没有有效账本锚点'));
      } else {
        const prefix = session.ledger.slice(0, snapshot.ledgerCount);
        const matches = prefix.every((row, index) => object(snapshot.prefix[index]) &&
          row.id === snapshot.prefix[index].id && row.chargedTotal === snapshot.prefix[index].chargedTotal);
        const spend = prefix.reduce((sum, row) => sum + row.chargedTotal, 0);
        if (!matches || Math.abs(spend - snapshot.ledgerSpend) > 1e-8) errors.push(issue('SNAPSHOT_ANCHOR_MISMATCH', '快照前消费记录已变化，不能推算余额'));
        else session.actualSnapshot = { balance: numeric(snapshot.balance), ledgerCount: snapshot.ledgerCount,
          ledgerSpend: snapshot.ledgerSpend, prefix: clone(snapshot.prefix) };
      }
    }
    if (errors.length) { session.priorConfirmed = false; session.ledgerComplete = false; session.actualSnapshot = null; }
    return { session, errors };
  }

  function setActualSnapshot(input, value) {
    const checked = sanitizeSession(input);
    if (checked.errors.length) throw new Error('INVALID_SESSION: repair consumption records before setting a snapshot');
    const balance = numeric(value);
    if (Number.isNaN(balance)) throw new Error('INVALID_BALANCE: snapshot must be blank or a finite signed number');
    const session = checked.session;
    session.snapshotInvalidated = false;
    session.actualSnapshot = balance === null ? null : { balance, ledgerCount: session.ledger.length,
      ledgerSpend: session.ledger.reduce((sum, row) => sum + row.chargedTotal, 0),
      prefix: session.ledger.map(row => ({ id: row.id, chargedTotal: row.chargedTotal })) };
    return session;
  }

  function recordConsumption(input, meal) {
    const checked = sanitizeSession(input);
    if (checked.errors.length) throw new Error('INVALID_SESSION: consumption record is invalid');
    if (!object(meal) || meal.canRecord !== true || !meal.price?.valid || !validMoney(meal.price.total) ||
        !validMoney(meal.price.chargedTotal)) throw new Error('INVALID_MEAL: cannot record an invalid or unknown-price meal');
    const session = checked.session;
    if (session.guestKey && meal.guest?.key && session.guestKey !== meal.guest.key) throw new Error('GUEST_MISMATCH: new customer requires a new session');
    const accumulated = session.ledger.reduce((sum, row) => sum + row.chargedTotal, 0) + meal.price.chargedTotal;
    if (!Number.isFinite(accumulated)) throw new Error('LEDGER_OVERFLOW: cumulative spending must remain finite');
    session.ledger.push({ id: `r${session.nextReceiptId++}`, recipeId: meal.draft.recipeId,
      foodId: meal.draft.foodId, beverageId: meal.draft.beverageId, extras: [...meal.draft.extras],
      foodPrice: meal.price.food, beveragePrice: meal.price.beverage, total: meal.price.total,
      chargedTotal: meal.price.chargedTotal, free: meal.price.free, priceSource: meal.price.source });
    return session;
  }

  function undoConsumption(input) {
    const checked = sanitizeSession(input);
    if (checked.errors.length) throw new Error('INVALID_SESSION: consumption record is invalid');
    const session = checked.session;
    if (!session.ledger.length) return session;
    session.ledger.pop();
    if (session.actualSnapshot && session.ledger.length < session.actualSnapshot.ledgerCount) {
      session.actualSnapshot = null; session.snapshotInvalidated = true;
      session.priorConfirmed = false; session.ledgerComplete = false;
    }
    return session;
  }

  function budgetFacts(guest, input, meal = null) {
    const checked = input === null || input === undefined ? { session: createSession(), errors: [] } : sanitizeSession(input);
    const session = checked.session;
    const recordedSpend = session.ledger.reduce((sum, row) => sum + row.chargedTotal, 0);
    const warnings = checked.errors.map(error => error.code);
    const spend = session.priorSpend === null ? null : session.priorSpend + recordedSpend;
    const guestRange = Array.isArray(guest) ? guest : guest?.budgetRange;
    const validRange = Array.isArray(guestRange) && guestRange.length === 2 && guestRange.every(validMoney) && guestRange[0] <= guestRange[1];
    const mismatch = !!(guest?.key && session.guestKey && guest.key !== session.guestKey);
    let mode = 'unknown', remaining = null;
    if (mismatch) warnings.push('GUEST_MISMATCH');
    else if (!checked.errors.length && session.actualSnapshot) {
      const since = session.ledger.slice(session.actualSnapshot.ledgerCount).reduce((sum, row) => sum + row.chargedTotal, 0);
      const balance = session.actualSnapshot.balance - since;
      mode = 'actual'; remaining = { min: balance, max: balance };
    } else if (!checked.errors.length && validRange && session.priorConfirmed && session.priorSpend === 0 && session.ledgerComplete) {
      mode = 'range'; remaining = { min: guestRange[0] - recordedSpend, max: guestRange[1] - recordedSpend };
      warnings.push('BASE_RANGE_NO_RUNTIME_MODIFIERS');
    }
    if (remaining && (!Number.isFinite(remaining.min) || !Number.isFinite(remaining.max))) {
      mode = 'unknown'; remaining = null; warnings.push('BALANCE_OVERFLOW');
    }
    if (session.snapshotInvalidated) warnings.push('SNAPSHOT_INVALIDATED_BY_UNDO');
    if (mode === 'unknown') warnings.push('REMAINING_FUNDS_UNKNOWN');
    let mealPrice = null;
    if (meal?.price?.valid && validMoney(meal.price.chargedTotal)) mealPrice = meal.price.chargedTotal;
    let after = remaining && mealPrice !== null ? { min: remaining.min - mealPrice, max: remaining.max - mealPrice } : null;
    if (after && (!Number.isFinite(after.min) || !Number.isFinite(after.max))) {
      after = null; warnings.push('BALANCE_OVERFLOW');
    }
    const exceedsLower = remaining && mealPrice !== null ? mealPrice > remaining.min : null;
    const exceedsUpper = remaining && mealPrice !== null ? mealPrice > remaining.max : null;
    const risk = exceedsUpper === null ? 'unknown' : exceedsUpper ? 'over-upper' : exceedsLower ? 'within-range' : 'within-lower';
    if (meal?.price?.source !== 'override' && mealPrice !== null) warnings.push('CATALOG_PRICE_NOT_RUNTIME_GUARANTEE');
    return { mode, remaining, after, mealPrice, spend, recordedSpend, ledgerCount: session.ledger.length,
      snapshot: clone(session.actualSnapshot), risk, exceedsLower, exceedsUpper, warnings,
      canServe: true, hardFilter: false, actualRevenue: null, rating: null,
      semantics: '资金风险提示，不限制候选；金额是记录价/输入快照，不预测评级或实际收入' };
  }

  function aggregatePreparation(catalog, inputs, context = {}) {
    const meals = [], errors = [], materialMap = new Map(), beverageMap = new Map();
    if (!Array.isArray(inputs)) return { meals, materials: [], beverages: [], errors: [issue('INVALID_PREPARATION', '备菜清单须为数组')], coverage: null };
    for (let index = 0; index < inputs.length; index++) {
      const item = inputs[index];
      const wrapped = object(item) && Object.hasOwn(item, 'draft');
      const rawQuantity = wrapped && item.quantity !== undefined ? item.quantity : 1;
      const quantity = numeric(rawQuantity, true);
      if (quantity === null || Number.isNaN(quantity) || quantity <= 0) { errors.push({ ...issue('INVALID_QUANTITY', '份数须为正整数'), index }); continue; }
      const meal = evaluateMeal(catalog, wrapped ? item.draft : item, { ...context,
        guestKey: wrapped && item.guestKey ? item.guestKey : context.guestKey });
      meals.push({ index, quantity, meal });
      if (!meal.valid) { errors.push(...meal.errors.map(error => ({ ...error, index }))); continue; }
      const addIngredient = (id, extra) => {
        if (!materialMap.has(id)) {
          const ingredient = catalog.getIngredient(id);
          materialMap.set(id, { id, ingredientId: id, name: ingredient.name, quantity: 0,
            baseQuantity: 0, extraQuantity: 0, unitCatalogCost: ingredient.price, catalogCost: 0 });
        }
        const row = materialMap.get(id);
        row.quantity += quantity; row[extra ? 'extraQuantity' : 'baseQuantity'] += quantity;
        row.catalogCost = row.quantity * row.unitCatalogCost;
      };
      for (const id of meal.recipe?.baseIngredients || []) addIngredient(id, false);
      for (const id of meal.draft.extras) addIngredient(id, true);
      if (meal.beverage) {
        const beverage = meal.beverage;
        if (!beverageMap.has(beverage.id)) beverageMap.set(beverage.id, { id: beverage.id, beverageId: beverage.id,
          name: beverage.name, quantity: 0 });
        beverageMap.get(beverage.id).quantity += quantity;
      }
    }
    const guestKeys = Array.isArray(context.guestKeys) ? context.guestKeys : [...catalog.guests.keys()];
    const guests = [];
    for (const key of guestKeys) {
      const guest = catalog.getGuest(key);
      if (!guest) { errors.push(issue('UNKNOWN_GUEST', `未知客人 ${key}`)); continue; }
      const foodMeals = [], beverageMeals = [], completeMeals = [];
      for (const row of meals) {
        const meal = row.meal;
        if (!meal.valid) continue;
        const foodMatch = !!meal.food && intersection(meal.tags.food, guest.foodHates).length === 0 &&
          (guest.isLikeAllFoodTags || intersection(meal.tags.food, guest.foodLikes).length > 0);
        const beverageMatch = !!meal.beverage && (guest.isLikeAllBevTags || intersection(meal.tags.beverage, guest.beverageLikes).length > 0);
        if (foodMatch) foodMeals.push(row.index);
        if (beverageMatch) beverageMeals.push(row.index);
        if (foodMatch && beverageMatch) completeMeals.push(row.index);
      }
      guests.push({ key, name: guest.name, foodMeals, beverageMeals, completeMeals,
        foodHatesKnown: guest.foodHatesKnown, covered: foodMeals.length > 0 || beverageMeals.length > 0 });
    }
    const materials = [...materialMap.values()].sort((a, b) => a.id - b.id);
    return { meals, materials, beverages: [...beverageMap.values()].sort((a, b) => a.id - b.id), errors,
      coverage: { guests, totalGuestCount: guests.length, coveredGuestCount: guests.filter(guest => guest.covered).length,
        completeMealGuestCount: guests.filter(guest => guest.completeMeals.length > 0).length,
        uncoveredGuestKeys: guests.filter(guest => !guest.covered).map(guest => guest.key),
        semantics: '固定口味覆盖关系；非来访概率、点单保证或备菜份数预测' },
      price: { total: meals.filter(row => row.meal.valid).reduce((sum, row) => sum + row.quantity * row.meal.price.total, 0),
        ingredientCatalogCost: materials.reduce((sum, row) => sum + row.catalogCost, 0) } };
  }

  return Object.freeze({ version: 1, createCatalog, sanitizeDraft, evaluateMeal,
    composeMeal: evaluateMeal, compose: evaluateMeal, suggestAddons, aggregatePreparation,
    createSession, makeSession: createSession, newSession: createSession, sanitizeSession,
    recordConsumption, record: recordConsumption, undoConsumption, undo: undoConsumption,
    setActualSnapshot, snapshot: setActualSnapshot, budgetFacts });
})();
