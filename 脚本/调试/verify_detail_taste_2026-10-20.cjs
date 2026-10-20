// 客人详情头部口味标签＝页签内筛选 chip 快捷入口的浏览器核验（2026-10-20）。
// 只读活成品：加载 file:// 页面，点头部标签核对 chip 同步、酒水自动切页签、双向高亮，截取证据图。
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
const outDir = path.join(root, '验证记录/2026-10-20--详情头部标签快捷筛选');
fs.mkdirSync(outDir, {recursive: true});

const GUEST = '比那名居天子';

(async () => {
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  const tasteRows = () => page.evaluate(() => Array.from(document.querySelectorAll('#detail-tastes .taste-row')).map((row) => ({
    label: row.querySelector('.tag-label') ? row.querySelector('.tag-label').textContent.trim() : '',
    tags: Array.from(row.querySelectorAll('.tag-wrap > *')).map((el) => ({
      text: el.textContent.trim(),
      button: el.tagName === 'BUTTON',
      pressed: el.getAttribute('aria-pressed')
    }))
  })));
  const chipState = () => page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('#detail-body .detail-chips .tag[data-detail-chip]')).map((el) => [el.textContent.trim(), {
    active: el.classList.contains('active'),
    pressed: el.getAttribute('aria-pressed')
  }])));
  const activeTab = () => page.evaluate(() => {
    const button = document.querySelector('#detail-tabs button.active');
    return button ? button.dataset.detailTab : '';
  });
  const mealCount = () => page.evaluate(() => {
    const node = document.querySelector('#detail-meal-count');
    return node ? node.textContent.trim() : '';
  });
  const tasteButton = (label, tag) => page.locator('#detail-tastes .taste-row', {hasText: label}).first().locator('button[data-detail-taste="' + tag + '"]').first();

  await page.goto(url + '#guests/' + encodeURIComponent(GUEST), {waitUntil: 'load'});
  await page.waitForSelector('#detail-panel.open #detail-tastes .taste-row', {timeout: 20000});
  await page.waitForSelector('#guest-meals .detail-chips .tag[data-detail-chip]', {timeout: 20000});

  // 1) 头部只有喜好料理/喜好酒水可点，厌恶与动态标签保持静态
  const rows = await tasteRows();
  const row = (label) => rows.find((item) => item.label === label);
  assert.ok(row('喜好料理') && row('喜好料理').tags.length > 0, '头部有喜好料理标签');
  assert.ok(row('喜好料理').tags.some((tag) => tag.button), '喜好料理至少有一个可点标签');
  assert.ok(row('喜好料理').tags.filter((tag) => tag.button).every((tag) => tag.pressed === 'false'), '头部按钮初始为未选中');
  assert.ok(row('喜好酒水') && row('喜好酒水').tags.length > 0, '头部有喜好酒水标签');
  assert.ok(row('喜好酒水').tags.some((tag) => tag.button), '喜好酒水标签可点');
  if (row('厌恶')) assert.equal(row('厌恶').tags.some((tag) => tag.button), false, '厌恶行不产生可点标签');
  const dynamicTags = rows.flatMap((item) => item.tags).filter((tag) => /动态/.test(tag.text));
  assert.ok(dynamicTags.every((tag) => !tag.button), '动态流行标签保持静态');

  // 2) 点喜好料理标签＝点红框同名 chip：chip 高亮、计数变化、再点取消
  const mealChips = Object.keys(await chipState());
  const foodTag = row('喜好料理').tags.map((tag) => tag.text).find((text) => mealChips.includes(text));
  assert.ok(foodTag, '头部喜好料理标签在料理筛选 chips 中存在同名项: ' + row('喜好料理').tags.map((tag) => tag.text).join('、'));
  const countBefore = await mealCount();
  await tasteButton('喜好料理', foodTag).click();
  await page.waitForTimeout(120);
  const afterClick = await chipState();
  assert.ok(afterClick[foodTag] && afterClick[foodTag].active === true, '点头部料理标签后红框同名 chip 选中: ' + foodTag);
  assert.equal(afterClick[foodTag].pressed, 'true', '红框 chip 同步 aria-pressed');
  const headAfter = (await tasteRows()).find((item) => item.label === '喜好料理').tags.find((tag) => tag.text === foodTag);
  assert.equal(headAfter.pressed, 'true', '头部标签自身回写选中态');
  assert.notEqual(await mealCount(), countBefore, '料理计数按该标签过滤后变化');
  await page.locator('#detail-panel').screenshot({path: path.join(outDir, '头部料理标签选中_推荐料理.png')});

  await tasteButton('喜好料理', foodTag).click();
  await page.waitForTimeout(120);
  assert.equal((await chipState())[foodTag].active, false, '再点头部料理标签取消筛选');
  assert.equal(await mealCount(), countBefore, '取消后计数回到未筛选');

  // 3) 红框点 chip，头部同步高亮（反向）
  await page.locator('#guest-meals .detail-chips .tag[data-detail-chip="' + foodTag + '"]').first().click();
  await page.waitForTimeout(120);
  const headReverse = (await tasteRows()).find((item) => item.label === '喜好料理').tags.find((tag) => tag.text === foodTag);
  assert.equal(headReverse.pressed, 'true', '红框点 chip 后头部同步高亮');
  await page.locator('#guest-meals .detail-chips .tag[data-detail-chip="' + foodTag + '"]').first().click();
  await page.waitForTimeout(120);
  assert.equal((await tasteRows()).find((item) => item.label === '喜好料理').tags.find((tag) => tag.text === foodTag).pressed, 'false', '取消 chip 后头部恢复');

  // 4) 料理页签点喜好酒水标签：自动切到推荐酒水并应用
  await page.click('#detail-tabs [data-detail-tab="drinks"]');
  await page.waitForSelector('#guest-drinks .detail-chips .tag[data-detail-chip]', {timeout: 20000});
  const drinkChips = Object.keys(await chipState());
  const drinkTag = row('喜好酒水').tags.map((tag) => tag.text).find((text) => drinkChips.includes(text));
  assert.ok(drinkTag, '头部喜好酒水标签在酒水筛选 chips 中存在同名项: ' + row('喜好酒水').tags.map((tag) => tag.text).join('、'));
  await page.click('#detail-tabs [data-detail-tab="meals"]');
  await page.waitForSelector('#guest-meals .detail-chips .tag[data-detail-chip]', {timeout: 20000});
  assert.equal(await activeTab(), 'meals', '点击前停在推荐料理页签');
  await tasteButton('喜好酒水', drinkTag).click();
  await page.waitForSelector('#guest-drinks .detail-chips .tag[data-detail-chip]', {timeout: 20000});
  assert.equal(await activeTab(), 'drinks', '点头部酒水标签自动切到推荐酒水页签');
  const drinkAfter = await chipState();
  assert.ok(drinkAfter[drinkTag] && drinkAfter[drinkTag].active === true, '酒水 chip 已按头部标签选中: ' + drinkTag);
  assert.equal((await tasteRows()).find((item) => item.label === '喜好酒水').tags.find((tag) => tag.text === drinkTag).pressed, 'true', '头部酒水标签回写选中态');
  await page.locator('#detail-panel').screenshot({path: path.join(outDir, '头部酒水标签自动切页签.png')});

  assert.deepEqual(consoleErrors, [], '页面无脚本/资源错误: ' + consoleErrors.join(' | '));

  fs.writeFileSync(path.join(outDir, '浏览器核验结果.json'), JSON.stringify({
    status: 'PASS',
    checkedAt: new Date().toISOString(),
    liveOutput: path.basename(live),
    guest: GUEST,
    browser: 'Microsoft Edge (Playwright chromium channel=msedge, headless)',
    viewport: '1440x1000',
    assertions: {
      headFoodTags: row('喜好料理').tags.length,
      headDrinkTags: row('喜好酒水').tags.length,
      dislikeClickable: false,
      mealTagApplied: foodTag,
      drinkTagApplied: drinkTag,
      autoSwitchedTab: true,
      consoleErrors: 0
    },
    note: '核验只读成品 file:// 预览；不代表用户实机使用验收。'
  }, null, 2));
  await browser.close();
  console.log('PASS: 头部口味标签驱动页签内筛选（料理/酒水、自动切页签、双向高亮）；证据: ' + path.relative(root, outDir));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
