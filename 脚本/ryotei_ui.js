/* 料亭版呈现层；查询、排序和推荐规则沿用原版。 */
const RYOTEI_CHAPTERS = {
  guests:['客人名簿','先记住口味与预算，再为今夜备菜。','客'],
  details:['备菜手帖','按客人和阶段，查找已经整理好的推荐料理。','菜'],
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

function fillRyoteiLedger(){
  const stats = [['guests','特殊与稀客','GUESTS'],['recipes','料理收录','RECIPES'],['beverages','酒水收录','DRINKS'],['ingredients','食材收录','INGREDIENTS']];
  $('#ledger').innerHTML = stats.map(([key,label,en]) => '<div class="ledger-stat"><strong>' + dataOf(key).length + '</strong><span>' + label + '<small>' + en + '</small></span></div>').join('');
  $('#ledger').hidden = false;
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
    '<div class="guest-card-top"><div class="guest-id">' + ryoteiFace(name) + '<div><h3>' + esc(name) + '</h3><div class="guest-submeta">' + esc(guest['类型']) + ' · ' + esc(guest['所属版本']) + '</div></div></div><span class="guest-sigil" aria-hidden="true">客帖</span></div>' +
    '<div class="guest-facts"><div class="guest-location"><span class="fact-label">出没地点</span><span class="location" title="' + escAttr(guest['出没地点']) + '">' + esc(guest['出没地点']) + '</span></div><div class="guest-budget"><span class="fact-label">持有金</span><strong>' + esc(guest['持有金']) + '</strong></div></div>' +
    '<div class="tag-row"><span class="tag-label good">喜好</span><div class="tag-wrap">' + tagHtml(staticFirst(guest['喜好料理标签']),'good',5) + '</div></div>' +
    '<div class="tag-row"><span class="tag-label bad">厌恶</span><div class="tag-wrap">' + tagHtml(staticFirst(guest['厌恶料理标签']),'bad',4) + '</div></div>' +
    '<div class="guest-card-foot"><span>前期 ' + lines(guest['前期推荐菜谱']).length + ' 道 · 后期 ' + lines(guest['后期推荐菜谱']).length + ' 道</span><span class="hint">详情 ↗</span></div></button>';
}

function ryoteiMenuDish(raw){
  const name = String(raw).split(/[（(]/)[0].trim();
  const recipe = dataOf('recipes').find((r) => r['菜品'] === name);
  if (!recipe) return '<div class="dish-line">' + esc(enrichDishLine(raw)) + '</div>';
  const icon = (window.WAFU_ASSETS.icons || {})[name];
  return '<article class="menu-dish"><div class="menu-dish-top">' + (icon ? '<img src="' + icon + '" alt="" loading="lazy">' : '') +
    '<span class="menu-dish-name">' + ryoteiEntityLink('recipe',name) + '</span><span class="menu-price">' + esc(recipe['价格']) + '<small>元</small></span></div>' +
    '<div class="menu-dish-meta"><span class="lv-badge">Lv ' + esc(recipe['等级']) + '</span><span>' + esc(recipe['所属版本']) + '</span><span>' + esc(recipe['厨具']) + '</span></div>' +
    '<div class="tag-wrap">' + tagHtml(recipe['菜品标签'],'neutral') + '</div>' +
    '<div class="menu-material">主料 · ' + ryoteiLinkedText(recipe['主料'],['ingredient']) + '</div>' +
    '<details class="dish-note"><summary>原始推荐文字</summary><p>' + ryoteiLinkedText(enrichDishLine(raw)) + '</p></details></article>';
}

function renderRyoteiGuestDetail(guest){
  const name = guest['客人名字'];
  $('#detail-title').textContent = name;
  $('#detail-sub').textContent = guest['类型'] + ' · ' + guest['所属版本'] + ' · 持有金 ' + guest['持有金'];
  const seal = $('#detail-seal');
  const avatar = (window.WAFU_ASSETS.avatars || {})[name];
  seal.classList.toggle('is-ava',!!avatar);
  seal.innerHTML = avatar ? '<img src="' + avatar + '" alt="">' : esc(name.charAt(0));
  seal.style.setProperty('--pc',guestColor(name));
  seal.style.animation = 'none'; void seal.offsetWidth; seal.style.animation = '';
  $('#detail-watermark').textContent = name;
  const early = lines(guest['前期推荐菜谱']);
  const late = lines(guest['后期推荐菜谱']);
  const addons = lines(guest['加料推荐']);
  const section = (id,title,content) => '<section class="detail-section" id="' + id + '" tabindex="-1"><h3>' + title + '</h3>' + content + '</section>';
  const fold = (title,text) => '<details class="guide-card"><summary><span class="guide-name">' + title + '</span></summary><div class="guide-card-body"><div class="field"><div class="value">' + ryoteiLinkedText(text || '无') + '</div></div></div></details>';
  const sections = [];
  sections.push(section('guest-tastes','口味与基本信息','<dl class="kv">' +
    '<dt>来访地区</dt><dd>' + ryoteiLocationLinks(guest['出没地点']) + '</dd>' +
    '<dt>持有金</dt><dd><strong>' + esc(guest['持有金']) + '</strong></dd>' +
    '<dt>类型 / 版本</dt><dd>' + esc(guest['类型']) + ' · ' + esc(guest['所属版本']) + '</dd>' +
    '<dt>喜好料理</dt><dd><div class="chips">' + tagHtml(guest['喜好料理标签'],'good') + '</div></dd>' +
    '<dt>厌恶料理</dt><dd><div class="chips">' + tagHtml(guest['厌恶料理标签'],'bad') + '</div></dd>' +
    '<dt>喜好酒水</dt><dd><div class="chips">' + tagHtml(guest['喜好酒水标签'],'drink') + '</div></dd>' +
    '<dt>拿手标签</dt><dd>' + esc(guest['拿手菜/额外喜好标签'] || '无') + '</dd></dl>'));
  sections.push(section('guest-drinks','推荐酒水',drinkTableForGuest(name)));
  sections.push('<div class="meal-pair" id="guest-meals" tabindex="-1">' +
    section('guest-early','前期料理','<div class="menu-list">' + (early.length ? early.map(ryoteiMenuDish).join('') : '<p class="muted">无</p>') + '</div>') +
    section('guest-late','后期料理','<div class="menu-list">' + (late.length ? late.map(ryoteiMenuDish).join('') : '<p class="muted">无</p>') + '</div>') + '</div>');
  sections.push(section('guest-addons','加料参考',addonTableForGuest(name) +
    '<details class="guide-card" style="margin-top:10px"><summary><span class="guide-name">原始加料建议</span></summary><div class="guide-card-body">' +
    addons.map((s) => '<div class="dish-line">' + ryoteiLinkedText(s) + '</div>').join('') + '</div></details>'));
  sections.push(section('guest-records','完整推荐明细','<details class="guide-card"><summary><span class="guide-name">展开材料、标签命中与加料明细</span></summary><div class="guide-card-body">' + detailTableForGuest(name) + '</div></details>'));
  sections.push(section('guest-bonds','符卡与羁绊',fold('奖励符卡',guest['奖励符卡']) + fold('惩罚符卡',guest['惩罚符卡']) + fold('羁绊等级解锁',guest['羁绊等级解锁'])));
  if (guest['B站2024攻略菜品（对照，原文）'] && guest['B站2024攻略菜品（对照，原文）'] !== '无（该攻略早于4.4.0）') {
    sections.push(section('guest-comparison','攻略对照',fold('B 站 2024 原文推荐',guest['B站2024攻略菜品（对照，原文）'])));
  }
  sections.push(section('guest-notes','备注与来源','<div class="callout">' + esc(guest['备注/来源'] || '') + '</div>'));
  const body = $('#detail-body');
  const previousScroll = body.scrollTop;
  body.innerHTML = sections.join('');
  // 酒水排序只更新呈现，保持阅读位置；切换人物回到名簿顶部。
  body.scrollTop = body.dataset.guest === name ? previousScroll : 0;
  body.dataset.guest = name;
}

function ryoteiUiInit(){
  initRyoteiNavigation();
  $$('.hero-action').forEach((btn) => btn.addEventListener('click',() => {
    ryoteiNavigate(ryoteiHash(btn.dataset.jump));
  }));
  $('.detail-index').addEventListener('click',(e) => {
    const button = e.target.closest('[data-detail-jump]');
    const target = button && document.getElementById(button.dataset.detailJump);
    if (target) { target.scrollIntoView({behavior:REDUCED_MOTION ? 'auto' : 'smooth',block:'start'}); target.focus({preventScroll:true}); }
  });
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
  const priceMax = list.reduce((m,r) => Math.max(m,parseFloat(r['价格']) || 0),0);
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
      const pct = priceMax ? Math.max(3,Math.round((parseFloat(value) || 0) / priceMax * 100)) : 0;
      return '<span class="pbar-cell"><i class="pbar" style="width:' + pct + '%"></i><span>' + esc(value) + '</span></span>';
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
