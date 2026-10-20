const RyoteiMealUI = (() => {
  const planTabs = new Set(['details', 'drinkrecs', 'addons']);
  const storageKey = 'mystia-ryotei-meals-v1';
  const drafts = new Map();
  const sessions = new Map();
  const views = new Map();
  let catalog = null;
  let saved = [];
  let preparation = [];
  let ready = false;
  let workspaceSignature = '';
  let preparationSignature = '';
  let notice = '';

  const number = value => value === '' || value == null ? null : Number(value);
  const money = value => Number.isFinite(value) ? value.toLocaleString('zh-Hans-CN', { maximumFractionDigits: 2 }) + ' 元' : '尚未选择';
  const button = (action, label, extra = '', disabled = false) => '<button type="button" class="meal-button" data-meal-action="' + action + '" ' + extra + (disabled ? ' disabled' : '') + '>' + esc(label) + '</button>';
  const itemButton = (kind, id, label, guestName = '') => button('choose', label, 'data-meal-kind="' + kind + '" data-meal-id="' + id + '" data-meal-guest="' + escAttr(guestName) + '"');
  const emptyDraft = () => ({ foodId: null, recipeId: null, beverageId: null, extras: [], foodRequest: null, beverageRequest: null, dailyTrend: null, foodPrice: null, beveragePrice: null, free: false });

  function itemIcon(item) {
    const source = (window.WAFU_ASSETS.icons || {})[item.displayName || item.name];
    return source ? '<img class="td-icon" src="' + source + '" alt="" loading="lazy">' : '';
  }
  function getCatalog() {
    if (!catalog) {
      const node = document.getElementById('meal-domain-data');
      if (!node) return null;
      catalog = RyoteiMealDomain.createCatalog(JSON.parse(node.textContent));
    }
    return catalog;
  }
  function guestByName(name) {
    const cat = getCatalog();
    return cat && Array.from(cat.guests.values()).find(guest => guest.name === name) || null;
  }
  function currentGuest() { return guestByName(state.serviceGuest); }
  function draftFor(guest) {
    if (!drafts.has(guest.key)) drafts.set(guest.key, emptyDraft());
    return drafts.get(guest.key);
  }
  function sessionFor(guest) {
    if (!sessions.has(guest.key)) sessions.set(guest.key, RyoteiMealDomain.createSession({ guestKey: guest.key }));
    return sessions.get(guest.key);
  }
  function viewFor(guest) {
    if (!views.has(guest.key)) views.set(guest.key, { food: 'matched', beverage: 'matched' });
    return views.get(guest.key);
  }
  function evaluate(guest, draft = draftFor(guest)) {
    return RyoteiMealDomain.evaluateMeal(getCatalog(), draft, { guestKey: guest.key, session: sessionFor(guest) });
  }
  function tagName(kind, id) {
    const cat = getCatalog();
    return cat.tagMaps[kind][String(id)] || String(id);
  }
  function tagList(kind, tags, style = 'neutral') {
    return tags && tags.length ? tagHtml(tags.map(id => tagName(kind, id)).join('、'), style) : '<span class="muted">无</span>';
  }
  function requestOptions(guest, kind, selected) {
    const ids = kind === 'food' ? guest.foodLikes : guest.beverageLikes;
    return '<option value="">尚未填写</option>' + ids.filter(id => ![-20, -21, -30].includes(id)).map(id => '<option value="' + id + '"' + (selected === id ? ' selected' : '') + '>' + esc(tagName(kind, id)) + '</option>').join('');
  }
  function noticeText(text) {
    notice = text;
    const output = $('#meal-notice');
    if (output) output.textContent = text;
  }
  function baseComparison(guest, price) {
    if (!guest || !guest.budgetRange || !Number.isFinite(price)) return { code: 'unknown', label: '基础范围未知' };
    const [low, high] = guest.budgetRange;
    if (price > high) return { code: 'over', label: '超过基础上限' };
    if (price > low) return { code: 'maybe', label: '介于基础上下限' };
    return { code: 'lower', label: '不高于基础下限' };
  }
  function candidateBudget(guestName, price) {
    if (!ready) return '';
    const comparison = baseComparison(guestByName(guestName), Number(price));
    return comparison.code === 'over' ? '<span class="budget-chip budget-over">超基础预算</span>' : '';
  }
  function candidateActions(kind, row) {
    if (!ready) return '';
    const id = kind === 'food' ? Number(row['菜品ID']) : Number(row['酒水ID']);
    const guestName = row['客人名字'] || '';
    return itemButton(kind, id, kind === 'food' ? '选为料理' : '选为酒水', guestName) + button('prepare-item', '备一份', 'data-meal-kind="' + kind + '" data-meal-id="' + id + '"');
  }
  function contextText(guest) {
    return guest.kind === 'normal'
      ? '普通客人按具体菜酒点单；这里核对口味与资源，不套用稀客标签点单评级。钱包没有固定资料范围。'
      : '按本次料理、酒水要求分别核对；命中数不是游戏评级。超预算仍可消费，但餐费可能收不满并触发缺钱离场。';
  }
  function itemCard(guest, kind, meal) {
    const item = kind === 'food' ? meal.food : meal.beverage;
    const label = kind === 'food' ? '料理' : '酒水';
    return '<div class="meal-selected-mini">' + (item ? itemIcon(item) : '<span class="meal-empty-icon">＋</span>') +
      '<div><span class="meal-eyebrow">' + label + '</span><strong>' + (item ? esc(item.displayName || item.name) : '还没选') + '</strong></div>' +
      (item ? '<span class="price-value">' + money(meal.price[kind]) + '</span>' + button('remove-' + kind, '×', 'aria-label="移除已选' + label + '"') : '') + '</div>';
  }
  function readReceipts(session) { return session.ledger || session.receipts || session.orders || []; }
  function requestsHTML(guest, draft) {
    if (guest.kind === 'normal') return '';
    return '<div class="meal-input-grid"><label>本次料理要求<select data-meal-field="foodRequest">' + requestOptions(guest, 'food', draft.foodRequest) + '</select></label><label>本次酒水要求<select data-meal-field="beverageRequest">' + requestOptions(guest, 'beverage', draft.beverageRequest) + '</select></label></div>';
  }
  function moneyControls(guest, session) {
    const facts = RyoteiMealDomain.budgetFacts(guest, session, evaluate(guest));
    const range = facts.mode === 'range';
    const actual = facts.mode === 'actual';
    return '<fieldset class="meal-budget-controls"><legend>这次入店的资金依据</legend><label class="meal-radio"><input type="radio" name="meal-budget-mode" value="unknown"' + (!range && !actual ? ' checked' : '') + '>不知道实际钱包</label><label class="meal-radio"><input type="radio" name="meal-budget-mode" value="range"' + (range ? ' checked' : '') + (guest.budgetRange ? '' : ' disabled') + '>确认从首单完整记录，按基础范围估算</label><label class="meal-radio"><input type="radio" name="meal-budget-mode" value="actual"' + (actual ? ' checked' : '') + '>知道本单前余额</label><div class="meal-balance-entry"><label for="meal-actual-balance">本单前余额</label><input id="meal-actual-balance" type="number" min="0" step="1" placeholder="不默认填写" value="' + escAttr(viewFor(guest).pendingBalance || '') + '" aria-describedby="meal-balance-help"><button class="meal-button" type="button" data-meal-action="snapshot">采用这个余额</button></div><p class="meal-help" id="meal-balance-help">觉之眼读数是快照；采用后只扣之后登记的单。0 也可能是负余额，不能保证再消费仍可收款。</p><p class="meal-help">范围估算仅适用无额外资金修正且此前账单完整的同次就餐；没有记录不代表此前消费为 0。</p></fieldset>';
  }
  function renderStation(guest) {
    const draft = draftFor(guest), session = sessionFor(guest), meal = evaluate(guest);
    const kind = state.tab === 'drinkrecs' ? 'beverage' : state.tab === 'addons' ? 'ingredient' : 'food';
    const step = (value, title, chosen) => '<button class="meal-step' + (kind === value ? ' active' : '') + '" type="button" data-meal-action="pick-step" data-meal-kind="' + value + '" aria-pressed="' + (kind === value) + '"><span>' + (value === 'food' ? '1' : value === 'beverage' ? '2' : '3') + '</span>' + title + '<small>' + esc(chosen) + '</small></button>';
    const station = $('#meal-station');
    station.innerHTML = '<div class="meal-station-head"><h3>' + esc(guest.name) + '<span class="meal-guest-range">' + (guest.budgetRange ? '钱包范围 ' + guest.budgetRange.join('–') : '钱包未知') + '</span></h3>' + '<div class="meal-actions">' + button('change-guest', '换客人') + button('new-session', '新一桌') + '</div></div>' +
      '<div class="meal-steps">' + step('food', '选料理', meal.food ? meal.food.name : '未选') + step('beverage', '选酒水', meal.beverage ? meal.beverage.displayName || meal.beverage.name : '未选') + step('ingredient', '加料', meal.recipe ? '余 ' + meal.slots.free + ' 格' : '先选料理') + '</div>' +
      '<div class="meal-pair">' + itemCard(guest, 'food', meal) + itemCard(guest, 'beverage', meal) + '</div>' +
      '<div class="meal-extras"><span>加料 ' + meal.slots.used + '/' + meal.slots.max + '</span><div class="meal-extra-list">' + (meal.extras || []).map((ingredient, index) => '<span class="meal-extra">' + esc(ingredient.name) + '<button type="button" data-meal-action="remove-extra" data-meal-index="' + index + '" aria-label="移除第' + (index + 1) + '份' + escAttr(ingredient.name) + '">×</button></span>').join('') + '</div></div>' +
      '<div id="meal-facts" aria-live="polite"></div>' +
      '<div class="meal-primary-actions">' + button('record', '记一单已上餐') + button('undo', '撤销', '', !readReceipts(session).length) + button('save', '保存搭配') + button('prepare-current', '加入备菜') + '</div>' +
      '<details class="meal-context" id="meal-context"><summary>点单要求 / 钱包</summary>' + requestsHTML(guest, draft) + moneyControls(guest, session) +
      '<label class="meal-radio"><input type="checkbox" data-meal-field="free"' + (draft.free ? ' checked' : '') + '>本单免费</label>' +
      '<details class="meal-advanced"><summary>游戏里有改价或特殊效果？</summary><div class="meal-input-grid"><label>料理实际价格<input type="number" min="0" step="1" data-meal-field="foodPrice" placeholder="留空按标价" value="' + (draft.foodPrice == null ? '' : draft.foodPrice) + '"></label><label>酒水实际价格<input type="number" min="0" step="1" data-meal-field="beveragePrice" placeholder="留空按标价" value="' + (draft.beveragePrice == null ? '' : draft.beveragePrice) + '"></label><label>今日流行<select data-meal-field="trendTag"><option value="">未填写</option>' + Object.entries(getCatalog().tagMaps.food).filter(([id]) => Number(id) >= 0).map(([id, name]) => '<option value="' + id + '"' + (draft.dailyTrend && draft.dailyTrend.tagId === Number(id) ? ' selected' : '') + '>' + esc(name) + '</option>').join('') + '</select></label><label>方向<select data-meal-field="trendDirection"><option value="like">喜爱</option><option value="hate"' + (draft.dailyTrend && draft.dailyTrend.isNegative ? ' selected' : '') + '>厌恶</option></select></label></div><p class="meal-help">流行仅作备忘。特殊符卡、厨具和挑战效果未计入。</p></details></details>' +
      '<details class="meal-saved"><summary>常用搭配 <span id="meal-saved-count">' + saved.length + '</span></summary><div id="meal-saved-list"></div><div class="meal-actions">' + button('export', '导出') + button('import', '导入') + '</div><label class="meal-import-label">备份 JSON<textarea id="meal-transfer" rows="2"></textarea></label></details>' +
      '<p id="meal-notice" class="meal-notice" role="status">' + esc(notice) + '</p>';
    renderFacts(guest); renderSaved();
  }
  function requestFact(result, title) {
    const text = result.status === 'satisfied' ? '已满足' : result.status === 'missing' ? '未满足' : '未填';
    return '<span class="request-state request-' + result.status + '">' + title + '：' + text + (result.tagId != null ? ' · ' + esc(tagName(title === '料理要求' ? 'food' : 'beverage', result.tagId)) : '') + '</span>';
  }
  function budgetHTML(guest, facts, meal) {
    const compare = baseComparison(guest, meal.price.total);
    if (facts.remaining) {
      const before = facts.remaining.min === facts.remaining.max ? money(facts.remaining.min) : facts.remaining.min + '–' + facts.remaining.max + ' 元';
      const after = facts.after ? facts.after.min === facts.after.max ? money(facts.after.min) : facts.after.min + '–' + facts.after.max + ' 元' : '未选齐';
      return '<div class="meal-budget-brief"><span>' + (facts.mode === 'actual' ? '余额 ' : '估算余额 ') + before + '</span><strong class="' + (facts.risk === 'over-upper' ? 'meal-caution' : '') + '">上这单后 ' + after + '</strong></div>';
    }
    return '<div class="meal-budget-brief"><span>钱包未知</span>' + (compare.code === 'over' ? '<strong class="meal-caution">超基础预算 · 可能收不满</strong>' : compare.code === 'maybe' ? '<span>可能超预算</span>' : '<span>可在“点单要求 / 钱包”填写余额</span>') + '</div>';
  }
  function renderFacts(guest) {
    const output = $('#meal-facts');
    if (!output) return;
    const meal = evaluate(guest), session = sessionFor(guest);
    const facts = RyoteiMealDomain.budgetFacts(guest, session, meal);
    const errors = (meal.errors || []).filter(error => error.code !== 'EMPTY_MEAL');
    const likes = meal.likes.food.map(id => tagName('food', id)).concat(meal.likes.beverage.map(id => tagName('beverage', id)));
    const hates = meal.dislikes.food;
    const requests = guest.kind === 'normal' ? '' : '<div class="meal-request-facts">' + requestFact(meal.requests.food, '料理要求') + requestFact(meal.requests.beverage, '酒水要求') + '</div>';
    const recipe = meal.recipe;
    output.innerHTML = '<div class="meal-total-line"><strong>合计 ' + (meal.price.total == null ? '—' : money(meal.price.total)) + '</strong><span class="meal-short-hits">喜好 ' + likes.length + ' 项' + (hates.length ? ' · 厌恶 ' + hates.length + ' 项' : '') + '</span><span class="meal-ledger-info">已记 ' + facts.ledgerCount + ' 单 · ' + money(facts.recordedSpend) + '</span></div>' + budgetHTML(guest, facts, meal) + requests +
      (errors.length ? '<div class="meal-error">' + errors.map(error => esc(error.message || error.code)).join('；') + '</div>' : '') +
      '<details class="meal-calculation"><summary>标签与材料详情</summary><div class="meal-taste-facts"><div>料理喜好 ' + tagList('food', meal.likes.food, 'good') + '</div><div>酒水喜好 ' + tagList('beverage', meal.likes.beverage, 'drink') + '</div><div>厌恶 ' + tagList('food', meal.dislikes.food, 'bad') + '</div></div>' +
      (recipe ? '<p>' + esc(recipe.cooker.name) + '：' + esc(recipe.baseIngredients.map(id => getCatalog().getIngredient(id).name).join('＋')) + '</p>' : '') + '<div>料理标签 ' + tagList('food', meal.tags.food) + '</div><div>酒水标签 ' + tagList('beverage', meal.tags.beverage, 'drink') + '</div><p class="meal-help">材料标价合计 ' + money(meal.price.ingredientCost) + '，不加入餐费。超预算不禁止选择，实际收款和评价以游戏为准。</p></details>';
    const undo = $('#meal-station [data-meal-action="undo"]');
    if (undo) undo.disabled = !readReceipts(session).length;
    const record = $('#meal-station [data-meal-action="record"]');
    if (record) record.disabled = !meal.canRecord || !meal.food || !meal.beverage;
  }
  function renderCardList(kind, rows, guest, detail = false) {
    const food = kind === 'food';
    const draft = guest && draftFor(guest);
    const sortKey = detail ? food ? 'detailMealSort' : 'detailDrinkSort' : food ? 'detailSort' : 'drinkrecSort';
    return RyoteiCandidateCards.render(kind, rows, {
      context: detail ? 'detail' : 'main', sortKey, showGuest: !guest,
      pageKey: detail ? sortKey : food ? 'mealFoodPage' : 'mealBeveragePage',
      sort: state[sortKey], selectedId: draft && (food ? draft.foodId : draft.beverageId),
      action: row => itemButton(kind, Number(row[food ? '菜品ID' : '酒水ID']), draft && Number(row[food ? '菜品ID' : '酒水ID']) === (food ? draft.foodId : draft.beverageId) ? '已选' : '选择', row['客人名字'] || guest && guest.name || '') +
        (!detail && !guest ? button('prepare-item', '备一份', 'data-meal-kind="' + kind + '" data-meal-id="' + row[food ? '菜品ID' : '酒水ID'] + '"') : ''),
      budget: row => candidateBudget(guest ? guest.name : row['客人名字'], row['价格'])
    });
  }
  function candidateColumns(kind, guest) {
    const food = kind === 'food';
    const base = food ? DETAIL_COLUMNS : DRINKREC_COLUMNS;
    return base.filter(column => !['客人名字', '类型'].includes(column.key)).map(column => ({ ...column, pageKey: food ? 'mealFoodPage' : 'mealBeveragePage' })).concat([
      { key: '__budget', label: '单品资金参考', render: row => candidateBudget(guest.name, row['价格']) },
      { key: '__choose', label: '操作', render: row => candidateActions(kind, row) }
    ]);
  }
  function catalogRows(kind, guest) {
    const view = viewFor(guest);
    const food = kind === 'food';
    if (view[kind] === 'matched') return (food ? buildMealIndex() : buildDrinkRecIndex()).filter(row => row['客人名字'] === guest.name);
    const likes = new Set(food ? guest.foodLikes.map(id => tagName('food', id)) : guest.beverageLikes.map(id => tagName('beverage', id)));
    return dataOf(food ? 'recipes' : 'beverages').map(row => {
      const tags = splitTags(row[food ? '菜品标签' : '标签']);
      const hits = tags.filter(tag => likes.has(tag));
      return { ...row, '客人名字': guest.name, '命中喜好': hits.join('、'), '命中数': hits.length };
    });
  }
  function renderCandidates(kind) {
    if (!ready) return false;
    const guest = currentGuest();
    if (!guest) return false;
    if (kind === 'ingredient') return renderAddonsForMeal(guest);
    const food = kind === 'food';
    synchronizePageContext(food ? 'mealFoodPage' : 'mealBeveragePage', guest, viewFor(guest)[kind]);
    const q = (food ? state.detailQuery : state.drinkrecQuery).trim().toLowerCase();
    const chips = food ? state.detailChips : state.drinkrecChips;
    let rows = catalogRows(kind, guest).filter(row => matchesTagChips(row, chips, [food ? '菜品标签' : '标签']) && matchesRowQuery(row, q, [food ? '菜品' : '酒水', '主料', food ? '菜品标签' : '标签', '命中喜好', '解锁来源']));
    const sorting = food ? state.detailSort : state.drinkrecSort;
    rows = sortObjects(rows, sorting.key === '命中喜好' ? '命中数' : sorting.key, sorting.dir);
    const count = $(food ? '#detail-count' : '#drinkrec-count');
    count.textContent = rows.length + ' 条 · ' + (viewFor(guest)[kind] === 'matched' ? '口味匹配' : '全部物品');
    const wrap = $(food ? '#detail-table-wrap' : '#drinkrec-table-wrap');
    wrap.innerHTML = renderCardList(kind, rows, guest, false);
    if (!food) {
      const select = $('#drinkrec-sort-filter');
      const values = { '价格': sorting.dir > 0 ? 'price-asc' : 'price-desc', '等级': sorting.dir > 0 ? 'level-asc' : 'level-desc', '命中喜好': sorting.dir > 0 ? 'match-asc' : 'match-desc', '命中数': sorting.dir > 0 ? 'match-asc' : 'match-desc' };
      select.value = values[sorting.key] || '';
    }
    return true;
  }
  function renderAddonsForMeal(guest) {
    const draft = draftFor(guest);
    if (draft.recipeId == null) return false;
    synchronizePageContext('mealIngredientPage', guest, [draft.recipeId, draft.extras, draft.foodRequest]);
    const baseline = evaluate(guest);
    const rows = [];
    for (const ingredient of getCatalog().ingredients.values()) {
      if (ingredient.isEasterEgg) continue;
      const trial = evaluate(guest, { ...draft, extras: draft.extras.concat(ingredient.id) });
      const added = trial.tags.food.filter(id => !baseline.tags.food.includes(id));
      const removed = baseline.tags.food.filter(id => !trial.tags.food.includes(id));
      const freshHates = trial.dislikes.food.filter(id => !baseline.dislikes.food.includes(id));
      const requestGain = trial.requests.food.status === 'satisfied' && baseline.requests.food.status !== 'satisfied';
      const row = { '食材': ingredient.name, '食材ID': ingredient.id, '价格': ingredient.price, '等级': ingredient.level || 0, '食材标签': ingredient.rawTags.map(id => tagName('food', id)).join('、'), '新增标签': added.map(id => tagName('food', id)).join('、') || '无新增', '失去标签': removed.map(id => tagName('food', id)).join('、') || '无', '效果': trial.errors.length ? trial.errors.map(error => error.message).join('；') : freshHates.length ? '新增厌恶：' + freshHates.map(id => tagName('food', id)).join('、') : requestGain ? '满足本次要求' : trial.likes.food.length > baseline.likes.food.length ? '多一个喜好' : '无新增喜好', '__canAdd': !trial.errors.length, '__warning': !!freshHates.length };
      if (matchesTagChips(row, state.addonChips, ['食材标签']) && matchesRowQuery(row, state.addonQuery.trim().toLowerCase(), ['食材', '食材标签', '新增标签', '失去标签', '效果'])) rows.push(row);
    }
    const columns = [
      { key: '食材', label: '食材', sortKey: 'addonSort', pageKey: 'mealIngredientPage' },
      { key: '价格', label: '材料目录价', num: true, sortable: true, sortKey: 'addonSort' },
      { key: '食材标签', label: '食材标签', tags: true },
      { key: '新增标签', label: '加入后新增' },
      { key: '失去标签', label: '加入后消失' },
      { key: '效果', label: '成餐效果', render: row => '<span class="' + (!row.__canAdd ? 'meal-invalid' : row.__warning ? 'meal-caution' : '') + '">' + esc(row['效果']) + '</span>' },
      { key: '__choose', label: '操作', render: row => button('add-extra', '加入一份', 'data-meal-id="' + row['食材ID'] + '"', !row.__canAdd) }
    ];
    $('#addon-count').textContent = rows.length + ' 种 · 按当前料理重算';
    $('#addon-scene-filter').disabled = true;
    $('#addon-table-wrap').innerHTML = RyoteiCandidateCards.render('ingredient', sortObjects(rows, state.addonSort.key, state.addonSort.dir), {
      sortKey: 'addonSort', pageKey: 'mealIngredientPage', sort: state.addonSort,
      action: row => button('add-extra', row.__canAdd ? '加入' : '不能加', 'data-meal-id="' + row['食材ID'] + '"', !row.__canAdd)
    });
    return true;
  }
  function scrollToCandidates() {
    const controls = $('#candidate-controls');
    if (controls) controls.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  function synchronizePageContext(key, guest, scope) {
    const signature = JSON.stringify([guest.key, scope]);
    if (views.get(key) !== signature) {
      delete ryoteiPages[key];
      views.set(key, signature);
    }
  }
  function scopeHTML(guest) {
    const kind = state.tab === 'details' ? 'food' : state.tab === 'drinkrecs' ? 'beverage' : null;
    if (!kind) return '';
    const scope = viewFor(guest)[kind];
    return '<div class="meal-candidate-scope" aria-label="候选范围">' + ['matched', 'all'].map(value => '<button type="button" class="meal-button' + (scope === value ? ' active' : '') + '" data-meal-action="scope" data-meal-kind="' + kind + '" data-meal-value="' + value + '" aria-pressed="' + (scope === value) + '">' + (value === 'matched' ? '口味匹配' : '全部物品') + '</button>').join('') + '</div>';
  }
  function renderCandidateControls(guest, active) {
    const host = $('#candidate-controls');
    if (!host) return;
    host.hidden = !active;
    if (!active) return;
    const field = state.tab === 'details' ? 'detailQuery' : state.tab === 'drinkrecs' ? 'drinkrecQuery' : 'addonQuery';
    const title = state.tab === 'details' ? '料理' : state.tab === 'drinkrecs' ? '酒水' : '食材';
    const stamp = [guest && guest.key, state.tab].join(':');
    if (host.dataset.context !== stamp) {
      host.dataset.context = stamp;
      host.innerHTML = '<div class="candidate-search-line"><h4>' + (state.tab === 'addons' ? '选加料' : '选' + title) + '</h4><label><span class="sr-only">搜索' + title + '</span><input id="candidate-search" type="search" placeholder="搜索' + title + '" value="' + escAttr(state[field]) + '" data-candidate-field="' + field + '"></label>' + (guest ? scopeHTML(guest) + button('show-tags', '按标签筛选') : '') + '</div><details class="candidate-tag-filters" id="candidate-tag-filters"><summary>标签筛选</summary><div>' + Object.entries(getCatalog().tagMaps[state.tab === 'drinkrecs' ? 'beverage' : 'food']).filter(([id]) => Number(id) >= -3).map(([id, name]) => button('filter-tag', name, 'data-meal-tag="' + escAttr(name) + '"')).join('') + '</div></details>';
    }
    const input = $('#candidate-search');
    if (input && document.activeElement !== input) input.value = state[field];
    for (const choice of document.querySelectorAll('#candidate-controls [data-meal-action="scope"]')) {
      const selected = guest && viewFor(guest)[choice.dataset.mealKind] === choice.dataset.mealValue;
      choice.classList.toggle('active', !!selected); choice.setAttribute('aria-pressed', String(!!selected));
    }
    const chips = state[state.tab === 'details' ? 'detailChips' : state.tab === 'drinkrecs' ? 'drinkrecChips' : 'addonChips'];
    for (const choice of document.querySelectorAll('#candidate-tag-filters [data-meal-action="filter-tag"]')) {
      const selected = chips.includes(choice.dataset.mealTag);
      choice.classList.toggle('active', selected); choice.setAttribute('aria-pressed', String(selected));
    }
  }
  function updateWorkspace(force = false) {
    if (!ready) return;
    const active = planTabs.has(state.tab);
    const station = $('#meal-station');
    const prep = $('#night-preparation');
    if (!station || !prep) return;
    prep.hidden = !active;
    const guest = active ? currentGuest() : null;
    station.hidden = !guest;
    $('#ryotei-workbench').classList.toggle('has-meal-context', active);
    $('#ryotei-workbench').classList.toggle('is-serving', !!guest);
    if (guest) {
      if ($('#workbench-filters').classList.contains('filters-open')) ryoteiCloseFilters();
      $('#workbench-filters').hidden = true;
      $('#filter-toggle').hidden = true;
      $('#ryotei-workbench').classList.remove('has-filters');
    }
    $('#addon-scene-filter').disabled = !!(guest && draftFor(guest).recipeId != null);
    const signature = JSON.stringify([active, guest && guest.key, state.tab, guest && draftFor(guest), guest && sessionFor(guest), guest && viewFor(guest), saved.length]);
    if (guest && (force || signature !== workspaceSignature)) {
      const contextOpen = !!$('#meal-context')?.open;
      const savedOpen = !!$('#meal-station .meal-saved')?.open;
      const advancedOpen = !!$('#meal-station .meal-advanced')?.open;
      const transfer = $('#meal-transfer')?.value || '';
      const calculationOpen = !!$('#meal-station .meal-calculation')?.open;
      renderStation(guest);
      $('#meal-context').open = contextOpen;
      $('#meal-station .meal-saved').open = savedOpen;
      $('#meal-station .meal-advanced').open = advancedOpen;
      $('#meal-transfer').value = transfer;
      $('#meal-station .meal-calculation').open = calculationOpen;
    }
    workspaceSignature = signature;
    renderCandidateControls(guest, active);
    renderPreparation(force);
  }
  function refreshCurrent() {
    const focused = document.activeElement;
    const field = focused && focused.dataset && focused.dataset.mealField;
    const id = focused && focused.id;
    workspaceSignature = '';
    if (planTabs.has(state.tab)) renderTab(state.tab);
    else updateWorkspace(true);
    const replacement = field ? document.querySelector('[data-meal-field="' + field + '"]') : id ? document.getElementById(id) : null;
    if (replacement) replacement.focus({ preventScroll: true });
  }
  function choose(kind, id, guestName) {
    let guest = guestName ? guestByName(guestName) : currentGuest();
    if (!guest) { noticeText('先选定具体客人，再组成套餐。'); return; }
    const draft = draftFor(guest);
    if (kind === 'food') {
      const food = getCatalog().getFood(id);
      if (!food || !food.recipeIds.length) return;
      draft.foodId = id; draft.recipeId = food.recipeIds[0]; draft.extras = []; draft.foodPrice = null;
    } else {
      if (!getCatalog().getBeverage(id)) return;
      draft.beverageId = id; draft.beveragePrice = null;
    }
    if (state.serviceGuest !== guest.name || !planTabs.has(state.tab)) {
      ryoteiNavigate(ryoteiHash(kind === 'food' ? 'details' : 'drinkrecs', { who: guest.name, place: 'all' }));
    }
    notice = kind === 'food' ? '料理已选，下一步选酒水。' : '酒水已选，可加料或保存搭配。';
    refreshCurrent();
    $('#meal-station').scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  function preparationEntry(kind, id) {
    const cat = getCatalog();
    if (kind === 'food') {
      const food = cat.getFood(id);
      return food && food.recipeIds.length ? { guestKey: null, draft: { ...emptyDraft(), foodId: id, recipeId: food.recipeIds[0] }, quantity: 1 } : null;
    }
    if (kind === 'beverage' && cat.getBeverage(id)) return { guestKey: null, draft: { ...emptyDraft(), beverageId: id }, quantity: 1 };
    return null;
  }
  function addPreparation(entry) {
    if (!entry) return;
    const signature = JSON.stringify([entry.draft.recipeId, entry.draft.beverageId, entry.draft.extras]);
    const existing = preparation.find(item => JSON.stringify([item.draft.recipeId, item.draft.beverageId, item.draft.extras]) === signature);
    if (existing) existing.quantity++;
    else preparation.push(entry);
    renderPreparation(true);
    noticeText('已加入今晚备菜；份数由你决定，不预测客人刷新数量。');
  }
  function coverage(kind) {
    const names = new Set(dataOf('guests').concat(dataOf('normal')).filter(row => ryoteiVisitsPlace(row)).map(row => row['客人名字'] || row['普通客人']));
    const group = new Map();
    for (const row of kind === 'food' ? buildMealIndex() : buildDrinkRecIndex()) {
      if (!names.has(row['客人名字'])) continue;
      const name = row[kind === 'food' ? '菜品' : '酒水'];
      if (!group.has(name)) group.set(name, { name, id: Number(row[kind === 'food' ? '菜品ID' : '酒水ID']), price: Number(row['价格']), special: [], normal: [] });
      const record = group.get(name);
      (ryoteiNormalNames.has(row['客人名字']) ? record.normal : record.special).push(row['客人名字']);
    }
    return Array.from(group.values()).sort((a, b) => b.special.length + b.normal.length - a.special.length - a.normal.length || a.price - b.price || byLocale(a.name, b.name));
  }
  function coverageList(kind) {
    return coverage(kind).slice(0, 8).map(item => '<li><div><strong>' + ryoteiEntityLink(kind === 'food' ? 'recipe' : 'beverage', item.displayName || item.name) + '</strong><span class="muted">' + item.special.length + ' 稀客 · ' + item.normal.length + ' 普客 · ' + money(item.price) + '</span><details><summary>查看覆盖客人</summary><p>' + esc(item.special.concat(item.normal).join('、')) + '</p></details></div>' + button('prepare-item', '加入备菜', 'data-meal-kind="' + kind + '" data-meal-id="' + item.id + '"') + '</li>').join('');
  }
  function preparationMaterials() {
    const ingredients = new Map(), beverages = new Map(), cookers = new Set();
    for (const entry of preparation) {
      const meal = RyoteiMealDomain.evaluateMeal(getCatalog(), entry.draft, { guestKey: entry.guestKey });
      if (meal.recipe) {
        cookers.add(meal.recipe.cooker.name);
        for (const id of meal.recipe.baseIngredients.concat(entry.draft.extras)) ingredients.set(id, (ingredients.get(id) || 0) + entry.quantity);
      }
      if (meal.beverage) beverages.set(meal.beverage.id, (beverages.get(meal.beverage.id) || 0) + entry.quantity);
    }
    return { ingredients, beverages, cookers };
  }
  function renderPreparation(force = false) {
    const body = $('#night-preparation-body');
    if (!body || !getCatalog()) return;
    const signature = JSON.stringify([state.servicePlace, preparation]);
    if (!force && signature === preparationSignature) return;
    preparationSignature = signature;
    const materials = preparationMaterials();
    $('#night-preparation-count').textContent = preparation.length ? '· ' + preparation.length + ' 项已选' : '· 覆盖与准备清单';
    const selected = preparation.map((entry, index) => {
      const meal = RyoteiMealDomain.evaluateMeal(getCatalog(), entry.draft, { guestKey: entry.guestKey });
      const name = [meal.food && meal.food.name, meal.beverage && meal.beverage.name].filter(Boolean).join(' ＋ ');
      return '<li><span>' + esc(name) + (entry.draft.extras.length ? '<small>加料：' + esc(entry.draft.extras.map(id => getCatalog().getIngredient(id).name).join('、')) + '</small>' : '') + '</span><label>份数<input type="number" min="1" max="999" step="1" value="' + entry.quantity + '" data-prep-index="' + index + '" aria-label="' + escAttr(name) + '准备份数"></label>' + button('remove-preparation', '移除', 'data-meal-index="' + index + '"') + '</li>';
    }).join('');
    const ingredientLines = Array.from(materials.ingredients).map(([id, quantity]) => { const ingredient = getCatalog().getIngredient(id); return '<li>' + ryoteiEntityLink('ingredient', ingredient.name) + '<span>× ' + quantity + '</span></li>'; }).join('');
    const beverageLines = Array.from(materials.beverages).map(([id, quantity]) => { const beverage = getCatalog().getBeverage(id); return '<li>' + ryoteiEntityLink('beverage', beverage.name) + '<span>× ' + quantity + '</span></li>'; }).join('');
    body.innerHTML = '<p class="meal-help">' + (state.servicePlace === 'all' ? '全部地点' : esc(state.servicePlace)) + '可能来访的静态口味覆盖，不是必来概率、最高评价或备货份数。普通客人是否点得起还取决于店铺和本次钱包。</p><div class="prep-coverage-grid"><div><h4>料理覆盖参考</h4><ul class="prep-coverage">' + coverageList('food') + '</ul></div><div><h4>酒水覆盖参考</h4><ul class="prep-coverage">' + coverageList('beverage') + '</ul></div></div><h4>我准备的菜与酒</h4><ul class="prep-selected">' + (selected || '<li class="muted">从候选、覆盖参考或保存套餐加入，份数自己填写。</li>') + '</ul>' + (preparation.length ? '<div class="prep-material-grid"><div><h4>食材汇总</h4><ul>' + ingredientLines + '</ul></div><div><h4>酒水汇总</h4><ul>' + beverageLines + '</ul><h4>所需厨具</h4><p>' + esc(Array.from(materials.cookers).join('、') || '无') + '</p></div></div>' : '');
  }
  function savedKey(record) {
    const draft = record.draft;
    return JSON.stringify([record.guestKey, draft.foodId, draft.recipeId, draft.beverageId, draft.extras, draft.foodRequest, draft.beverageRequest, draft.dailyTrend && [draft.dailyTrend.tagId, draft.dailyTrend.isNegative === true]]);
  }
  function saveLocal() {
    try { localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 1, meals: saved })); return true; }
    catch (_) { noticeText('本机存储不可用；套餐仍在本页，可导出 JSON 备份。'); return false; }
  }
  function safeSaved(input) {
    if (!input || input.schemaVersion !== 1 || !Array.isArray(input.meals) || input.meals.length > 200) throw new Error('不是有效的本站套餐文件，或超过 200 份套餐上限。');
    return input.meals.map((record, index) => {
      const guest = getCatalog().getGuest(record.guestKey);
      if (!guest) throw new Error('套餐客人不存在。');
      const inputDraft = structuredDraft(record.draft);
      if (inputDraft.dailyTrend && typeof inputDraft.dailyTrend.isNegative !== 'boolean' && ['like', 'hate'].includes(inputDraft.dailyTrend.direction)) inputDraft.dailyTrend.isNegative = inputDraft.dailyTrend.direction === 'hate';
      const normalized = RyoteiMealDomain.sanitizeDraft(getCatalog(), inputDraft);
      if (normalized.errors.length || normalized.draft.recipeId == null || normalized.draft.beverageId == null) throw new Error('套餐物品或加料无效。');
      const meal = evaluate(guest, normalized.draft);
      if (meal.errors.length) throw new Error('套餐有成餐冲突或槽位错误。');
      return { id: String(record.id || 'import-' + index).slice(0, 80), guestKey: guest.key, name: String(record.name || guest.name + '套餐').slice(0, 100), draft: { ...normalized.draft, foodPrice: null, beveragePrice: null, free: false } };
    });
  }
  function renderSaved() {
    const list = $('#meal-saved-list');
    if (!list) return;
    list.innerHTML = saved.length ? '<ul class="meal-saved-list">' + saved.map((record, index) => '<li><strong>' + esc(record.name) + '</strong><div>' + button('load-saved', '载入', 'data-meal-index="' + index + '"') + button('prepare-saved', '加入备菜', 'data-meal-index="' + index + '"') + button('delete-saved', '删除', 'data-meal-index="' + index + '"') + '</div></li>').join('') + '</ul>' : '<p class="muted">尚未保存常用套餐。</p>';
    $('#meal-saved-count').textContent = saved.length;
  }
  function handleAction(event) {
    const sorting = event.target.closest('[data-candidate-sort]');
    if (sorting) {
      const key = sorting.dataset.candidateSortKey;
      const field = sorting.dataset.candidateSort;
      const current = state[key] || { key: '', dir: -1 };
      state[key] = { key: field, dir: current.key === field ? -current.dir : -1 };
      if (state.openGuest && key.startsWith('detail') && key !== 'detailSort') renderDetailPane(ryoteiGuestRecord(state.openGuest));
      else renderTab(state.tab);
      return;
    }
    const start = event.target.closest('[data-meal-start]');
    if (start) {
      const name = start.dataset.mealStart || state.openGuest;
      if (!guestByName(name)) return;
      event.preventDefault();
      notice = '先选料理和酒水，再核对当前点单与资金。';
      ryoteiNavigate(ryoteiHash('details', { who: name, place: 'all' }));
      updateWorkspace(true);
      return;
    }
    const target = event.target.closest('[data-meal-action]');
    if (!target) return;
    event.preventDefault();
    const action = target.dataset.mealAction;
    const id = number(target.dataset.mealId);
    const index = Number(target.dataset.mealIndex);
    const kind = target.dataset.mealKind;
    if (action === 'choose') { choose(kind, id, target.dataset.mealGuest); return; }
    if (action === 'prepare-item') { addPreparation(preparationEntry(kind, id)); return; }
    if (action === 'remove-preparation') { preparation.splice(index, 1); renderPreparation(true); return; }
    if (action === 'prepare-saved') { const entry = saved[index]; if (entry) addPreparation({ guestKey: entry.guestKey, draft: structuredDraft(entry.draft), quantity: 1 }); return; }
    if (action === 'load-saved') {
      const record = saved[index];
      if (!record) return;
      const guest = getCatalog().getGuest(record.guestKey);
      drafts.set(guest.key, structuredDraft(record.draft));
      notice = '已载入套餐；没有回写余额或登记消费。';
      ryoteiNavigate(ryoteiHash('details', { who: guest.name, place: 'all' })); refreshCurrent(); return;
    }
    const guest = currentGuest();
    if (!guest) return;
    const draft = draftFor(guest);
    try {
      if (action === 'change-guest') {
        ryoteiNavigate(ryoteiHash('guests', { place: state.servicePlace }));
        return;
      }
      if (action === 'show-tags') { $('#candidate-tag-filters').open = !$('#candidate-tag-filters').open; return; }
      if (action === 'filter-tag') {
        const chips = state[state.tab === 'details' ? 'detailChips' : state.tab === 'drinkrecs' ? 'drinkrecChips' : 'addonChips'];
        const tag = target.dataset.mealTag, at = chips.indexOf(tag);
        if (at < 0) chips.push(tag); else chips.splice(at, 1);
        renderTab(state.tab); return;
      }
      if (action === 'pick-step') {
        if (kind === 'ingredient' && draft.recipeId == null) { noticeText('先选一道料理。'); return; }
        ryoteiNavigate(ryoteiHash(kind === 'food' ? 'details' : kind === 'beverage' ? 'drinkrecs' : 'addons', { who: guest.name }));
        renderTab(state.tab);
        $('#meal-station').scrollIntoView({ block: 'start', behavior: 'instant' });
        return;
      }
      if (action === 'scope') {
        viewFor(guest)[kind] = target.dataset.mealValue;
        const pageKey = kind === 'food' ? 'mealFoodPage' : 'mealBeveragePage';
        delete ryoteiPages[pageKey];
        refreshCurrent();
        return;
      }
      if (action === 'remove-food') { draft.foodId = null; draft.recipeId = null; draft.extras = []; draft.foodPrice = null; }
      else if (action === 'remove-beverage') { draft.beverageId = null; draft.beveragePrice = null; }
      else if (action === 'remove-extra') draft.extras.splice(index, 1);
      else if (action === 'add-extra') {
        const trial = evaluate(guest, { ...draft, extras: draft.extras.concat(id) });
        if (trial.errors.length) { noticeText(trial.errors.map(error => error.message).join('；')); return; }
        draft.extras.push(id);
      } else if (action === 'snapshot') {
        const value = number($('#meal-actual-balance').value);
        if (!Number.isFinite(value) || value < 0) { noticeText('请填写有效的本单前余额；空白不是 0。'); return; }
        sessions.set(guest.key, RyoteiMealDomain.setActualSnapshot(sessionFor(guest), value));
        notice = '已采用本单前余额快照，不重复扣此前账单。';
      } else if (action === 'record') {
        const meal = evaluate(guest);
        if (meal.errors.length || !meal.food || !meal.beverage) { noticeText('先组成无成餐冲突的料理＋酒水套餐再登记。'); return; }
        sessions.set(guest.key, RyoteiMealDomain.recordConsumption(sessionFor(guest), meal));
        notice = '已登记本单消费；再次点击表示确实又消费了一单。';
      } else if (action === 'undo') {
        sessions.set(guest.key, RyoteiMealDomain.undoConsumption(sessionFor(guest)));
        notice = '已撤销最近一次登记。';
      } else if (action === 'new-session') {
        sessions.set(guest.key, RyoteiMealDomain.createSession({ guestKey: guest.key }));
        viewFor(guest).pendingBalance = '';
        draft.foodRequest = null; draft.beverageRequest = null; draft.foodPrice = null; draft.beveragePrice = null; draft.free = false;
        notice = '新一轮就餐：余额、账单与本次要求已清空，保留试配的菜酒。';
      } else if (action === 'prepare-current') {
        const meal = evaluate(guest);
        if (meal.errors.length || !meal.food && !meal.beverage) { noticeText('先选择有效菜酒后加入备菜。'); return; }
        addPreparation({ guestKey: guest.key, draft: structuredDraft(draft), quantity: 1 }); return;
      } else if (action === 'save') {
        const meal = evaluate(guest);
        if (meal.errors.length || !meal.food || !meal.beverage) { noticeText('先组成有效的料理＋酒水套餐再保存。'); return; }
        if (saved.length >= 200) { noticeText('最多保存 200 份套餐，请先删除不需要的条目。'); return; }
        saved.push({ id: 'meal-' + Date.now() + '-' + saved.length, guestKey: guest.key, name: guest.name + ' · ' + meal.food.name + '＋' + meal.beverage.name, draft: { ...structuredDraft(draft), foodPrice: null, beveragePrice: null, free: false } });
        notice = '已保存常用套餐；没有登记消费。'; saveLocal(); renderSaved(); noticeText(notice); return;
      } else if (action === 'delete-saved') { saved.splice(index, 1); saveLocal(); renderSaved(); return; }
      else if (action === 'export') {
        const text = JSON.stringify({ schemaVersion: 1, meals: saved }, null, 2);
        $('#meal-transfer').value = text;
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url; link.download = '夜雀常用套餐.json'; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        noticeText('JSON 已显示在下方，也可保存下载的备份。'); return;
      } else if (action === 'import') {
        const text = $('#meal-transfer').value;
        if (text.length > 500000) throw new Error('导入内容过大。');
        const incoming = safeSaved(JSON.parse(text));
        const keys = new Set(saved.map(savedKey));
        for (const record of incoming) { const key = savedKey(record); if (!keys.has(key) && saved.length < 200) { saved.push(record); keys.add(key); } }
        notice = '已合并有效套餐；原有保存未被覆盖，余额和消费记录不受影响。'; saveLocal(); renderSaved(); noticeText(notice); return;
      }
      if (['snapshot', 'record', 'undo'].includes(action)) {
        renderFacts(guest);
        updateMoneyMode(guest);
        noticeText(notice);
      } else refreshCurrent();
    } catch (error) { noticeText(error.message || '操作未完成，请检查输入。'); }
  }
  function updateMoneyMode(guest) {
    const mode = RyoteiMealDomain.budgetFacts(guest, sessionFor(guest), evaluate(guest)).mode;
    for (const input of document.querySelectorAll('input[name="meal-budget-mode"]')) input.checked = input.value === mode;
  }
  function structuredDraft(draft) { return JSON.parse(JSON.stringify(draft)); }
  function handleChange(event) {
    const quantity = event.target.closest('[data-prep-index]');
    if (quantity) {
      const value = Number(quantity.value);
      if (!Number.isInteger(value) || value < 1 || value > 999) { quantity.value = preparation[Number(quantity.dataset.prepIndex)].quantity; return; }
      preparation[Number(quantity.dataset.prepIndex)].quantity = value; renderPreparation(true); return;
    }
    const guest = currentGuest();
    if (!guest) return;
    const draft = draftFor(guest);
    if (event.target.name === 'meal-budget-mode') {
      const mode = event.target.value;
      if (mode === 'range') {
        const old = sessionFor(guest);
        sessions.set(guest.key, { ...old, priorSpend: 0, priorConfirmed: true, ledgerComplete: true, actualBalance: null, actualSnapshot: null });
        notice = '已确认从首单完整记录；按无额外资金修正的基础范围估算。';
      } else if (mode === 'unknown') {
        const old = sessionFor(guest);
        sessions.set(guest.key, { ...old, priorSpend: null, priorConfirmed: false, ledgerComplete: false, actualBalance: null, actualSnapshot: null });
        notice = '当前剩余资金按未知处理，已登记账单保留。';
      } else { $('#meal-actual-balance').focus(); return; }
      renderFacts(guest); noticeText(notice); return;
    }
    const field = event.target.dataset.mealField;
    if (!field) return;
    if (field === 'free') draft.free = event.target.checked;
    else if (field === 'trendTag') draft.dailyTrend = event.target.value === '' ? null : { tagId: Number(event.target.value), isNegative: draft.dailyTrend && draft.dailyTrend.isNegative === true };
    else if (field === 'trendDirection') { if (draft.dailyTrend) draft.dailyTrend.isNegative = event.target.value === 'hate'; }
    else { draft[field] = number(event.target.value); if (field === 'recipeId') { const recipe = getCatalog().getRecipe(draft.recipeId); draft.foodId = recipe.foodId; draft.extras = []; } }
    if (field === 'recipeId') {
      refreshCurrent();
    } else {
      renderFacts(guest);
      updateSelectedVisuals(guest);
      if (state.tab === 'addons') renderCandidates('ingredient');
    }
  }
  function updateSelectedVisuals(guest) {
    const meal = evaluate(guest);
    const items = document.querySelectorAll('#meal-station .meal-selected-mini');
    for (const [index, kind] of ['food', 'beverage'].entries()) {
      const item = items[index];
      if (!item || !(kind === 'food' ? meal.food : meal.beverage)) continue;
      const price = item.querySelector('.price-value');
      const tags = item.querySelector('.tag-wrap');
      if (price) price.textContent = money(meal.price[kind]);
      if (tags) tags.innerHTML = tagList(kind, meal.tags[kind], kind === 'food' ? 'neutral' : 'drink');
    }
  }
  function init() {
    if (ready) return;
    getCatalog();
    try { const text = localStorage.getItem(storageKey); if (text) saved = safeSaved(JSON.parse(text)); }
    catch (_) { notice = '本地套餐未能载入；可继续使用或从 JSON 导入。'; }
    ready = true;
    document.addEventListener('click', handleAction);
    document.addEventListener('change', handleChange);
    document.addEventListener('input', event => {
      const guest = currentGuest();
      if (guest && event.target.id === 'meal-actual-balance') viewFor(guest).pendingBalance = event.target.value;
      if (event.target.dataset && event.target.dataset.candidateField) {
        state[event.target.dataset.candidateField] = event.target.value;
        renderTab(state.tab);
      }
    });
    document.addEventListener('keydown', event => {
      const header = event.target.closest('th[data-sort]');
      if (header && ['Enter', ' '].includes(event.key)) { event.preventDefault(); header.click(); }
    });
    for (const name of ['detail-search', 'drinkrec-search', 'addon-search']) {
      const input = document.getElementById(name);
      if (input) input.addEventListener('input', () => { if (currentGuest()) scrollToCandidates(); });
    }
    const start = $('#detail-meal-start');
    if (start) start.dataset.mealStart = state.openGuest;
    const detailTitle = $('#detail-title');
    if (detailTitle && typeof MutationObserver !== 'undefined') new MutationObserver(() => { if (start) start.dataset.mealStart = state.openGuest; }).observe(detailTitle, { childList: true });
    const originalMealTable = ryoteiDetailMealTable;
    const originalDrinkTable = ryoteiDetailDrinkTable;
    ryoteiDetailMealTable = (name, list) => candidateDetailTable('food', name, list, originalMealTable);
    ryoteiDetailDrinkTable = (name, list) => candidateDetailTable('beverage', name, list, originalDrinkTable);
    if (planTabs.has(state.tab)) renderTab(state.tab);
    updateWorkspace(true);
  }
  function candidateDetailTable(kind, name, rows, fallback) {
    if (!rows.length) return fallback(name, rows);
    return renderCardList(kind, rows, guestByName(name), true);
  }
  function renderSignature(tab) {
    if (!ready || !planTabs.has(tab)) return '';
    const guest = currentGuest();
    return guest ? JSON.stringify([guest.key, draftFor(guest), viewFor(guest).food, viewFor(guest).beverage]) : '';
  }
  function extendCandidateColumns(kind, columns) {
    if (!ready) return columns;
    return columns.concat([
      { key: '__budget', label: '单品资金参考', render: row => candidateBudget(row['客人名字'], row['价格']) },
      { key: '__choose', label: '配餐与准备', render: row => candidateActions(kind, row) }
    ]);
  }
  function renderOverview(kind, rows) {
    return renderCardList(kind, rows, null, false);
  }
  return { init, updateWorkspace, renderCandidates, candidateBudget, candidateActions, renderSignature, extendCandidateColumns, renderOverview };
})();
