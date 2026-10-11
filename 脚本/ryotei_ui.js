/* 料亭版呈现层：筛选侧栏、全量口味名单和可比较的价格。 */
const RYOTEI_CHAPTERS = {
  guests:['客人名簿','先记住口味与预算，再为今夜备菜。','客'],
  details:['备菜手帖','至少命中一项固定喜好且无已知厌恶标签，不限价格和数量。','菜'],
  catalog:['料理目录','翻看菜品等级、材料与标签，选好今晚的菜单。','菜'],
  ingredients:['食材篮','查价格、口味标签和获取方式，为料理补上一味。','料'],
  beverages:['酒水单','从口味、等级和价格，挑选合适的一杯。','酒'],
  addons:['加料参考','围绕客人口味，查看适用食材与补足标签。','料'],
  drinkrecs:['客人酒单','查看每位客人的推荐酒水与命中喜好。','酒'],
  normal:['常客名簿','普通客人的料理与酒水偏好，也值得记下来。','客'],
  new440:['新页拾遗','v4.4.0 的新增内容与获取说明。','新'],
  guides:['旧版攻略','保留不同版本的原文，便于交叉查阅。','考'],
  sources:['资料出处','查看数据版本、来源与整理说明。','录']
};

function updateRyoteiHeading(tab){
  const item = RYOTEI_CHAPTERS[tab] || RYOTEI_CHAPTERS.guests;
  const group = ryoteiGroup(tab);
  $('#ryotei-page-title').textContent = group === 'reference' ? item[0] : RYOTEI_GROUPS[group].label;
  $('#ryotei-chapter-stamp').textContent = item[2] + '录';
  $('#ryotei-page-code').textContent = 'CHAPTER ' + String(TAB_IDS.indexOf(tab) + 1).padStart(2,'0');
  updateRyoteiNavigation(tab);
}

function ryoteiFiltersInit(){
  const aside = $('#workbench-filters');
  for (const panel of $$('.tab-panel')) {
    const toolbar = panel.querySelector(':scope > .toolbar');
    if (!toolbar) continue;
    toolbar.dataset.filterTab = panel.id.replace('panel-','');
    $('#page-filters').appendChild(toolbar);
  }
  $('#filter-visitors').appendChild($('#service-visitors'));
  for (const toolbar of $$('#page-filters > .toolbar')) {
    const bar=toolbar.querySelector('.tag-filter-bar');
    if (!bar) continue;
    bar.dataset.filterTab=toolbar.dataset.filterTab;
    $('#filter-tags').appendChild(bar);
  }
  $('#filter-sections').addEventListener('click',event=>{
    const button=event.target.closest('[data-filter-section]');
    if (button) { aside.dataset.section=button.dataset.filterSection;ryoteiUpdateFilters(state.tab); }
  });
  const setOpen = open=>{
    aside.classList.toggle('filters-open',open);
    $('#filter-toggle').setAttribute('aria-expanded',String(open));
    $('#filter-backdrop').hidden=!open;
    if (open) ($('#page-filters .toolbar:not([hidden]) input') || $('#service-place')).focus({preventScroll:true});
    else $('#filter-toggle').focus({preventScroll:true});
  };
  $('#filter-toggle').addEventListener('click',()=>setOpen(!aside.classList.contains('filters-open')));
  $('#filter-close').addEventListener('click',()=>setOpen(false));
  $('#filter-backdrop').addEventListener('click',()=>setOpen(false));
  document.addEventListener('keydown',event=>{if (event.key==='Escape' && aside.classList.contains('filters-open')) setOpen(false);});
  window.matchMedia('(max-width:1000px)').addEventListener('change',event=>{if (!event.matches) ryoteiCloseFilters();});
}
function ryoteiCloseFilters(){
  $('#workbench-filters').classList.remove('filters-open');
  $('#filter-backdrop').hidden=true;
  $('#filter-toggle').setAttribute('aria-expanded','false');
}
function ryoteiUpdateFilters(tab){
  for (const toolbar of $$('#page-filters > .toolbar')) toolbar.hidden=toolbar.dataset.filterTab !== tab;
  // 营业图鉴的人物页签没有筛选侧栏，“今晚开店”跟随标题行显示；备菜表页放回侧栏顶部。
  const inHead = ['guests','normal'].includes(tab);
  const planTab = ['details','drinkrecs','addons'].includes(tab);
  const context = $('#service-context');
  const filterHost = $('#workbench-filters');
  if (context.parentElement !== (inHead ? $('#ryotei-head-tools') : filterHost)) {
    (inHead ? $('#ryotei-head-tools') : filterHost).insertBefore(context,inHead ? $('#section-nav') : $('#page-filters'));
  }
  const hasFilters=!inHead && !!$('#page-filters > .toolbar:not([hidden])');
  $('#workbench-filters').hidden=!hasFilters;
  $('#filter-toggle').hidden=!hasFilters;
  $('#ryotei-workbench').classList.toggle('has-filters',hasFilters);
  if (!hasFilters) ryoteiCloseFilters();
  const aside=filterHost;
  const visitors=planTab && state.servicePlace !== 'all';
  // 人物页与备菜表页同组切换也要重置选客/标签分区，缓存键按页面形态区分。
  const viewKey=(planTab ? 'plan' : 'cards') + ':' + (inHead ? 'head' : 'side');
  if (aside.dataset.place !== state.servicePlace || (visitors && aside.dataset.viewKey !== viewKey)) {
    aside.dataset.place=state.servicePlace;
    aside.dataset.section=visitors ? 'visitors' : 'tags';
    $('.filter-content').scrollTop=0;
  }
  if (!visitors) aside.dataset.section='tags';
  aside.dataset.viewKey=viewKey;
  const showVisitors=visitors && aside.dataset.section !== 'tags';
  $('#filter-sections').hidden=!visitors;
  $('#filter-visitors').hidden=!showVisitors;
  $('#filter-tags').hidden=showVisitors;
  for (const button of $$('[data-filter-section]')) {
    const active=(button.dataset.filterSection==='visitors')===showVisitors;
    button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
  }
  for (const bar of $$('#filter-tags > .tag-filter-bar')) bar.hidden=bar.dataset.filterTab !== tab;
}

