/* 导航分组、营业地区与关联条目；数据和推荐评分仍来自原攻略表。 */
const RYOTEI_GROUPS = {
  guests:{label:'客人图鉴',tabs:[['guests','稀客与特殊客人'],['normal','普通客人']]},
  meals:{label:'配餐参考',tabs:[['details','料理'],['drinkrecs','酒水'],['addons','加料']]},
  items:{label:'物品图鉴',tabs:[['catalog','菜谱'],['ingredients','食材'],['beverages','酒水']]},
  reference:{label:'资料',tabs:[['new440','版本更新'],['guides','旧版攻略'],['sources','数据来源']]}
};
const ryoteiGroupLast = {guests:'guests',meals:'details',items:'catalog'};
const RYOTEI_PLACES = unique(dataOf('guests').concat(dataOf('normal')).flatMap(row=>splitTags(row['出没地点']))).filter(name=>name !== '白玉楼');
const RYOTEI_ITEM_PAGES = {
  recipe:{tab:'catalog',sheet:'recipes',key:'菜品',query:'catalogQuery',chips:'catalogChips',dlc:'catalogDlc'},
  ingredient:{tab:'ingredients',sheet:'ingredients',key:'食材',query:'ingredientQuery',chips:'ingredientChips',dlc:'ingredientDlc'},
  beverage:{tab:'beverages',sheet:'beverages',key:'酒水',query:'beverageQuery',chips:'beverageChips',dlc:'beverageDlc'},
  normal:{tab:'normal',sheet:'normal',key:'普通客人',query:'normalQuery'}
};
const ryoteiTextMatchers = new Map();

