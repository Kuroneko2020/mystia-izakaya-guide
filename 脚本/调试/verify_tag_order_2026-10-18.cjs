// 标签显示顺序（料理/酒水）与“固定口味候选”提示移除的浏览器核验（2026-10-18）。
// 只读活成品：加载 file:// 页面，核对筛选标签、详情头部、表格标签单元格与提示 DOM，截取证据图。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const {liveOutput} = require('../live_output.cjs');

const root = path.resolve(__dirname, '../..');
const live = liveOutput();
assert.ok(live && fs.existsSync(live), '活成品存在');
const url = pathToFileURL(live).href;
const outDir = path.join(root, '验证记录/2026-10-18--标签顺序与提示移除');
fs.mkdirSync(outDir, {recursive: true});

// 附图顺序（食谱Tag / 酒水Tag，左到右、上到下）；派生标签按游戏 Tag 序号插位。
const FOOD_BASE = ['肉','水产','素','家常','高级','传说','重油','清淡','下酒','饱腹','山珍','海味','和风','西式','中华','咸','鲜','甜','生','招牌','适合拍照','凉爽','灼热','力量涌现','猎奇','文化底蕴','菌类','不可思议','小巧','梦幻','特产','果味','汤羹','烧烤','辣','燃起来了','酸'];
const DRINK_BASE = ['无酒精','低酒精','中酒精','高酒精','可加冰','可加热','烧酒','清酒','鸡尾酒','西洋酒','利口酒','啤酒','直饮','水果','甘','辛','苦','气泡','古典','现代','提神'];
const FOOD_PRICE = ['昂贵','实惠','大份'];
const FOOD_TAIL = ['毒','忧郁之毒','天罚'];
const DRINK_PRICE = ['昂贵','便宜'];
const FOOD_ORDER = [...FOOD_PRICE, ...FOOD_BASE, ...FOOD_TAIL];
const DRINK_ORDER = [...DRINK_PRICE, ...DRINK_BASE];
const foodRank = new Map(FOOD_ORDER.map((tag, index) => [tag, index]));
const drinkRank = new Map(DRINK_ORDER.map((tag, index) => [tag, index]));

const data = JSON.parse(fs.readFileSync(path.join(root, '中间数据/料亭版攻略数据基线.json'), 'utf8'));
const rowsOf = (sheet) => data.sheets[sheet].rows.map((row) => Object.fromEntries(data.sheets[sheet].headers.map((key, i) => [key, row[i]])));
const tagSet = (rows, field) => new Set(rows.flatMap((row) => String(row[field] || '').split(/[、,，]/).map((tag) => tag.trim()).filter(Boolean)));
const recipeTags = tagSet(rowsOf('recipes'), '菜品标签');
const ingredientTags = tagSet(rowsOf('ingredients'), '标签');
const beverageTags = tagSet(rowsOf('beverages'), '标签');
const expectedFood = (present) => FOOD_ORDER.filter((tag) => present.has(tag));
const expectedDrink = (present) => DRINK_ORDER.filter((tag) => present.has(tag));

const rankOf = (tag, kind) => {
  if (kind === 'drink') return drinkRank.has(tag) ? drinkRank.get(tag) : 10000;
  return foodRank.has(tag) ? foodRank.get(tag) : 10000;
};
const dynamic = (tag) => /动态/.test(tag);
function assertOrdered(lists, kind, label) {
  for (const tags of lists) {
    let previous = -1;
    for (const tag of tags.filter((item) => !dynamic(item))) {
      const rank = rankOf(tag, kind);
      assert.ok(rank >= previous, label + ': 标签顺序不符合附图 — ' + tags.join('、'));
      previous = rank;
    }
    const firstDynamic = tags.findIndex(dynamic);
    if (firstDynamic >= 0) assert.ok(tags.slice(firstDynamic).every(dynamic), label + ': 动态标签必须排在最后 — ' + tags.join('、'));
  }
}
function assertEquals(actual, expected, label) {
  const format = (value) => Array.isArray(value) ? value.join('、') : String(value);
  assert.deepEqual(actual, expected, label + '\n实际: ' + format(actual) + '\n期望: ' + format(expected));
}