function ryoteiFace(name, kind='avatars'){
  const avatar = (window.WAFU_ASSETS && window.WAFU_ASSETS[kind] && window.WAFU_ASSETS[kind][name]) || '';
  return avatar ? '<span class="ava' + (kind === 'normal' ? ' normal-avatar' : '') + '"><img src="' + avatar + '" alt="" loading="lazy"></span>'
    : '<span class="seal" style="--pc:' + guestColor(name) + '">' + esc(name.charAt(0)) + '</span>';
}

function renderRyoteiGuestCard(guest,index){
  const name = guest['客人名字'];
  // 动态趋势仍显示；将固定口味排在前面，原筛选字段完全不变。
  const staticFirst = (value) => splitTags(value).sort((a,b) => Number(/动态/.test(a)) - Number(/动态/.test(b))).join('、');
  return '<button class="guest-card" style="--i:' + Math.min(index || 0,12) + '" type="button" data-guest="' + escAttr(name) + '">' +
    '<div class="guest-card-top"><div class="guest-id">' + ryoteiFace(name) + '<div><h3>' + esc(name) + '</h3><div class="guest-submeta">' + esc(ryoteiTypeLabel(guest['类型'])) + '</div></div></div><span class="guest-sigil" aria-hidden="true">客帖</span></div>' +
    '<div class="guest-facts"><div class="guest-location"><span class="fact-label">出没地点</span><span class="location" title="' + escAttr(guest['出没地点']) + '">' + esc(guest['出没地点']) + '</span></div><div class="guest-budget"><span class="fact-label">持有金</span><strong>' + esc(guest['持有金']) + '</strong></div></div>' +
    '<div class="tag-row"><span class="tag-label good">喜好</span><div class="tag-wrap">' + tagHtml(staticFirst(guest['喜好料理标签']),'good',5) + '</div></div>' +
    '<div class="tag-row"><span class="tag-label bad">厌恶</span><div class="tag-wrap">' + tagHtml(staticFirst(guest['厌恶料理标签']),'bad',4) + '</div></div>' +
    '<div class="guest-card-foot"><span>口味 · 料理 · 酒水 · 羁绊</span><span class="hint">详情 ↗</span></div></button>';
}