function ryoteiGroup(tab){
  return Object.keys(RYOTEI_GROUPS).find(key=>RYOTEI_GROUPS[key].tabs.some(([id])=>id === tab)) || 'guests';
}
function ryoteiVisitsPlace(row,place=state.servicePlace){
  return !place || place === 'all' || splitTags(row['出没地点']).includes(place);
}
function ryoteiPlanRows(rows){
  if (!state.servicePlace || state.servicePlace === 'all') return rows;
  const guests = new Set(dataOf('guests').filter(row=>ryoteiVisitsPlace(row)).map(row=>row['客人名字']));
  return rows.filter(row=>guests.has(row['客人名字']));
}
function ryoteiHash(tab,options={}){
  const params = new URLSearchParams();
  const place = options.place === undefined ? state.servicePlace : options.place;
  const who = options.who === undefined ? state.serviceGuest : options.who;
  if (place && place !== 'all') params.set('place',place);
  if (['details','drinkrecs','addons'].includes(tab) && who && who !== 'all') params.set('who',who);
  if (options.item) params.set('item',options.item);
  const suffix = params.toString();
  return '#' + tab + (options.guest ? '/' + encodeURIComponent(options.guest) : '') + (suffix ? '?' + suffix : '');
}
function ryoteiParseRoute(hash=location.hash){
  const raw = String(hash).replace(/^#/,'');
  const queryAt = raw.indexOf('?');
  const path = queryAt < 0 ? raw : raw.slice(0,queryAt);
  const params = new URLSearchParams(queryAt < 0 ? '' : raw.slice(queryAt + 1));
  const [name,...rest] = path.split('/');
  let guest = '';
  try { guest = decodeURIComponent(rest.join('/')); } catch (_) { guest = ''; }
  return {tab:TAB_IDS.includes(name) ? name : 'guests',guest,place:params.get('place') || 'all',who:params.get('who') || 'all',item:params.get('item') || ''};
}
function ryoteiApplyRoute(route){
  let changed = false;
  const assign = (key,value) => { if (state[key] !== value) { state[key] = value;changed = true; } };
  const place = RYOTEI_PLACES.includes(route.place) ? route.place : 'all';
  assign('servicePlace',place);
  const isPlan = ['details','drinkrecs','addons'].includes(route.tab);
  const requestedGuest = isPlan ? route.who : state.serviceGuest;
  const guest = dataOf('guests').find(row=>row['客人名字'] === requestedGuest && ryoteiVisitsPlace(row,place));
  const who = guest ? requestedGuest : 'all';
  assign('serviceGuest',who);
  for (const key of ['detailGuest','addonGuest','drinkrecGuest']) assign(key,who);
  const itemPage = Object.values(RYOTEI_ITEM_PAGES).find(page=>page.tab === route.tab);
  const item = itemPage && dataOf(itemPage.sheet).find(row=>row[itemPage.key] === route.item);
  if (item) {
    if (itemPage.chips && state[itemPage.chips].length) { state[itemPage.chips] = [];changed=true; }
    if (itemPage.dlc) assign(itemPage.dlc,'all');
    if (route.tab === 'ingredients') assign('ingredientType','all');
    assign(itemPage.query,route.item);
    assign('focusTab',route.tab);
    assign('focusItem',route.item);
  } else if (!item && state.focusItem) {
    assign('focusTab','');
    assign('focusItem','');
  }
  if (changed) syncRyoteiControls();
  return changed;
}
function ryoteiFocusMatches(tab,row,key){
  return state.focusTab !== tab || !state.focusItem || row[key] === state.focusItem;
}
function syncRyoteiControls(){
  const bindings = {
    '#guest-search':'guestQuery','#guest-type-filter':'guestType','#guest-dlc-filter':'guestDlc',
    '#detail-search':'detailQuery','#detail-stage-filter':'detailStage','#detail-dlc-filter':'detailDlc',
    '#detail-guest-filter':'detailGuest','#addon-guest-filter':'addonGuest','#drinkrec-guest-filter':'drinkrecGuest',
    '#catalog-search':'catalogQuery','#catalog-dlc-filter':'catalogDlc',
    '#ingredient-search':'ingredientQuery','#ingredient-type-filter':'ingredientType','#ingredient-dlc-filter':'ingredientDlc',
    '#beverage-search':'beverageQuery','#beverage-dlc-filter':'beverageDlc',
    '#addon-search':'addonQuery','#addon-scene-filter':'addonScene','#drinkrec-search':'drinkrecQuery',
    '#normal-search':'normalQuery','#guide-search':'guideQuery','#service-place':'servicePlace'
  };
  for (const [selector,key] of Object.entries(bindings)) { const el = $(selector);if (el) el.value = state[key] || ''; }
  $$('.subtab').forEach(button=>button.classList.toggle('active',button.dataset.guide === state.guideTab));
  for (const cfg of TAG_FILTER_CONFIG) renderTagBar(cfg);
}
function updateRyoteiNavigation(tab){
  const group = ryoteiGroup(tab);
  if (group !== 'reference') ryoteiGroupLast[group] = tab;
  $$('.primary-tab, .reference-toggle').forEach(button=>{
    const active = button.dataset.group === group;
    button.classList.toggle('active',active);
    if (active) button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  });
  const nav = $('#section-nav');
  if (nav.dataset.group !== group) {
    nav.dataset.group = group;
    nav.innerHTML = group === 'reference' ? '' : RYOTEI_GROUPS[group].tabs.map(([id,label])=>'<button class="section-tab" type="button" data-section-tab="' + id + '">' + label + '</button>').join('');
  }
  nav.hidden = group === 'reference';
  $$('[data-section-tab]').forEach(button=>{
    const active = button.dataset.sectionTab === tab;
    button.classList.toggle('active',active);
    if (active) button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  });
  $('#service-context').hidden = !['guests','meals'].includes(group);
  $('#service-place').value = state.servicePlace;
  updateRyoteiVisitors(group);
}
function updateRyoteiVisitors(group=ryoteiGroup(state.tab)){
  const guests = dataOf('guests').filter(row=>ryoteiVisitsPlace(row));
  const normal = dataOf('normal').filter(row=>ryoteiVisitsPlace(row));
  $('#service-count').textContent = guests.length + ' 位稀客 · ' + normal.length + ' 种普通客人';
  for (const selector of ['#detail-guest-filter','#addon-guest-filter','#drinkrec-guest-filter']) {
    const select = $(selector);
    if (select.dataset.place !== state.servicePlace) { fillSelect(select,guests.map(row=>row['客人名字']).sort(byLocale),'全部客人');select.dataset.place=state.servicePlace; }
    select.value=state.serviceGuest;
  }
  const overview = $('#service-visitors');
  overview.hidden = group !== 'meals' || state.servicePlace === 'all';
  if (overview.hidden || overview.dataset.place === state.servicePlace) return;
  overview.dataset.place = state.servicePlace;
  $('#visitor-rare').innerHTML = guests.map(row=>'<a class="visitor-link entity-link" href="' + escAttr(ryoteiHash('guests',{guest:row['客人名字']})) + '">' + ryoteiFace(row['客人名字']) + '<span>' + esc(row['客人名字']) + '</span></a>').join('');
  $('#visitor-normal').innerHTML = normal.map(row=>'<a class="visitor-link entity-link" href="' + escAttr(ryoteiHash('normal',{item:row['普通客人']})) + '">' + ryoteiFace(row['普通客人'],'normal') + '<span>' + esc(row['普通客人']) + '</span></a>').join('');
}
function ryoteiEntityLink(kind,name,label=name){
  let href = '';
  if (kind === 'guest' && dataOf('guests').some(row=>row['客人名字'] === name)) href = ryoteiHash('guests',{guest:name});
  else if (kind === 'place' && RYOTEI_PLACES.includes(name)) href = ryoteiHash('guests',{place:name});
  else if (RYOTEI_ITEM_PAGES[kind]) {
    const page=RYOTEI_ITEM_PAGES[kind];
    if (dataOf(page.sheet).some(row=>row[page.key] === name)) href = ryoteiHash(page.tab,{item:name});
  }
  return href ? '<a class="entity-link" data-entity-kind="' + kind + '" href="' + escAttr(href) + '">' + esc(label) + '</a>' : esc(label);
}
function ryoteiLinkedText(value,kinds=['recipe','ingredient','beverage','guest','place']){
  const text = String(value || '');
  const key = kinds.join(',');
  let matcher = ryoteiTextMatchers.get(key);
  if (!matcher) {
    const names = new Map();
    for (const kind of kinds) {
      if (kind === 'place') RYOTEI_PLACES.forEach(name=>names.set(name,kind));
      else if (kind === 'guest') dataOf('guests').forEach(row=>names.set(row['客人名字'],kind));
      else if (RYOTEI_ITEM_PAGES[kind]) { const page=RYOTEI_ITEM_PAGES[kind];dataOf(page.sheet).forEach(row=>names.set(row[page.key],kind)); }
    }
    const pattern = Array.from(names.keys()).filter(Boolean).sort((a,b)=>b.length-a.length).map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
    matcher = {names,pattern};
    ryoteiTextMatchers.set(key,matcher);
  }
  if (!matcher.pattern) return esc(text);
  const regex = new RegExp(matcher.pattern,'g');
  let html='',offset=0;
  for (const match of text.matchAll(regex)) {
    html += esc(text.slice(offset,match.index)) + ryoteiEntityLink(matcher.names.get(match[0]),match[0]);
    offset = match.index + match[0].length;
  }
  return html + esc(text.slice(offset));
}
function ryoteiLocationLinks(value){
  return '<span class="location-links">' + splitTags(value).map(name=>RYOTEI_PLACES.includes(name) ? ryoteiEntityLink('place',name) : esc(name)).join('') + '</span>';
}
function ryoteiCaptureReading(selector){
  const scope = $(selector);
  if (!scope) return null;
  return {selector,
    scrolls:Array.from(scope.querySelectorAll('.table-wrap,.paged-table-scroll')).map(el=>({top:el.scrollTop,left:el.scrollLeft})),
    details:Array.from(scope.querySelectorAll('details')).map(el=>el.open),
    rows:Array.from(scope.querySelectorAll('[data-row-expand]')).map(el=>el.getAttribute('aria-expanded') === 'true')
  };
}
function ryoteiRestoreReading(entries){
  for (const saved of entries || []) {
    const scope = saved && $(saved.selector);
    if (!scope) continue;
    Array.from(scope.querySelectorAll('details')).forEach((el,index)=>{ el.open=!!saved.details[index]; });
    Array.from(scope.querySelectorAll('[data-row-expand]')).forEach((el,index)=>{
      const open=!!saved.rows[index];
      el.setAttribute('aria-expanded',String(open));
      el.closest('.data-row').classList.toggle('is-expanded',open);
      const row=document.getElementById(el.getAttribute('aria-controls'));
      if (row) row.hidden=!open;
    });
    Array.from(scope.querySelectorAll('.table-wrap,.paged-table-scroll')).forEach((el,index)=>{
      const scroll=saved.scrolls[index];
      if (scroll) {el.scrollTop=scroll.top;el.scrollLeft=scroll.left;}
    });
  }
}
function ryoteiCaptureView(){
  const saved = Object.fromEntries(Object.entries(state).filter(([key])=>key !== 'openGuest' && !key.startsWith('global')));
  const reading=[ryoteiCaptureReading('#panel-' + state.tab),ryoteiCaptureReading('#service-context'),state.openGuest ? ryoteiCaptureReading('#detail-body') : null].filter(Boolean);
  return {state:JSON.parse(JSON.stringify(saved)),pages:JSON.parse(JSON.stringify(ryoteiPages)),reading,scroll:window.scrollY,detailScroll:$('#detail-body').scrollTop};
}
function ryoteiSaveView(){
  history.replaceState({...history.state,ryoteiView:ryoteiCaptureView()},'',location.href);
}
function ryoteiNavigate(hash,prepare){
  const previous = location.hash;
  ryoteiSaveView();
  if (prepare) prepare();
  if (previous !== hash) location.hash = hash;
  route();
  $('#reference-menu').open = false;
  if (!state.openGuest) $('#ryotei-workbench').scrollIntoView({behavior:'instant',block:'start'});
  history.replaceState({...history.state,ryoteiFrom:previous !== hash ? previous || '#guests' : history.state?.ryoteiFrom,ryoteiView:ryoteiCaptureView()},'',location.href);
  updateRyoteiReturn();
}
function updateRyoteiReturn(){
  const from = history.state?.ryoteiFrom;
  const wrap = $('#jump-return');
  wrap.hidden = !from || from === location.hash;
  if (!wrap.hidden) {
    const origin = ryoteiParseRoute(from);
    $('#jump-back').textContent = '← 返回' + (origin.guest || RYOTEI_GROUPS[ryoteiGroup(origin.tab)].label);
  }
}
function ryoteiRestoreView(){
  const view = history.state?.ryoteiView;
  if (!view) { route();updateRyoteiReturn();return; }
  const before = JSON.stringify(Object.fromEntries(Object.entries(state).filter(([key])=>key !== 'openGuest' && !key.startsWith('global'))));
  const oldGuest = state.openGuest;
  Object.assign(state,view.state);
  state.openGuest = oldGuest;
  const after = JSON.stringify(Object.fromEntries(Object.entries(state).filter(([key])=>key !== 'openGuest' && !key.startsWith('global'))));
  const pageKey = {details:'detailSort',catalog:'catalogSort',ingredients:'ingredientSort',beverages:'beverageSort',addons:'addonSort',drinkrecs:'drinkrecSort'}[state.tab];
  const pageChanged = pageKey && JSON.stringify(ryoteiPages[pageKey]) !== JSON.stringify(view.pages[pageKey]);
  if (lastRenderedTab === state.tab && (before !== after || pageChanged)) lastRenderedTab = '';
  for (const key of Object.keys(ryoteiPages)) delete ryoteiPages[key];
  Object.assign(ryoteiPages,view.pages);
  syncRyoteiControls();
  route();
  updateRyoteiReturn();
  requestAnimationFrame(()=>{ ryoteiRestoreReading(view.reading);window.scrollTo({top:view.scroll,behavior:'instant'});if (state.openGuest) $('#detail-body').scrollTop=view.detailScroll; });
}
function ryoteiRevealItem(){
  if (state.focusTab !== state.tab || !state.focusItem) return;
  if (state.tab === 'normal') { const card = $('#normal-grid .guest-card');if (card) { card.classList.add('linked-target');card.querySelector('.normal-meals').open=true; }return; }
  const row = $('#panel-' + state.tab + ' .data-row');
  if (!row) return;
  row.classList.add('linked-target');
  const button = row.querySelector('[data-row-expand]');
  if (button) { const details = document.getElementById(button.getAttribute('aria-controls'));if (details) details.hidden=false;button.setAttribute('aria-expanded','true');row.classList.add('is-expanded'); }
}
function initRyoteiNavigation(){
  $('#service-place').innerHTML = '<option value="all">全部地点</option>' + RYOTEI_PLACES.map(name=>'<option value="' + escAttr(name) + '">' + esc(name) + '</option>').join('');
  $('#service-place').addEventListener('change',event=>ryoteiNavigate(ryoteiHash(state.tab,{place:event.target.value})));
  $('#jump-back').addEventListener('click',()=>history.back());
  for (const selector of ['#detail-guest-filter','#addon-guest-filter','#drinkrec-guest-filter']) {
    $(selector).addEventListener('change',event=>ryoteiNavigate(ryoteiHash(state.tab,{who:event.target.value})));
  }
  document.addEventListener('click',event=>{
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const primary = event.target.closest('button[data-group]');
    const section = event.target.closest('[data-section-tab]');
    const guest = event.target.closest('button[data-guest]');
    const link = event.target.closest('a.entity-link');
    if (primary || section || guest || link) {
      event.preventDefault();
      const hash = primary ? ryoteiHash(ryoteiGroupLast[primary.dataset.group]) : section ? ryoteiHash(section.dataset.sectionTab) : guest ? ryoteiHash('guests',{guest:guest.dataset.guest}) : link.getAttribute('href');
      ryoteiNavigate(hash,link?.dataset.entityKind === 'place' ? ()=>{ state.guestQuery='';state.guestType='all';state.guestDlc='all';syncRyoteiControls(); } : null);
      return;
    }
    if (!event.target.closest('#reference-menu')) $('#reference-menu').open=false;
  });
  // 用户主动搜索或改筛选时退出精确定位，恢复通常的全文搜索。
  const clearFocus = event=>{
    if (!event.target.closest('.toolbar') || !state.focusItem) return;
    if (event.type === 'click' && !event.target.closest('[data-tag],[data-action="clear"]')) return;
    if (event.type === 'keydown' && !['Enter','Backspace'].includes(event.key)) return;
    state.focusTab='';state.focusItem='';
    history.replaceState({...history.state},'',ryoteiHash(state.tab));
  };
  document.addEventListener('click',clearFocus,true);
  document.addEventListener('keydown',clearFocus,true);
  document.addEventListener('input',clearFocus,true);
  document.addEventListener('change',clearFocus,true);
  window.addEventListener('popstate',ryoteiRestoreView);
  document.addEventListener('keydown',event=>{ if (event.key === 'Escape') $('#reference-menu').open=false; });
}
