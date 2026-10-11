// 只读探针：定位客人详情四个页签的横向滚动条来源与料理表列宽分布。
// 运行：NODE_PATH=<pw_bridge>/node_modules node 脚本/调试/probe_detail_scrollbars.cjs
// 产物：验证记录/2026-10-11--详情滚动条探针/probe.json 与截图；不修改任何成品。
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const {liveOutput} = require('../live_output.cjs');

const root = path.resolve(__dirname, '..', '..');
const outputDir = path.join(root, '验证记录', '2026-10-11--详情滚动条探针');
const file = liveOutput();

async function main() {
  fs.mkdirSync(outputDir, {recursive: true});
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  const page = await browser.newPage({viewport: {width: 1920, height: 933}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(file).href);

  // 打开客人详情（比那名居天子，与用户截图一致）。
  await page.locator('[data-tab="guests"]').first().click().catch(() => {});
  await page.locator('button.primary-tab[data-group="guests"]').click().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('.guest-card[data-guest="比那名居天子"]').first().click();
  await page.waitForSelector('#detail-panel.open', {timeout: 5000});
  await page.waitForTimeout(400);

  const tabs = ['meals', 'drinks', 'addons', 'bonds'];
  const report = {file: path.basename(file), viewport: '1920x933', tabs: {}, errors};
  for (const tab of tabs) {
    await page.evaluate(t => {
      const button = document.querySelector('#detail-tabs [data-detail-tab="' + t + '"]');
      if (button) button.click();
    }, tab);
    await page.waitForTimeout(350);
    const info = await page.evaluate(() => {
      const panel = document.querySelector('#detail-panel');
      const overflow = [];
      for (const el of panel.querySelectorAll('*')) {
        if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
          const cs = getComputedStyle(el);
          if (cs.overflowX !== 'visible') {
            overflow.push({
              sel: el.id ? '#' + el.id : el.className ? '.' + String(el.className).split(' ').join('.') : el.tagName,
              scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
              overflowX: cs.overflowX, hasHScrollbar: el.offsetWidth - el.clientWidth > 2
            });
          }
        }
      }
      const scroll = panel.querySelector('.detail-scroll');
      const table = panel.querySelector('.data-table');
      let columns = null;
      if (table) {
        columns = [...table.querySelectorAll('thead th')].map(th => ({
          text: th.textContent.trim(), left: Math.round(th.getBoundingClientRect().left),
          width: Math.round(th.getBoundingClientRect().width)
        }));
      }
      return {
        overflow,
        detailScroll: scroll ? {scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth,
          offsetHeight: scroll.offsetHeight, clientHeight: scroll.clientHeight} : null,
        documentHScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        columns,
        tableMinWidth: table ? getComputedStyle(table).minWidth : null,
        tableWidth: table ? Math.round(table.getBoundingClientRect().width) : null
      };
    });
    report.tabs[tab] = info;
    await page.screenshot({path: path.join(outputDir, 'tab-' + tab + '.png')});
  }
  await browser.close();
  fs.writeFileSync(path.join(outputDir, 'probe.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