function renderRyoteiGuestDetail(guest){
  const name = guest['客人名字'];
  $('#detail-title').textContent = name;
  // 副标题只留类型与持有金；版本字样按用户要求全站移除，来访地区并入口味区。
  $('#detail-sub').innerHTML = esc(ryoteiTypeLabel(guest['类型'])) + ' · 持有金 <strong>' + esc(guest['持有金']) + '</strong>';
  const seal = $('#detail-seal');
  const avatar = (window.WAFU_ASSETS.avatars || {})[name];
  seal.classList.toggle('is-ava',!!avatar);
  seal.innerHTML = avatar ? '<img src="' + avatar + '" alt="">' : esc(name.charAt(0));
  seal.style.setProperty('--pc',guestColor(name));
  // 口味常驻头部：玩家打开详情第一眼要的就是来访地区与喜好/厌恶。
  const placeRow = '<div class="taste-row"><span class="tag-label">来访</span><div class="tag-wrap">' +
    (name === '因幡帝' ? '<span class="muted">全部地区（随机出现）</span>' : ryoteiLocationLinks(guest['出没地点'])) + '</div></div>';
  const tasteRow = (label,kind,value) => '<div class="taste-row"><span class="tag-label ' + kind + '">' + label + '</span><div class="tag-wrap">' + tagHtml(value,kind) + '</div></div>';
  $('#detail-tastes').innerHTML =
    placeRow +
    tasteRow('喜好料理','good',guest['喜好料理标签']) +
    tasteRow('厌恶','bad',guest['厌恶料理标签']) +
    tasteRow('喜好酒水','drink',guest['喜好酒水标签']);
  $$('#detail-tabs [data-detail-tab]').forEach(button=>
    button.classList.toggle('active',button.dataset.detailTab === state.detailTab));
  renderDetailPane(guest);
}

function renderDetailPane(guest){
  const name = guest['客人名字'];
  const body = $('#detail-body');
  const pane = (id,toolbar,scroll) => '<div class="detail-pane" id="' + id + '">' +
    (toolbar ? '<div class="detail-toolbar">' + toolbar + '</div>' : '') +
    '<div class="detail-scroll" data-name="' + escAttr(state.openGuest) + '">' + scroll + '</div></div>';
  let html = '';
  if (state.detailTab === 'meals') {
    const list = ryoteiDetailMealList(name);
    const chips = ryoteiDetailChipBar('meal',name);
    // 排序在表头点击切换（新列默认降序、同列再点切换），默认价格从高到低；不再使用下拉。
    const toolbar = '<input id="detail-meal-search" type="search" placeholder="搜索菜名、主料或标签" aria-label="搜索推荐料理" value="' + escAttr(state.detailMealQuery || '') + '">' +
      '<span id="detail-meal-count" class="detail-count">' + list.length + ' 道</span>' + chips;
    html = pane('guest-meals',toolbar,ryoteiDetailMealTable(name,list));
  } else if (state.detailTab === 'drinks') {
    const list = ryoteiDetailDrinkList(name);
    const chips = ryoteiDetailChipBar('drink',name);
    const toolbar = '<input id="detail-drink-search" type="search" placeholder="搜索酒水或标签" aria-label="搜索推荐酒水" value="' + escAttr(state.detailDrinkQuery || '') + '">' +
      '<span id="detail-drink-count" class="detail-count">' + list.length + ' 款</span>' + chips;
    html = pane('guest-drinks',toolbar,ryoteiDetailDrinkTable(name,list));
  } else if (state.detailTab === 'addons') {
    html = pane('guest-addons','',
      (guest['拿手菜/额外喜好标签'] ? '<div class="callout detail-handnote"><strong>拿手 / 额外喜好：</strong>' + ryoteiLinkedText(guest['拿手菜/额外喜好标签']) + '</div>' : '') +
      addonTableForGuest(name) +
      '<details class="guide-card" style="margin-top:10px"><summary><span class="guide-name">原始加料建议</span></summary><div class="guide-card-body">' +
      lines(guest['加料推荐']).map((s) => '<div class="dish-line">' + ryoteiLinkedText(s.replace(/(?:前期|后期)示例/g,'配菜示例')) + '</div>').join('') + '</div></details>');
  } else {
    const fold = (title,text) => '<details class="guide-card"><summary><span class="guide-name">' + title + '</span></summary><div class="guide-card-body"><div class="field"><div class="value">' + ryoteiLinkedText(text || '无') + '</div></div></div></details>';
    let bonds = fold('奖励符卡',guest['奖励符卡']) + fold('惩罚符卡',guest['惩罚符卡']) + fold('羁绊等级解锁',guest['羁绊等级解锁']);
    if (guest['B站2024攻略菜品（对照，原文）'] && guest['B站2024攻略菜品（对照，原文）'] !== '无（该攻略早于4.4.0）') {
      bonds += '<h3 class="detail-pane-title">攻略对照</h3>' + fold('B 站 2024 原文推荐',guest['B站2024攻略菜品（对照，原文）']);
    }
    bonds += '<h3 class="detail-pane-title">备注与来源</h3><div class="callout">' + esc(guest['备注/来源'] || '') + '</div>';
    html = pane('guest-bonds','',bonds);
  }
  // paneGuest 只记录详情面板当前渲染的客人（页签切换清空回顶）；
  // 不能复用 detailGuest——那是备菜页筛选与路由键，写它会触发 applyRoute 修复并整页重渲染。
  const previousScroll = state.paneGuest === name ? (body.querySelector('.detail-scroll')||{}).scrollTop || 0 : 0;
  body.innerHTML = html;
  body.querySelector('.detail-scroll').scrollTop = previousScroll;
  state.paneGuest = name;
}

