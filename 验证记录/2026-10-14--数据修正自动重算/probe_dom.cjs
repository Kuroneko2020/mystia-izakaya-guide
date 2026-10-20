// 探测站点渲染 DOM 结构，确认表格行的实际类名/结构。
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const out = JSON.parse(fs.readFileSync(path.join(root, '成品/料亭立体头像版_构建校验.json'), 'utf8')).outputFile;
const file = 'file:///' + path.join(root, '成品', out).split(path.sep).join('/');

(async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage();
  await page.goto(file, { waitUntil: 'load' });
  await page.evaluate(() => { location.hash = '#details?who=上白泽慧音'; });
  await page.waitForTimeout(800);
  const probe1 = await page.evaluate(() => {
    const w = document.querySelector('#detail-table-wrap');
    return {
      hash: location.hash,
      childTags: Array.from(w.children).map((c) => c.tagName + '.' + c.className).slice(0, 8),
      textHead: w.innerText.slice(0, 300),
      rowCount: w.querySelectorAll('tbody tr').length,
      sampleRow: (w.querySelector('tbody tr') || {}).innerText,
    };
  });
  await page.evaluate(() => { location.hash = '#catalog?item=幻想佛跳墙'; });
  await page.waitForTimeout(800);
  const probe2 = await page.evaluate(() => {
    const w = document.querySelector('#catalog-table-wrap');
    return {
      childTags: Array.from(w.children).map((c) => c.tagName + '.' + c.className).slice(0, 8),
      textHead: w.innerText.slice(0, 400),
      rowCount: w.querySelectorAll('tbody tr').length,
    };
  });
  await browser.close();
  console.log(JSON.stringify({ probe1, probe2 }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