(async () => {
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  const visibleChips = () => page.evaluate(() => {
    const bars = Array.from(document.querySelectorAll('#filter-tags .tag-filter-bar')).filter((bar) => !bar.hidden);
    if (bars.length !== 1) return {count: bars.length, tags: []};
    return {count: 1, tags: Array.from(bars[0].querySelectorAll('.tf-suggest .tag.suggest')).map((el) => el.textContent.trim())};
  });
  const cellTagLists = (wrapSelector) => page.evaluate((selector) => {
    const wrap = document.querySelector(selector);
    if (!wrap) return [];
    return Array.from(wrap.querySelectorAll('td.col-tags')).map((cell) => {
      const summary = cell.querySelector('details.cell-tags > summary .table-tags');
      const box = summary || cell.querySelector('.table-tags');
      if (!box) return [];
      return Array.from(box.querySelectorAll('span.tag')).filter((el) => !el.classList.contains('more')).map((el) => el.textContent.trim());
    });
  }, wrapSelector);
  const noticeCount = () => page.evaluate(() => document.querySelectorAll('.recommendation-note').length);
  const pageText = () => page.evaluate(() => document.body.innerText);

  async function gotoHash(hash, selector) {
    await page.goto(url + hash, {waitUntil: 'load'});
    await page.waitForSelector(selector, {timeout: 20000});
  }

  // 1) 菜谱页：两侧筛选标签按附图料理顺序
  await gotoHash('#catalog', '#catalog-table-wrap table tbody tr');
  const catalogChips = (await visibleChips()).tags;
  assertEquals(catalogChips, expectedFood(recipeTags), '菜谱页标签筛选顺序');
  assertOrdered(await cellTagLists('#catalog-table-wrap'), 'food', '菜谱页表格标签');
  await page.locator('#filter-tags').screenshot({path: path.join(outDir, '菜谱_标签筛选顺序.png')});
  await page.locator('#catalog-table-wrap').screenshot({path: path.join(outDir, '菜谱_标签单元格顺序.png')});

  // 2) 食材页：料理标签顺序（含食材独有标签）
  await gotoHash('#ingredients', '#ingredient-table-wrap table tbody tr');
  assertEquals((await visibleChips()).tags, expectedFood(ingredientTags), '食材页标签筛选顺序');
  assertOrdered(await cellTagLists('#ingredient-table-wrap'), 'food', '食材页表格标签');

  // 3) 酒水页：酒水标签按附图顺序（价格标签按游戏序号插位）
  await gotoHash('#beverages', '#beverage-table-wrap table tbody tr');
  assertEquals((await visibleChips()).tags, expectedDrink(beverageTags), '酒水页标签筛选顺序');
  assertOrdered(await cellTagLists('#beverage-table-wrap'), 'drink', '酒水页表格标签');
  await page.locator('#filter-tags').screenshot({path: path.join(outDir, '酒水_标签筛选顺序.png')});

  // 4) 备菜料理页与客人酒单页：提示已移除、筛选与表格顺序正确
  await gotoHash('#details', '#detail-table-wrap table tbody tr');
  assertEquals(await noticeCount(), 0, '备菜料理页不得再有固定口味候选提示');
  assertEquals((await visibleChips()).tags, expectedFood(recipeTags), '备菜料理页标签筛选顺序');
  assertOrdered(await cellTagLists('#detail-table-wrap'), 'food', '备菜料理页表格标签');
  await page.locator('#detail-table-wrap').screenshot({path: path.join(outDir, '备菜料理_无提示.png')});

  await gotoHash('#drinkrecs', '#drinkrec-table-wrap table tbody tr');
  assertEquals(await noticeCount(), 0, '客人酒单页不得再有固定口味候选提示');
  const drinkrecChips = (await visibleChips()).tags;
  assert.ok(drinkrecChips.length > 0, '客人酒单页有标签筛选 chips');
  assertOrdered([drinkrecChips], 'drink', '客人酒单页标签筛选 chips');
  assertOrdered(await cellTagLists('#drinkrec-table-wrap'), 'drink', '客人酒单页表格标签');

  await gotoHash('#addons', '#addon-table-wrap table tbody tr');
  assertEquals(await noticeCount(), 0, '加料参考页不得再有固定口味候选提示');
  const addonChips = (await visibleChips()).tags;
  assert.ok(addonChips.length > 0, '加料参考页有标签筛选 chips');
  assertOrdered([addonChips], 'food', '加料参考页标签筛选 chips');
  assertOrdered(await cellTagLists('#addon-table-wrap'), 'food', '加料参考页表格标签');

  // 5) 客人详情：头部口味标签、筛选 chips、料理/酒水表标签均按附图顺序；两个页签均无提示
  await gotoHash('#guests/' + encodeURIComponent('比那名居天子'), '#detail-panel.open #detail-tastes .taste-row');
  assertEquals(await noticeCount(), 0, '客人详情推荐料理页不得再有固定口味候选提示');
  const headTastes = await page.evaluate(() => Array.from(document.querySelectorAll('#detail-tastes .taste-row')).map((row) => ({
    label: row.querySelector('.tag-label') ? row.querySelector('.tag-label').textContent.trim() : '',
    tags: Array.from(row.querySelectorAll('.tag-wrap .tag')).map((el) => el.textContent.trim())
  })));
  const tasteRow = (label) => headTastes.find((row) => row.label === label);
  assert.ok(tasteRow('喜好料理'), '详情头部有喜好料理标签');
  assertOrdered([tasteRow('喜好料理').tags], 'food', '详情头部喜好料理');
  assertOrdered([tasteRow('厌恶').tags], 'food', '详情头部厌恶');
  assertOrdered([tasteRow('喜好酒水').tags], 'drink', '详情头部喜好酒水');
  const mealChips = await page.evaluate(() => Array.from(document.querySelectorAll('#detail-body .detail-chips .tag')).map((el) => el.textContent.trim()).filter((text) => text !== '清空 ×'));
  assert.ok(mealChips.length > 0, '详情料理有标签筛选 chips');
  assertOrdered([mealChips], 'food', '详情料理筛选 chips');
  assertOrdered(await cellTagLists('#detail-body'), 'food', '详情料理表标签');
  await page.locator('#detail-panel').screenshot({path: path.join(outDir, '客人详情_推荐料理_无提示.png')});

  await page.click('#detail-tabs [data-detail-tab="drinks"]');
  await page.waitForSelector('#detail-drink-search', {timeout: 10000});
  assertEquals(await noticeCount(), 0, '客人详情推荐酒水页不得再有固定口味候选提示');
  const drinkChips = await page.evaluate(() => Array.from(document.querySelectorAll('#detail-body .detail-chips .tag')).map((el) => el.textContent.trim()).filter((text) => text !== '清空 ×'));
  assert.ok(drinkChips.length > 0, '详情酒水有标签筛选 chips');
  assertOrdered([drinkChips], 'drink', '详情酒水筛选 chips');
  assertOrdered(await cellTagLists('#detail-body'), 'drink', '详情酒水表标签');
  await page.locator('#detail-panel').screenshot({path: path.join(outDir, '客人详情_推荐酒水_无提示.png')});

  // 6) 客人卡片与普通客人卡片：喜好/厌恶标签同样按附图顺序，动态标签殿后
  await gotoHash('#guests', '#guest-grid .guest-card');
  const guestCards = await page.evaluate(() => Array.from(document.querySelectorAll('#guest-grid .guest-card')).map((card) => ({
    name: card.querySelector('h3') ? card.querySelector('h3').textContent.trim() : '',
    rows: Array.from(card.querySelectorAll('.tag-row')).map((row) => ({
      label: row.querySelector('.tag-label') ? row.querySelector('.tag-label').textContent.trim() : '',
      tags: Array.from(row.querySelectorAll('.tag-wrap .tag')).filter((el) => !el.classList.contains('more')).map((el) => el.textContent.trim())
    }))
  })));
  assert.ok(guestCards.length > 0, '客人图鉴有卡片');
  for (const card of guestCards) {
    const like = card.rows.find((row) => row.label === '喜好');
    const bad = card.rows.find((row) => row.label === '厌恶');
    if (like) assertOrdered([like.tags], 'food', '客人卡片喜好 ' + card.name);
    if (bad) assertOrdered([bad.tags], 'food', '客人卡片厌恶 ' + card.name);
  }
  // content-visibility:auto 的离屏卡片不会被大图截取绘制，改用滚动后的视口截图记录首屏卡片。
  await page.evaluate(() => {
    const grid = document.querySelector('#guest-grid');
    if (grid) window.scrollTo(0, grid.getBoundingClientRect().top + window.scrollY - 130);
  });
  await page.waitForTimeout(350);
  await page.screenshot({path: path.join(outDir, '客人图鉴_标签顺序.png')});

  await gotoHash('#normal', '#normal-grid .guest-card');
  const normalCards = await page.evaluate(() => Array.from(document.querySelectorAll('#normal-grid .guest-card')).map((card) => ({
    name: card.querySelector('h3') ? card.querySelector('h3').textContent.trim() : '',
    rows: Array.from(card.querySelectorAll('.tag-row')).map((row) => ({
      label: row.querySelector('.tag-label') ? row.querySelector('.tag-label').textContent.trim() : '',
      tags: Array.from(row.querySelectorAll('.tag-wrap .tag')).filter((el) => !el.classList.contains('more')).map((el) => el.textContent.trim())
    }))
  })));
  assert.ok(normalCards.length > 0, '普通客人页有卡片');
  for (const card of normalCards) {
    const like = card.rows.find((row) => row.label === '喜');
    const drink = card.rows.find((row) => row.label === '酒');
    if (like) assertOrdered([like.tags], 'food', '普通客人卡片喜好 ' + card.name);
    if (drink) assertOrdered([drink.tags], 'drink', '普通客人卡片酒水 ' + card.name);
  }

  assert.ok(!(await pageText()).includes('固定口味候选'), '页面正文不再出现固定口味候选提示');
  assertEquals(consoleErrors.length, 0, '页面无脚本/资源错误: ' + consoleErrors.join(' | '));

  fs.writeFileSync(path.join(outDir, '浏览器核验结果.json'), JSON.stringify({
    status: 'PASS',
    checkedAt: new Date().toISOString(),
    liveOutput: path.basename(live),
    urlScheme: 'file',
    browser: 'Microsoft Edge (Playwright chromium channel=msedge, headless)',
    viewport: '1440x1000',
    assertions: {
      catalogChips: catalogChips.length,
      ingredientChips: expectedFood(ingredientTags).length,
      beverageChips: expectedDrink(beverageTags).length,
      detailMealChips: mealChips.length,
      detailDrinkChips: drinkChips.length,
      noticeElements: 0,
      consoleErrors: 0
    },
    note: '核验只读成品 file:// 预览；不代表用户实机使用验收。'
  }, null, 2));
  await browser.close();
  console.log('PASS: 标签显示顺序（料理/酒水）与各界面固定口味候选提示移除，浏览器核验完成；证据: ' + path.relative(root, outDir));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