/* 详情列表：筛选（搜索+标签）与排序在客人切换时保留排序、清空过滤词。 */
function ryoteiDetailMealList(name){
  const q = String(state.detailMealQuery || '').trim().toLowerCase();
  let list = buildMealIndex().filter((r) => r['客人名字'] === name);
  list = list.filter((row) => {
    if (!matchesTagChips(row, state.detailMealChips || [], ['菜品标签'])) return false;
    return matchesRowQuery(row, q, ['菜品','等级','主料','菜品标签','命中喜好','解锁来源']);
  });
  const sort = state.detailMealSort || { key: '价格', dir: -1 };
  return sortObjects(list, sort.key, sort.dir);
}
function ryoteiDetailDrinkList(name){
  const q = String(state.detailDrinkQuery || '').trim().toLowerCase();
  let list = buildDrinkRecIndex().filter((r) => r['客人名字'] === name);
  list = list.filter((row) => {
    if (!matchesTagChips(row, state.detailDrinkChips || [], ['标签'])) return false;
    return matchesRowQuery(row, q, ['酒水','标签','命中喜好','原始推荐']);
  });
  const sort = state.detailDrinkSort || { key: '价格', dir: -1 };
  return sortObjects(list, sort.key, sort.dir);
}
function ryoteiDetailChipBar(kind,name){
  const chipsKey = kind === 'meal' ? 'detailMealChips' : 'detailDrinkChips';
  const chips = state[chipsKey] || [];
  const source = kind === 'meal'
    ? buildMealIndex().filter((r) => r['客人名字'] === name)
    : buildDrinkRecIndex().filter((r) => r['客人名字'] === name);
  const tags = new Set();
  source.forEach((row) => splitTags(kind === 'meal' ? row['菜品标签'] : row['标签']).forEach((t) => tags.add(t)));
  const sorted = Array.from(tags).sort(byLocale);
  if (!sorted.length) return '';
  return '<div class="detail-chips" role="group" aria-label="按标签筛选">' + sorted.map((tag) =>
    '<button type="button" class="tag ' + (kind === 'meal' ? 'neutral' : 'drink') + (chips.includes(tag) ? ' chip active' : '') + '" data-detail-chip="' + escAttr(tag) + '" aria-pressed="' + chips.includes(tag) + '">' + esc(tag) + '</button>').join('') +
    (chips.length ? '<button type="button" class="tag chip" data-detail-chip-clear>清空 ×</button>' : '') + '</div>';
}
function ryoteiDetailMealTable(name,list){
  if (!list.length) {
    return buildMealIndex().some((r) => r['客人名字'] === name)
      ? '<div class="empty-state">没有匹配的推荐料理，试试清空搜索或标签。</div>'
      : '<div class="empty-state">暂无推荐菜谱明细。</div>';
  }
  // 版本列与“加料建议”整列移除；价格/命中数/等级列头可点击切换排序。
  const columns = [
    { key: '菜品', label: '菜品' }, { key: '等级', label: '等级', num: true, level: true, sortable: true, sortKey: 'detailMealSort' },
    { key: '价格', label: '价格', num: true, sortable: true, sortKey: 'detailMealSort' },
    { key: '厨具', label: '厨具' }, { key: '主料', label: '主料' },
    { key: '菜品标签', label: '菜品标签', tags: true }, { key: '命中喜好', label: '命中喜好', tags: true, tagKind: 'good' },
    { key: '命中数', label: '命中数', num: true, sortable: true, sortKey: 'detailMealSort' }
  ];
  return makeTable(columns, list);
}
function ryoteiDetailDrinkTable(name,list){
  if (!list.length) {
    return buildDrinkRecIndex().some((r) => r['客人名字'] === name)
      ? '<div class="empty-state">没有匹配的推荐酒水，试试清空搜索或标签。</div>'
      : '<span class="muted">暂无推荐酒水。</span>';
  }
  // 补上命中数列，与料理表对称；价格/等级/命中数可排序。
  const columns = [
    { key: '酒水', label: '酒水' }, { key: '价格', label: '价格', num: true, sortable: true, sortKey: 'detailDrinkSort' },
    { key: '等级', label: '等级', num: true, sortable: true, sortKey: 'detailDrinkSort' },
    { key: '命中数', label: '命中数', num: true, sortable: true, sortKey: 'detailDrinkSort' },
    { key: '标签', label: '标签', tags: true }, { key: '命中喜好', label: '命中喜好', tags: true, tagKind: 'good' }
  ];
  return makeTable(columns, list);
}

