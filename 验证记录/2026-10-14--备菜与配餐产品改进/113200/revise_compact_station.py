from pathlib import Path

root = Path(__file__).resolve().parents[3]
path = root / '脚本' / 'ryotei_meal_ui.js'
source = path.read_text(encoding='utf-8')
start = source.index('  function itemCard(')
end = source.index('  function readReceipts(', start)
source = source[:start] + '''  function itemCard(guest, kind, meal) {
    const item = kind === 'food' ? meal.food : meal.beverage;
    const label = kind === 'food' ? '料理' : '酒水';
    return '<div class="meal-selected-mini">' + (item ? itemIcon(item) : '<span class="meal-empty-icon">＋</span>') +
      '<div><span class="meal-eyebrow">' + label + '</span><strong>' + (item ? esc(item.displayName || item.name) : '还没选') + '</strong></div>' +
      (item ? '<span class="price-value">' + money(meal.price[kind]) + '</span>' + button('remove-' + kind, '×', 'aria-label="移除已选' + label + '"') : '') + '</div>';
  }
''' + source[end:]
start = source.index('  function renderStation(')
end = source.index('  function requestFact(', start)
source = source[:start] + '''  function renderStation(guest) {
    const draft = draftFor(guest), session = sessionFor(guest), meal = evaluate(guest);
    const kind = state.tab === 'drinkrecs' ? 'beverage' : state.tab === 'addons' ? 'ingredient' : 'food';
    const step = (value, title, chosen) => '<button class="meal-step' + (kind === value ? ' active' : '') + '" type="button" data-meal-action="pick-step" data-meal-kind="' + value + '" aria-pressed="' + (kind === value) + '"><span>' + (value === 'food' ? '1' : value === 'beverage' ? '2' : '3') + '</span>' + title + '<small>' + esc(chosen) + '</small></button>';
    const station = $('#meal-station');
    station.innerHTML = '<div class="meal-station-head"><h3>' + esc(guest.name) + '<span class="meal-guest-range">' + (guest.budgetRange ? '钱包范围 ' + guest.budgetRange.join('–') : '钱包未知') + '</span></h3>' + button('new-session', '新一桌') + '</div>' +
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
''' + source[end:]
start = source.index('  function budgetHTML(')
end = source.index('  function candidateColumns(', start)
source = source[:start] + '''  function budgetHTML(guest, facts, meal) {
    const compare = baseComparison(guest, meal.price.total);
    if (facts.remaining) {
      const before = facts.remaining.min === facts.remaining.max ? money(facts.remaining.min) : facts.remaining.min + '–' + facts.remaining.max + ' 元';
      const after = facts.after ? facts.after.min === facts.after.max ? money(facts.after.min) : facts.after.min + '–' + facts.after.max + ' 元' : '未选齐';
      return '<div class="meal-budget-brief"><span>' + (facts.mode === 'actual' ? '余额 ' : '估算余额 ') + before + '</span><strong class="' + (facts.risk === 'over-upper' ? 'meal-caution' : '') + '">上这单后 ' + after + '</strong></div>';
    }
    return '<div class="meal-budget-brief"><span>钱包未知</span>' + (compare.code === 'over' ? '<strong class="meal-caution">这份超基础预算，可选但可能收不满</strong>' : compare.code === 'maybe' ? '<span>可能超预算</span>' : '<span>可在“点单要求 / 钱包”填写余额</span>') + '</div>';
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
''' + source[end:]
path.write_text(source, encoding='utf-8')
print('COMPACT_STATION_WRITTEN')
