// 客人详情「料理页↔酒水页」跨页签点头部口味标签的浏览器核验（2026-10-21）。
// 只读活成品：file:// 加载，核对点头部对侧标签时取消本页签已选标签并跳页签、同页签点击不牵连另一侧。
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
const outDir = path.join(root, '验证记录/2026-10-21--详情跨页签标签取消与跳转');
fs.mkdirSync(outDir, {recursive: true});

const GUEST = '比那名居天子';
const MEAL = 'meals';
const DRINK = 'drinks';

(async () => {
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  const tasteRows = () => page.evaluate(() => Array.from(document.querySelectorAll('#detail-tastes .taste-row')).map((row) => ({
    label: row.querySelector('.tag-label') ? row.querySelector('.tag-label').textContent.trim() : '',
    tags: Array.from(row.querySelectorAll('.tag-wrap > *')).map((el) => ({
      text: el.textContent.trim(), button: el.tagName === 'BUTTON', pressed: el.getAttribute('aria-pressed')
    }))
  })));
  const chipState = () => page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('#detail-body .detail-chips .tag[data-detail-chip]')).map((el) => [el.textContent.trim(), {
    active: el.classList.contains('active'), pressed: el.getAttribute('aria-pressed')
  }])));
  const activeChips = async () => Object.entries(await chipState()).filter(([, value]) => value.active).map(([key]) => key);
  const activeTab = () => page.evaluate(() => {
    const button = document.querySelector('#detail-tabs button.active');
    return button ? button.dataset.detailTab : '';
  });
  const mealCount = () => page.evaluate(() => {
    const node = document.querySelector('#detail-meal-count');
    return node ? node.textContent.trim() : '';
  });
  const tasteButton = (label, tag) => page.locator('#detail-tastes .taste-row', {hasText: label}).first().locator('button[data-detail-taste="' + tag + '"]').first();
  const paneChips = async (tab) => {
    await page.click('#detail-tabs [data-detail-tab="' + tab + '"]');
    await page.waitForSelector('#guest-' + tab + ' .detail-chips .tag[data-detail-chip]', {timeout: 20000});
    return Object.keys(await chipState());
  };

  await page.goto(url + '#guests/' + encodeURIComponent(GUEST), {waitUntil: 'load'});
  await page.waitForSelector('#detail-panel.open #detail-tastes .taste-row', {timeout: 20000});
  await page.waitForSelector('#guest-meals .detail-chips .tag[data-detail-chip]', {timeout: 20000});

  const rows = await tasteRows();
  const row = (label) => rows.find((item) => item.label === label);
  const mealChipNames = Object.keys(await chipState());
  const mealTag = row('喜好料理').tags.map((tag) => tag.text).find((text) => mealChipNames.includes(text));
  assert.ok(mealTag, '头部喜好料理标签与料理 chips 有同名项');
  const drinkChipNames = await paneChips(DRINK);
  const drinkTag = row('喜好酒水').tags.map((tag) => tag.text).find((text) => drinkChipNames.includes(text));
  assert.ok(drinkTag, '头部喜好酒水标签与酒水 chips 有同名项');
  await page.click('#detail-tabs [data-detail-tab="' + MEAL + '"]');
  await page.waitForSelector('#guest-meals .detail-chips .tag[data-detail-chip]', {timeout: 20000});
  const mealCountBase = await mealCount();

  // 1) 料理页点料理标签：正常选中（未跳页签）
  await tasteButton('喜好料理', mealTag).click();
  await page.waitForTimeout(150);
  assert.equal(await activeTab(), MEAL, '点本页签标签不跳页签');
  assert.deepEqual(await activeChips(), [mealTag], '料理标签已选中');
  assert.notEqual(await mealCount(), mealCountBase, '料理计数按该标签过滤');

  // 2) 料理页点喜好酒水：取消料理页已选标签并跳到推荐酒水
  await tasteButton('喜好酒水', drinkTag).click();
  await page.waitForSelector('#guest-drinks .detail-chips .tag[data-detail-chip]', {timeout: 20000});
  await page.waitForTimeout(150);
  assert.equal(await activeTab(), DRINK, '料理页点酒水标签跳到推荐酒水页签');
  assert.deepEqual(await activeChips(), [drinkTag], '酒水页只保留刚点的酒水标签');
  const drinkHead = (await tasteRows()).find((item) => item.label === '喜好酒水').tags.find((tag) => tag.text === drinkTag);
  assert.equal(drinkHead.pressed, 'true', '头部酒水标签回写选中态');
  await page.locator('#detail-panel').screenshot({path: path.join(outDir, '料理页点酒水_取消料理标签并跳转.png')});
  await page.click('#detail-tabs [data-detail-tab="' + MEAL + '"]');
  await page.waitForSelector('#guest-meals .detail-chips .tag[data-detail-chip]', {timeout: 20000});
  assert.deepEqual(await activeChips(), [], '回到料理页时料理标签选择已取消');
  assert.equal(await mealCount(), mealCountBase, '料理计数回到未筛选');
  const mealHead = (await tasteRows()).find((item) => item.label === '喜好料理').tags.find((tag) => tag.text === mealTag);
  assert.equal(mealHead.pressed, 'false', '头部料理标签取消选中');

  // 3) 反向：酒水页点喜好料理：取消酒水页已选标签并跳到推荐料理
  await page.click('#detail-tabs [data-detail-tab="' + DRINK + '"]');
  await page.waitForSelector('#guest-drinks .detail-chips .tag[data-detail-chip]', {timeout: 20000});
  assert.deepEqual(await activeChips(), [drinkTag], '跳页签后酒水标签仍在（上一轮选中）');
  await tasteButton('喜好料理', mealTag).click();
  await page.waitForSelector('#guest-meals .detail-chips .tag[data-detail-chip]', {timeout: 20000});
  await page.waitForTimeout(150);
  assert.equal(await activeTab(), MEAL, '酒水页点料理标签跳到推荐料理页签');
  assert.deepEqual(await activeChips(), [mealTag], '料理页只保留刚点的料理标签');
  await page.locator('#detail-panel').screenshot({path: path.join(outDir, '酒水页点料理_取消酒水标签并跳转.png')});
  await page.click('#detail-tabs [data-detail-tab="' + DRINK + '"]');
  await page.waitForSelector('#guest-drinks .detail-chips .tag[data-detail-chip]', {timeout: 20000});
  assert.deepEqual(await activeChips(), [], '回到酒水页时酒水标签选择已取消');

  // 步骤 3 留下的料理标签先取消，第 4 步从“两侧都空”开始。
  await page.click('#detail-tabs [data-detail-tab="' + MEAL + '"]');
  await page.waitForSelector('#guest-meals .detail-chips .tag[data-detail-chip]', {timeout: 20000});
  await tasteButton('喜好料理', mealTag).click();
  await page.waitForTimeout(150);
  assert.deepEqual(await activeChips(), [], '步骤 3 留下的料理标签已取消');
  await page.click('#detail-tabs [data-detail-tab="' + DRINK + '"]');
  await page.waitForSelector('#guest-drinks .detail-chips .tag[data-detail-chip]', {timeout: 20000});

  // 4) 同页签点击不牵连另一侧：酒水页点红框 chip 选中，切到料理页点料理标签，酒水标签保留
  await page.locator('#guest-drinks .detail-chips .tag[data-detail-chip="' + drinkTag + '"]').first().click();
  await page.waitForTimeout(150);
  assert.deepEqual(await activeChips(), [drinkTag], '酒水红框 chip 选中');
  await page.click('#detail-tabs [data-detail-tab="' + MEAL + '"]');
  await page.waitForSelector('#guest-meals .detail-chips .tag[data-detail-chip]', {timeout: 20000});
  await tasteButton('喜好料理', mealTag).click();
  await page.waitForTimeout(150);
  assert.equal(await activeTab(), MEAL, '同页签点击不跳页签');
  assert.deepEqual(await activeChips(), [mealTag], '料理页只选中刚点的料理标签');
  await page.click('#detail-tabs [data-detail-tab="' + DRINK + '"]');
  await page.waitForSelector('#guest-drinks .detail-chips .tag[data-detail-chip]', {timeout: 20000});
  assert.deepEqual(await activeChips(), [drinkTag], '同页签点击不清空另一侧已选标签');

  assert.deepEqual(consoleErrors, [], '页面无脚本/资源错误: ' + consoleErrors.join(' | '));

  fs.writeFileSync(path.join(outDir, '浏览器核验结果.json'), JSON.stringify({
    status: 'PASS',
    checkedAt: new Date().toISOString(),
    liveOutput: path.basename(live),
    guest: GUEST,
    browser: 'Microsoft Edge (Playwright chromium channel=msedge, headless)',
    viewport: '1440x1000',
    assertions: {
      mealTagApplied: mealTag,
      drinkTagApplied: drinkTag,
      mealToDrinkCancelledMealChips: true,
      drinkToMealCancelledDrinkChips: true,
      samePaneKeepsOtherSide: true,
      consoleErrors: 0
    },
    note: '核验只读成品 file:// 预览；不代表用户实机使用验收。'
  }, null, 2));
  await browser.close();
  console.log('PASS: 详情料理↔酒水跨页签点头部标签＝取消对侧已选标签并跳页签（双向），同页签点击不牵连另一侧；证据: ' + path.relative(root, outDir));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