function ryoteiUiInit(){
  ryoteiFiltersInit();
  initRyoteiNavigation();
  const header = $('.site-header');
  const updateHeader = () => root.style.setProperty('--header-h',Math.ceil(header.getBoundingClientRect().height) + 'px');
  updateHeader();
  if (window.ResizeObserver) new ResizeObserver(updateHeader).observe(header);
  window.addEventListener('resize',updateHeader);
  document.addEventListener('keydown',(e) => {
    const panel = $('#detail-panel');
    if (e.key !== 'Tab' || panel.hidden || !panel.classList.contains('open')) return;
    const focusable = Array.from(panel.querySelectorAll('button,input,select,a[href],summary,[tabindex="0"]')).filter((el) => !el.disabled && el.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { e.preventDefault();last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { e.preventDefault();first.focus(); }
  });
  document.addEventListener('click',(e) => {
    const pageButton = e.target.closest('[data-table-page]');
    if (pageButton) {
      const pagination = ryoteiPages[pageButton.dataset.tablePage];
      if (!pagination) return;
      pagination.page += Number(pageButton.dataset.direction);
      renderTab(state.tab);
      return;
    }
    const button = e.target.closest('[data-row-expand]');
    const row = button && document.getElementById(button.getAttribute('aria-controls'));
    if (!row) return;
    row.hidden = !row.hidden;
    button.setAttribute('aria-expanded',String(!row.hidden));
    button.closest('tr').classList.toggle('is-expanded',!row.hidden);
  });
  // 空闲预热全量静态推荐索引：首次打开客人详情/进备菜页不再付一次性构建开销。
  (window.requestIdleCallback || ((fn) => window.setTimeout(fn, 300)))(() => {
    try { buildMealIndex(); buildDrinkRecIndex(); } catch (_) {}
  });
}

let ryoteiTableSerial = 0;
const ryoteiPages = Object.create(null);
const RYOTEI_PAGE_SIZE = 50;
function ryoteiTablePage(columns,list){
  const sortColumn = columns.find((c) => c.sortKey);
  if (!sortColumn) return {rows:list,footer:''};
  const key = sortColumn.sortKey;
  const prefix = key.replace(/Sort$/,'');
  const signature = JSON.stringify([list.length,Object.entries(state).filter(([name]) => name.startsWith(prefix)),['detailSort','addonSort','drinkrecSort'].includes(key) ? state.servicePlace || 'all' : '']);
  let pagination = ryoteiPages[key];
  if (!pagination || pagination.signature !== signature) pagination = ryoteiPages[key] = {signature,page:0};
  const pages = Math.max(1,Math.ceil(list.length / RYOTEI_PAGE_SIZE));
  pagination.page = Math.max(0,Math.min(pages - 1,pagination.page));
  if (pages === 1) return {rows:list,footer:''};
  const start = pagination.page * RYOTEI_PAGE_SIZE;
  const button = (direction,label,disabled) => '<button type="button" data-table-page="' + key + '" data-direction="' + direction + '"' + (disabled ? ' disabled' : '') + '>' + label + '</button>';
  return {rows:list.slice(start,start + RYOTEI_PAGE_SIZE),footer:'<div class="table-pagination"><span>' + (start + 1) + '–' + Math.min(start + RYOTEI_PAGE_SIZE,list.length) + ' / ' + list.length + '</span><div>' + button(-1,'上一页',pagination.page === 0) + '<span>' + (pagination.page + 1) + ' / ' + pages + '</span>' + button(1,'下一页',pagination.page === pages - 1) + '</div></div>'};
}
function makeRyoteiTable(columns,list){
  // 宽文本改放整行详情；表格只承担横向比较，原文仍留在 DOM 中。
  const secondary = columns.filter((c) => c.wide || c.secondary);
  const primary = columns.filter((c) => !c.wide && !c.secondary);
  const tableId = 'ryotei-table-' + (++ryoteiTableSerial);
  const page = ryoteiTablePage(columns,list);
  const itemKeys = ['菜品','食材','酒水'];
  const columnClass = (c) => c.tags ? 'col-tags' : c.linkGuest ? 'col-guest' : itemKeys.includes(c.key) ? 'col-item' : c.key === '推荐菜' || c.key === '主料' ? 'col-text' : 'col-short';
  const cellContent = (c,row,full=false) => {
    const value = row[c.key] == null ? '' : row[c.key];
    if (c.linkGuest) return '<i class="td-dot" style="background:' + guestColor(String(value)) + '"></i>' + ryoteiEntityLink('guest',value);
    if (c.tags) {
      const tags = splitTags(value);
      const all = '<span class="table-tags">' + tagHtml(value,c.tagKind || 'neutral') + '</span>';
      if (full || tags.length <= 4) return all;
      return '<details class="cell-tags"><summary aria-label="展开全部' + escAttr(c.label) + '"><span class="table-tags">' + tagHtml(tags.slice(0,3).join('、'),c.tagKind || 'neutral') + '<span class="tag more">+' + (tags.length - 3) + '</span></span></summary>' + all + '</details>';
    }
    if (c.level) return value === '' ? '—' : '<span class="lv-badge">' + (/^Lv\s/i.test(String(value)) ? esc(value) : 'Lv ' + esc(value)) + '</span>';
    if (c.num && c.key === '价格') {
      return '<span class="price-value">' + esc(value) + '<small> 元</small></span>';
    }
    if (itemKeys.includes(c.key)) {
      const icon = (window.WAFU_ASSETS.icons || {})[String(value)];
      const kind = {'菜品':'recipe','食材':'ingredient','酒水':'beverage'}[c.key];
      return '<span class="table-item">' + (icon ? '<img class="td-icon" src="' + icon + '" alt="" loading="lazy">' : '') + ryoteiEntityLink(kind,String(value)) + '</span>';
    }
    if (['推荐菜','主料','加料建议','获取方式','解锁来源'].includes(c.key)) return ryoteiLinkedText(value,c.key === '主料' ? ['ingredient'] : undefined);
    return esc(value);
  };
  const head = primary.map((c) => {
    const sorted = c.sortable && state[c.sortKey] && state[c.sortKey].key === c.key;
    const mark = sorted ? '<span class="sort-mark" aria-hidden="true">' + (state[c.sortKey].dir > 0 ? '▲' : '▼') + '</span>' : '';
    return '<th scope="col" class="' + columnClass(c) + (c.sortable ? ' sortable' : '') + (sorted ? ' sorted' : '') + '"' + (c.sortable ? ' data-sort="' + escAttr(c.key) + '" data-sort-key="' + escAttr(c.sortKey) + '"' : '') + '>' + esc(c.label) + mark + '</th>';
  }).join('') + (secondary.length ? '<th scope="col" class="col-expand">详情</th>' : '');
  const body = page.rows.map((row,index) => {
    const rowId = tableId + '-row-' + index;
    const label = secondary.some((c) => c.key === '加料建议') ? '加料 · 详情' : '详情';
    const identity = row['菜品'] || row['食材'] || row['酒水'] || '';
    const main = '<tr class="data-row' + (index % 2 ? ' alternate' : '') + '">' + primary.map((c) => '<td class="' + columnClass(c) + (c.num ? ' num' : '') + '">' + cellContent(c,row) + '</td>').join('') +
      (secondary.length ? '<td class="col-expand"><button class="row-expand" type="button" data-row-expand aria-expanded="false" aria-controls="' + rowId + '" aria-label="展开' + escAttr((row['客人名字'] || '') + ' ' + identity) + '详情">' + label + '<span aria-hidden="true">⌄</span></button></td>' : '') + '</tr>';
    if (!secondary.length) return main;
    const fields = secondary.map((c) => '<div class="row-field' + (c.wide ? ' row-field-wide' : '') + '"><h4>' + esc(c.label) + '</h4><div class="row-field-value">' + cellContent(c,row,true) + '</div></div>').join('');
    return main + '<tr class="row-details" id="' + rowId + '" hidden><td colspan="' + (primary.length + 1) + '"><div class="row-details-content">' + fields + '</div></td></tr>';
  }).join('');
  const table = '<table class="data-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
  return page.footer ? '<div class="paged-table"><div class="paged-table-scroll">' + table + '</div>' + page.footer + '</div>' : table;
}
