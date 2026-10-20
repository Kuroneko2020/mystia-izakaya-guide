/* action/budget 回调只接受站内可信呈现函数；候选集合与排序由调用方决定。 */
const RyoteiCandidateCards = (() => {
  const defaults = {
    food: { name: '菜品', id: '菜品ID', link: 'recipe', mainSort: 'detailSort', detailSort: 'detailMealSort' },
    ingredient: { name: '食材', id: '食材ID', link: 'ingredient', mainSort: 'addonSort', detailSort: 'detailAddonSort' },
    beverage: { name: '酒水', id: '酒水ID', link: 'beverage', mainSort: 'drinkrecSort', detailSort: 'detailDrinkSort' }
  };
  const text = value => Array.isArray(value) ? value.map(text).join('、')
    : value && typeof value === 'object' ? String(value.displayName || value.name || '') : String(value ?? '');
  const present = value => value != null && text(value).trim() !== '';
  const pick = (row, keys) => {
    for (const key of keys) if (key && present(row[key])) return row[key];
    return '';
  };
  const field = (option, kind, fallback) => (typeof option === 'string' ? option : option?.[kind]) || fallback;
  const tags = value => text(value).split(/[、,，；;\n]/).map(item => item.trim())
    .filter(item => item && !['无', '无新增'].includes(item));
  const short = (value, limit = 44) => {
    const chars = Array.from(text(value).replace(/\s+/g, ' ').trim());
    return chars.length > limit ? chars.slice(0, limit).join('') + '…' : chars.join('');
  };
  const chips = (value, style, limit) => {
    const list = tags(value);
    return list.length ? tagHtml(list.join('、'), style, limit ?? list.length) : '';
  };
  const htmlFrom = (callback, row) => typeof callback === 'function' ? String(callback(row) ?? '') : '';

  function sortBar(options, sortKey) {
    const fields = [[options.priceField || '价格', '价格'], [options.matchCountField || '命中数', '匹配'], [options.levelField || '等级', '等级']];
    const sorting = options.sort || {};
    return '<div class="candidate-sort" role="group" aria-label="候选排序">' + fields.map(([key, label]) => {
      const active = sorting.key === key || (key === '命中数' && sorting.key === '命中喜好');
      const mark = active ? '<span aria-hidden="true">' + (sorting.dir > 0 ? ' ▲' : ' ▼') + '</span>' : '';
      return '<button type="button" data-candidate-sort="' + escAttr(key) + '" data-candidate-sort-key="' + escAttr(sortKey) + '" aria-pressed="' + active + '"' +
        (active ? ' class="active"' : '') + '>' + esc(label) + mark + '</button>';
    }).join('') + '</div>';
  }

  function card(kind, row, options, config, nameField, itemKind) {
    const ingredient = kind === 'ingredient';
    const name = text(pick(row, [nameField, 'displayName', 'name']));
    const id = pick(row, [field(options.idField, kind, config.id), 'id']);
    const guest = text(pick(row, ['客人名字', 'guestName']));
    const price = pick(row, [options.priceField || '价格', 'price']);
    const level = pick(row, [options.levelField || '等级', 'level']);
    const cooker = pick(row, ['厨具', 'cooker']);
    const ingredients = pick(row, ['主料', 'baseIngredients']);
    const allTags = pick(row, [ingredient ? '食材标签' : kind === 'food' ? '菜品标签' : '标签', '标签', 'tags']);
    const matched = pick(row, ['命中喜好', 'matchedTags']);
    const dislikes = pick(row, ['命中厌恶', '新增厌恶', '厌恶标签', '厌恶料理标签', '厌恶酒水标签', '厌恶', 'dislikes']);
    const conflicts = pick(row, ['冲突标签（加料会变黑暗物质）', '冲突标签', 'conflicts']);
    const effect = pick(row, ['效果', 'effect']);
    const added = pick(row, ['新增标签', 'newTags']);
    const lost = pick(row, ['失去标签', 'lostTags']);
    const selected = options.selectedId != null && present(id) && String(id) === String(options.selectedId);
    const icons = typeof window === 'undefined' ? {} : window.WAFU_ASSETS?.icons || {};
    const icon = icons[name];
    const image = icon ? '<img class="candidate-card-icon" src="' + escAttr(icon) + '" alt="" width="28" height="28" loading="lazy">' : '';
    const priceHTML = present(price) ? '<span class="candidate-card-price' + (ingredient ? ' secondary' : ' price-value') + '">' +
      (ingredient ? '材料价 ' : '') + esc(price) + '<small> 元</small></span>' : '';
    const levelHTML = present(level) ? '<span class="candidate-card-level">' + (/^Lv\s/i.test(text(level)) ? esc(level) : 'Lv ' + esc(level)) + '</span>' : '';
    const budget = htmlFrom(options.budget, row);
    const action = htmlFrom(options.action, row);
    const effectClass = row.__canAdd === false ? ' meal-invalid' : row.__warning ? ' meal-caution' : '';
    const resources = [short(cooker, 16), short(ingredients, 44)].filter(Boolean).join(' · ');
    const meta = (ingredient ? priceHTML : '') + levelHTML + (guest && options.context !== 'detail' && options.showGuest !== false ? '<span class="candidate-card-guest">' + esc(guest) + '</span>' : '');
    const detailKey = typeof options.detailKey === 'function' ? options.detailKey(row) : JSON.stringify([kind, guest, present(id) ? id : name, row['食谱ID'] ?? row.recipeId ?? '']);
    const details = [];
    const addText = (label, value) => {
      if (present(value)) details.push('<div class="candidate-card-field"><dt>' + esc(label) + '</dt><dd>' + esc(text(value)) + '</dd></div>');
    };
    const addTags = (label, value, style = 'neutral') => {
      const content = chips(value, style);
      if (content) details.push('<div class="candidate-card-field"><dt>' + esc(label) + '</dt><dd class="tag-wrap">' + content + '</dd></div>');
    };
    addText('厨具', cooker);
    addText('主料', ingredients);
    addTags('完整标签', allTags, kind === 'beverage' ? 'drink' : 'neutral');
    addTags('命中喜好', matched, 'good');
    addTags('厌恶命中 / 提示', dislikes, 'bad');
    addTags('冲突标签', conflicts, 'bad');
    if (ingredient) {
      addText('成餐效果', effect);
      addTags('加入后新增', added, 'good');
      addTags('加入后消失', lost, 'bad');
    }
    // 只列有信息的字段，不复制整行或重复的通用“加料建议”生成文案。
    addText('适用料理', pick(row, ['适用推荐菜', '推荐菜']));
    addText('补足标签', row['补足标签']);
    addText('解锁来源', pick(row, ['解锁来源', 'unlockSource']));
    addText('获取方式', pick(row, ['获取方式', 'acquisition']));
    addText('资料来源', pick(row, ['备注/来源', '资料来源', '来源', 'source']));
    addText('描述', pick(row, ['描述', 'description']));
    addText('备注', row['备注']);
    addText('原始推荐', row['原始推荐']);
    const changes = ingredient ? [tags(added).length ? '新增 ' + short(added, 24) : '', tags(lost).length ? '消失 ' + short(lost, 24) : ''].filter(Boolean) : [];
    const matches = chips(matched, 'good', 3);
    return '<article class="candidate-card' + (selected ? ' is-selected' : '') + '" data-candidate-kind="' + escAttr(kind) + '" data-candidate-id="' + escAttr(id) + '">' +
      '<div class="candidate-card-main"><div class="candidate-card-head">' + image + '<strong class="candidate-card-name">' + ryoteiEntityLink(itemKind, name) + '</strong>' + (!ingredient ? priceHTML : '') + '</div>' +
      (resources ? '<p class="candidate-card-resource">' + esc(resources) + '</p>' : '') +
      (meta ? '<div class="candidate-card-meta">' + meta + '</div>' : '') +
      (ingredient && present(effect) ? '<p class="candidate-card-effect' + effectClass + '">' + esc(short(effect, 36)) + '</p>' : '') +
      (changes.length ? '<div class="candidate-card-changes">' + changes.map(value => '<span>' + esc(value) + '</span>').join('') + '</div>' : '') +
      (matches ? '<div class="candidate-card-matches tag-wrap">' + matches + '</div>' : '') +
      (budget ? '<div class="candidate-card-budget">' + budget + '</div>' : '') +
      (details.length ? '<details class="candidate-card-details" data-candidate-detail-key="' + escAttr(detailKey) + '"><summary>详情' + (tags(matched).length > 3 ? ' · 全部喜好' : '') + '</summary><dl>' + details.join('') + '</dl></details>' : '') +
      '</div><div class="candidate-card-actions">' + action + '</div></article>';
  }

  /**
   * render(kind: 'food'|'ingredient'|'beverage', rows: Array, options = {}) -> HTML string
   * options: nameField/idField/itemKind 可传字符串或按 kind 映射；selectedId 标记 is-selected。
   * action/budget(row) -> 可信 HTML；sort?: {key,dir} 仅标示当前排序，事件由主线处理。
   * sortKey/pageKey 原样交给 ryoteiTablePage；context: 'main'（默认）|'detail' 决定默认键。
   * 默认每页 50 的现有 footer 保留全部候选；分页不是推荐数量上限。
   */
  function render(kind, rows, options = {}) {
    const config = defaults[kind];
    if (!config) throw new TypeError('Unknown candidate kind: ' + kind);
    const context = options.context === 'detail' ? 'detail' : 'main';
    const sortKey = options.sortKey || (context === 'detail' ? config.detailSort : config.mainSort);
    const pageKey = options.pageKey || sortKey;
    const nameField = field(options.nameField, kind, config.name);
    const itemKind = field(options.itemKind, kind, config.link);
    const page = ryoteiTablePage([{ key: nameField, sortKey, pageKey }], rows);
    return '<section class="candidate-cards" data-candidate-context="' + context + '" data-candidate-page-key="' + escAttr(pageKey) + '">' +
      sortBar(options, sortKey) + '<div class="candidate-card-list">' +
      (page.rows.length ? page.rows.map(row => card(kind, row, options, config, nameField, itemKind)).join('') : '<div class="empty-state">没有符合当前筛选的候选。</div>') +
      '</div>' + page.footer + '</section>';
  }
  return { render };
})();
