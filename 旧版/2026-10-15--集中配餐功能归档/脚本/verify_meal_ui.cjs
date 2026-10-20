const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { liveOutput } = require('./live_output.cjs');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, '中间数据/料亭版攻略数据基线.json'), 'utf8'));
const domainData = fs.readFileSync(path.join(root, '中间数据/MEAL_DOMAIN_DATA.json'), 'utf8');
const domainSource = fs.readFileSync(path.join(__dirname, 'ryotei_meal_domain.js'), 'utf8');
const uiSource = fs.readFileSync(path.join(__dirname, 'ryotei_meal_ui.js'), 'utf8');
const cardSource = fs.readFileSync(path.join(__dirname, 'ryotei_candidate_cards.js'), 'utf8');
const records = key => data.sheets[key].rows.map(row => Object.fromEntries(data.sheets[key].headers.map((name, i) => [name, String(row[i] ?? '')])));
const recommendations = food => records('guests').concat(records('normal')).flatMap(guest => {
  const parse = value => String(value || '').split('、').filter(tag => tag && !/动态|^流行/.test(tag));
  const likes = parse(guest[food ? '喜好料理标签' : '喜好酒水标签']);
  const hates = parse(guest[food ? '厌恶料理标签' : '厌恶酒水标签']);
  return records(food ? 'recipes' : 'beverages').filter(row => {
    const tags = parse(row[food ? '菜品标签' : '标签']);
    return likes.some(tag => tags.includes(tag)) && !hates.some(tag => tags.includes(tag));
  }).map(row => ({ ...row, '客人名字': guest['客人名字'] || guest['普通客人'], '命中喜好': '', '命中数': 1 }));
});
const nodes = new Map();
const node = selector => {
  if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', textContent: '', value: '', open: false, hidden: false, disabled: false, dataset: {}, classList: { toggle() {}, remove() {}, contains() { return false; } }, setAttribute() {}, insertAdjacentHTML(_position, html) { this.innerHTML += html; }, focus() {}, scrollIntoView() {}, addEventListener() {} });
  return nodes.get(selector);
};
const events = {};
const store = new Map();
const state = { tab: 'details', serviceGuest: '博丽灵梦', servicePlace: 'all', openGuest: '', detailQuery: '', detailChips: [], detailSort: { key: '命中数', dir: -1 }, drinkrecQuery: '', drinkrecChips: [], drinkrecSort: { key: '命中喜好', dir: -1 }, addonQuery: '', addonChips: [], addonSort: { key: '价格', dir: 1 } };
const simpleColumns = food => [{ key: food ? '菜品' : '酒水', sortKey: food ? 'detailSort' : 'drinkrecSort' }];
const context = vm.createContext({
  console, assert, state, Map, Set, URL, Blob, Date, Number, JSON,
  document: {
    activeElement: null,
    getElementById(id) { return id === 'meal-domain-data' ? { textContent: domainData } : node('#' + id); },
    querySelector: node,
    querySelectorAll() { return []; },
    addEventListener(name, handler) { events[name] = handler; },
    body: { appendChild() {} }, createElement() { return { click() {}, remove() {} }; }
  },
  window: { WAFU_ASSETS: { icons: {} }, setTimeout() {} },
  localStorage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) },
  $: node, esc: value => String(value ?? ''), escAttr: value => String(value ?? ''), tagHtml: value => String(value),
  ryoteiPages: {}, DETAIL_COLUMNS: simpleColumns(true), DRINKREC_COLUMNS: simpleColumns(false),
  dataOf: records, splitTags: value => String(value || '').split('、').filter(Boolean),
  buildMealIndex: () => recommendations(true), buildDrinkRecIndex: () => recommendations(false),
  ryoteiNormalNames: new Set(records('normal').map(row => row['普通客人'])),
  ryoteiVisitsPlace: () => true, byLocale: (a, b) => String(a).localeCompare(String(b)),
  ryoteiEntityLink: (_kind, name) => String(name), ryoteiHash: (tab, options = {}) => '#' + tab + '?who=' + encodeURIComponent(options.who || ''),
  ryoteiDetailMealTable: (_name, rows) => JSON.stringify(rows), ryoteiDetailDrinkTable: (_name, rows) => JSON.stringify(rows),
  makeTable: (_columns, rows) => JSON.stringify(rows),
  ryoteiTablePage: (_columns, rows) => ({rows,footer:''}),
  matchesTagChips: () => true,
  matchesRowQuery: (row, q) => !q || JSON.stringify(row).includes(q),
  sortObjects: (rows, key, dir) => rows.slice().sort((a, b) => (Number(a[key]) - Number(b[key])) * dir),
  renderTab() {},
  ryoteiCloseFilters() {},
  ryoteiNavigate(hash) { const parsed = hash.match(/^#([^?]+)\?who=(.*)$/); if (parsed) { state.tab = parsed[1]; state.serviceGuest = decodeURIComponent(parsed[2]); } }
});
vm.runInContext(domainSource + '\n' + cardSource + '\n' + uiSource + '\nglobalThis.UI = RyoteiMealUI;', context);
context.renderTab = () => { context.UI.updateWorkspace(); };
context.UI.init();
const target = dataset => ({ dataset, closest(selector) { if (selector === '[data-meal-action]') return this; return null; } });
const action = (name, extra = {}) => events.click({ target: target({ mealAction: name, ...extra }), preventDefault() {} });
const field = (name, value, extra = {}) => events.change({ target: { dataset: { mealField: name }, value: String(value), closest() { return null; }, ...extra } });
const info = () => node('#meal-facts').innerHTML;
const station = () => node('#meal-station').innerHTML;
action('choose', { mealKind: 'food', mealId: '66', mealGuest: '博丽灵梦' });
action('choose', { mealKind: 'beverage', mealId: '20', mealGuest: '博丽灵梦' });
assert.ok(info().includes('475 元'), '料理35+十四夜440正确，不加材料价值');
assert.ok(station().includes('十四夜'), '超基础上限酒仍可以选入');
assert.ok(info().includes('钱包未知'), '默认不造钱包');
node('#meal-actual-balance').value = '';
action('snapshot');
assert.ok(node('#meal-notice').textContent.includes('空白不是 0'));
node('#meal-actual-balance').value = '200';
action('snapshot');
assert.ok(info().includes('-275 元'));
action('record');
assert.ok(info().includes('已记 1 单'));
assert.ok(info().includes('余额 -275 元'), '已登记只扣一次');
action('undo');
assert.ok(info().includes('余额 200 元'));
node('#meal-actual-balance').value = '200';
events.input({ target: { id: 'meal-actual-balance', value: '200' } });
context.UI.updateWorkspace(true);
assert.ok(station().includes('value="200"'), '未采用余额在工作台重画后仍保留');
const stationBeforeChange = station();
field('foodPrice', '40');
assert.equal(node('#meal-actual-balance').value, '200', '字段 change 不清空未采用余额');
assert.equal(station(), stationBeforeChange, '字段 change 不拆下一操作控件');
assert.ok(info().includes('480 元'), '计费价只刷新结果');
field('foodPrice', '');
field('trendTag', '17');
field('trendDirection', 'hate');
const signatureBefore = context.UI.renderSignature('addons');
field('foodRequest', '9');
assert.notEqual(context.UI.renderSignature('addons'), signatureBefore, '加料页缓存包含请求草稿');
action('save');
assert.ok(info().includes('已记 0 单'), '保存不登记');
assert.equal(JSON.parse(store.values().next().value).meals.length, 1);
assert.equal(JSON.parse(store.values().next().value).meals[0].draft.dailyTrend.isNegative, true, '流行厌恶存布尔值');
node('#meal-transfer').value = store.values().next().value;
action('import');
assert.equal(JSON.parse(store.values().next().value).meals.length, 1, '原样导入同一套餐不重复');
action('load-saved', { mealIndex: '0' });
assert.ok(station().includes('value="hate" selected'), '保存载入保留流行厌恶');
action('prepare-current');
assert.ok(node('#night-preparation-body').innerHTML.includes('月光草'));
assert.ok(node('#night-preparation-body').innerHTML.includes('十四夜'));
action('new-session');
assert.ok(info().includes('钱包未知'));
action('scope', { mealKind: 'beverage', mealValue: 'all' });
state.tab = 'drinkrecs';
context.UI.renderCandidates('beverage');
assert.equal((node('#drinkrec-table-wrap').innerHTML.match(/data-candidate-kind=\"beverage\"/g)||[]).length, 46, '全部物品可达且不使用横向表格');
assert.ok(!node('#drinkrec-table-wrap').innerHTML.includes('<table'), '候选不再用宽表格');
action('pick-step', { mealKind: 'food' });
assert.equal(state.tab, 'details', '第一步回料理');
action('pick-step', { mealKind: 'beverage' });
assert.equal(state.tab, 'drinkrecs', '第二步直接切酒水');
action('pick-step', { mealKind: 'ingredient' });
assert.equal(state.tab, 'addons', '第三步直接切加料');
assert.ok(station().includes('data-meal-action="pick-step"'), '步骤是明确可操作按钮而非跳转说明');
state.tab = 'drinkrecs';
field('free', '', { checked: true });
node('#meal-actual-balance').value = '100'; action('snapshot'); action('record');
assert.ok(info().includes('余额 100 元'), '免费订单不扣余额');
action('new-session');
node('#meal-transfer').value = '{"schemaVersion":1,"meals":[{"guestKey":"s:999999","draft":{}}]}';
action('import');
assert.ok(node('#meal-notice').textContent.includes('客人不存在'));
assert.equal(JSON.parse(store.values().next().value).meals.length, 1, '无效导入不清原套餐');
state.serviceGuest = '妖怪兔'; state.tab = 'details'; context.UI.updateWorkspace(true);
assert.ok(station().includes('钱包未知'));
assert.ok(!station().includes('本次料理要求'), '普通客不套稀客请求');

const livePath = liveOutput(root);
const html = fs.readFileSync(livePath, 'utf8');
const normalize = value => value.replace(/\r\n/g, '\n');
assert.ok(normalize(html).includes(normalize(domainSource)), '成品包含最终计算模块');
assert.ok(normalize(html).includes(normalize(uiSource)), '成品包含最终UI模块');
const report = JSON.parse(fs.readFileSync(path.join(root, '成品/料亭立体头像版_构建校验.json'), 'utf8'));
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(livePath)).digest('hex'), report.outputSha256);
assert.equal(crypto.createHash('sha256').update(domainSource).digest('hex'), report.mealDomainSha256);
assert.equal(crypto.createHash('sha256').update(normalize(uiSource)).digest('hex'), report.mealUiSha256);
const outAt = process.argv.indexOf('--out-dir');
if (outAt >= 0) {
  const dir = path.resolve(process.argv[outAt + 1]); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meal_ui_test_report.json'), JSON.stringify({ status: 'PASS', liveProduct: path.basename(livePath), scenarios: ['选择超额套餐', '未造预算', '快照', '登记/撤销', '保存不登记', '备菜材料', '新就餐', '全部物品', '免费订单', '无效导入保护', '普通客边界', '成品模块与哈希'] }, null, 2), { flag: 'wx' });
}
console.log('PASS: 整模块配餐UI事件、保存/准备/账单/余额/导入边界、全部物品与最终成品模块哈希');
