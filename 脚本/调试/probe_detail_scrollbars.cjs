// 只读探针：定位客人详情四个页签的横向滚动条来源与料理表列宽分布。
// 运行：NODE_PATH=<pw_bridge>/node_modules node 脚本/调试/probe_detail_scrollbars.cjs
// 产物：验证记录/2026-10-11--详情滚动条探针/probe.json 与截图；不修改任何成品。
// 2026-10-11 起详情滚动由内层 .detail-scroller 承担，外层 .detail-scroll 仅承载名字水印独立图层；
// 水印垂直位置由 ryoteiUpdateNameMark 动态计算（装得下居中固定；装不下随滚动露底后钉住）。
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const {liveOutput} = require('../live_output.cjs');

const root = path.resolve(__dirname, '..', '..');
const outputDir = path.join(root, '验证记录', '2026-10-11--详情滚动条探针');
const file = liveOutput();

async function openDetail(page, guest) {
  await page.locator('button.primary-tab[data-group="guests"]').click();
  await page.waitForTimeout(300);
  await page.locator('.guest-card[data-guest="' + guest + '"]').first().click();
  await page.waitForSelector('#detail-panel.open', {timeout: 5000});
  await page.waitForTimeout(400);
}
async function markState(page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('#detail-body .detail-scroller');
    const mark = document.querySelector('#detail-body .detail-name-mark');
    const m = new DOMMatrixReadOnly(getComputedStyle(mark).transform === 'none' ? '' : getComputedStyle(mark).transform);
    return {name: mark.textContent, markH: mark.offsetHeight, viewportH: scroller.clientHeight,
      scrollTop: scroller.scrollTop, shiftY: +m.m42.toFixed(1),
      scrollH: scroller.scrollHeight, clientH: scroller.clientHeight};
  });
}

async function main() {
  fs.mkdirSync(outputDir, {recursive: true});
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  const page = await browser.newPage({viewport: {width: 1920, height: 933}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(file).href);

  // 长名（比那名居天子，6 字）：先露上段，滚动露出底部后钉住。
  await openDetail(page, '比那名居天子');
  const report = {file: path.basename(file), viewport: '1920x933', errors};
  await page.evaluate(() => document.querySelector('#detail-tabs [data-detail-tab="meals"]').click());
  await page.waitForTimeout(300);
  report.longNameTop = await markState(page);
  await page.screenshot({path: path.join(outputDir, 'tab-meals.png')});
  await page.evaluate(() => { const s = document.querySelector('#detail-body .detail-scroller'); s.scrollTop = s.scrollHeight; });
  await page.waitForTimeout(300);
  report.longNameScrolled = await markState(page);
  await page.screenshot({path: path.join(outputDir, 'tab-meals-scrolled.png')});

  // 短名（博丽灵梦，4 字）：居中固定，滚动前后 shift 不变。
  await page.evaluate(() => { document.querySelector('#detail-panel .icon-btn').click(); });
  await page.waitForTimeout(300);
  await openDetail(page, '博丽灵梦');
  await page.waitForTimeout(300);
  report.shortNameTop = await markState(page);
  await page.evaluate(() => { const s = document.querySelector('#detail-body .detail-scroller'); s.scrollTop = s.scrollHeight; });
  await page.waitForTimeout(300);
  report.shortNameScrolled = await markState(page);

  // 其余页签横向溢出复查。
  await page.evaluate(() => { document.querySelector('#detail-panel .icon-btn').click(); });
  await page.waitForTimeout(300);
  await openDetail(page, '比那名居天子');
  report.tabs = {};
  for (const tab of ['meals', 'drinks', 'addons', 'bonds']) {
    await page.evaluate(t => {
      const button = document.querySelector('#detail-tabs [data-detail-tab="' + t + '"]');
      if (button) button.click();
    }, tab);
    await page.waitForTimeout(350);
    report.tabs[tab] = await page.evaluate(() => {
      const outer = document.querySelector('#detail-body .detail-scroll');
      const scroller = document.querySelector('#detail-body .detail-scroller');
      return {
        outer: {overflowX: getComputedStyle(outer).overflowX, scrollWidth: outer.scrollWidth, clientWidth: outer.clientWidth},
        scroller: {scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth,
          scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight}
      };
    });
    if (tab !== 'meals') await page.screenshot({path: path.join(outputDir, 'tab-' + tab + '.png')});
  }
  await browser.close();
  fs.writeFileSync(path.join(outputDir, 'probe.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
