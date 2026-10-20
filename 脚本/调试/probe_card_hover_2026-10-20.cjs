// 客人卡片悬停/立体头像效果探针（2026-10-20）：分辨"系统减少动态"与"代码没有效果"。
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
const outDir = path.join(root, '验证记录/2026-10-20--卡片悬停探针');
fs.mkdirSync(outDir, {recursive: true});

const readState = (page) => page.evaluate(() => {
  const card = document.querySelector('#guest-grid .guest-card');
  const ava = card ? card.querySelector('.ava, .seal') : null;
  const styleOf = (el) => el ? getComputedStyle(el) : null;
  const c = styleOf(card), a = styleOf(ava);
  return {
    reduceMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    hoverMedia: window.matchMedia('(hover: hover)').matches,
    cardTransform: c ? c.transform : null,
    cardTransition: c ? c.transitionDuration : null,
    cardShadow: c ? c.boxShadow.slice(0, 60) : null,
    avaTransform: a ? a.transform : null,
    avaTransition: a ? a.transitionDuration : null,
    avatarBlockPresent: !!document.querySelector('style#guest-avatar-3d')
  };
});

(async () => {
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  const results = {};

  for (const mode of ['no-preference', 'reduce']) {
    const page = await browser.newPage({viewport: {width: 1600, height: 900}});
    await page.emulateMedia({reducedMotion: mode});
    await page.goto(url + '#guests', {waitUntil: 'load'});
    await page.waitForSelector('#guest-grid .guest-card', {timeout: 20000});
    const before = await readState(page);
    const card = page.locator('#guest-grid .guest-card').first();
    await card.hover();
    await page.waitForTimeout(400);
    const after = await readState(page);
    await page.screenshot({path: path.join(outDir, '悬停_' + mode + '.png'), clip: {x: 0, y: 0, width: 1600, height: 560}});
    results[mode] = {before, after};
    await page.close();
  }
  await browser.close();

  fs.writeFileSync(path.join(outDir, '探针结果.json'), JSON.stringify(results, null, 2));
  for (const mode of ['no-preference', 'reduce']) {
    const {before, after} = results[mode];
    console.log('=== 媒体设置 ' + mode);
    console.log('  reduceMotion=' + before.reduceMotion + ' hoverMedia=' + before.hoverMedia + ' 3D块存在=' + before.avatarBlockPresent);
    console.log('  卡片 transform: ' + before.cardTransform + ' → ' + after.cardTransform + ' | transition=' + before.cardTransition);
    console.log('  头像 transform: ' + before.avaTransform + ' → ' + after.avaTransform + ' | transition=' + before.avaTransition);
  }
  const normal = results['no-preference'];
  const reduced = results.reduce;
  console.log('\n判定: 无偏好时悬停' + (normal.before.avaTransform !== normal.after.avaTransform ? '改变头像 transform' : '未改变头像 transform')
    + '；减少动态时悬停' + (reduced.before.avaTransform !== reduced.after.avaTransform ? '仍改变(仅瞬时)' : '未改变'));
})().catch((error) => { console.error(error); process.exit(1); });
