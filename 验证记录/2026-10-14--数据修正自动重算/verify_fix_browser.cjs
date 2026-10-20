// 浏览器实测：走站点真实 UI 断言——
// 1) 慧音备菜名单搜索“大份”/“佛跳墙”均 0 道；2) 菜谱页幻想佛跳墙行含“大份”标签。
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
  await page.waitForTimeout(500);
  const countAfter = async (keyword) => {
    await page.fill('#detail-search', '');
    await page.fill('#detail-search', keyword);
    await page.waitForTimeout(400);
    return (await page.textContent('#detail-count')).trim();
  };
  const total = (await page.textContent('#detail-count')).trim();
  const bigCount = await countAfter('大份');
  const fantasiaCount = await countAfter('佛跳墙');

  await page.evaluate(() => { location.hash = '#catalog?item=幻想佛跳墙'; });
  await page.waitForTimeout(500);
  const catalogRow = await page.evaluate(() => {
    const tr = document.querySelector('#catalog-table-wrap tbody tr');
    return tr ? tr.innerText.replace(/\s+/g, ' ') : '';
  });

  // 加料页：慧音任意一行不得推荐会产生大份的组合（表体存在即可读）
  await page.evaluate(() => { location.hash = '#addons?who=上白泽慧音'; });
  await page.waitForTimeout(500);
  const addonText = await page.evaluate(() => document.querySelector('#addon-table-wrap').innerText.slice(0, 400));

  const result = {
    outputFile: out,
    mealTotal: total,
    searchBigCount: bigCount,
    searchFantasiaCount: fantasiaCount,
    catalogRow: catalogRow.slice(0, 200),
    addonSample: addonText.replace(/\n/g, ' | ').slice(0, 300),
  };
  await browser.close();
  const pass = /^0\s*\//.test(bigCount) && /^0\s*\//.test(fantasiaCount) && catalogRow.includes('大份');
  result.pass = pass;
  console.log(JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(__dirname, '浏览器实测_慧音名单.json'), JSON.stringify(result, null, 2));
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
