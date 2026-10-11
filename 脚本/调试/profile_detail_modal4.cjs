// 四次剖析：区分同步点击处理器与异步 hashchange/popstate 的重建归属 + 完整调用栈 + changed 归因。
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const {liveOutput} = require('../live_output.cjs');

const root = path.resolve(__dirname, '..', '..');
const outputDir = path.join(root, '验证记录', '2026-10-11--详情弹窗性能排查');
const file = liveOutput();

async function main() {
  fs.mkdirSync(outputDir, {recursive: true});
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  const page = await browser.newPage({viewport: {width: 1440, height: 900}, reducedMotion: 'no-preference'});
  await page.goto(pathToFileURL(file).href);
  await page.waitForSelector('#guest-grid .guest-card');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.__sets = [];
    let phase = 'idle';
    window.__phase = v => { phase = v; };
    // 页面自身的监听器先注册；我们的标记监听后触发，用于标记"异步阶段"。
    window.addEventListener('hashchange', () => { phase = 'hashchange'; });
    window.addEventListener('popstate', () => { phase = 'popstate'; });
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    Object.defineProperty(Element.prototype, 'innerHTML', {
      configurable: true,
      set(v) {
        const stack = (new Error().stack || '').split('\n').slice(2, 12)
          .map(l => l.trim().replace(/^at\s+/, '').replace(/.*2610102025\.html:(\d+):\d+\)?$/, 'html:$1'))
          .join(' <- ');
        window.__sets.push({phase, target: this.id || this.className, chars: String(v).length,
          at: Math.round(performance.now()), stack});
        return desc.set.call(this, v);
      },
      get: desc.get
    });
  });
  const cards = page.locator('#guest-grid .guest-card');
  for (let i = 0; i < 2; i++) {
    await page.evaluate(phase => window.__phase(phase), 'open' + (i + 1));
    await cards.nth(i).click();
    await page.waitForTimeout(800);
    await page.evaluate(phase => window.__phase(phase), 'close' + (i + 1));
    await page.click('#detail-close');
    await page.waitForTimeout(600);
  }
  const result = {sets: await page.evaluate(() => window.__sets.filter(s => s.target === 'guest-grid' || s.target === 'detail-body'))};
  await browser.close();
  const out = path.join(outputDir, 'profile_result4.json');
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
