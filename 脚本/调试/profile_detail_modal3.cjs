// 三次剖析：innerHTML setter 打桩记录调用栈（闭包函数名在栈中可见），确认每次开/关到底重建了哪些区域。
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
    window.__phase = v => phase = v;
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    Object.defineProperty(Element.prototype, 'innerHTML', {
      configurable: true,
      set(v) {
        if (this.id || phase !== 'idle') {
          const stack = (new Error().stack || '').split('\n').slice(2, 6)
            .map(l => l.trim().replace(/^at\s+/, '').replace(/.*2610102025\.html:(\d+):\d+\)?$/, 'html:$1'))
            .filter(l => !l.startsWith('html:set')).join(' <- ');
          window.__sets.push({phase, target: this.id || this.className, chars: String(v).length, at: Math.round(performance.now()), stack});
        }
        return desc.set.call(this, v);
      },
      get: desc.get
    });
    // 事件时序与长任务。
    window.__eventTiming = [];
    new PerformanceObserver(list => list.getEntries().forEach(e => {
      if (e.interactionId) window.__eventTiming.push({name: e.name, duration: Math.round(e.duration), startTime: Math.round(e.startTime)});
    })).observe({type: 'event', durationThreshold: 16, buffered: true});
  });
  const events = [];
  const cards = page.locator('#guest-grid .guest-card');
  for (let i = 0; i < 3; i++) {
    await page.evaluate(phase => window.__phase(phase), 'open' + (i + 1));
    await cards.nth(i).click();
    await page.waitForTimeout(700);
    await page.evaluate(phase => window.__phase(phase), 'close' + (i + 1));
    await page.click('#detail-close');
    await page.waitForTimeout(500);
  }
  result = {
    sets: await page.evaluate(() => window.__sets.filter(s => s.target === 'guest-grid' || s.target === 'detail-body' || s.chars > 20000)),
    eventTiming: await page.evaluate(() => window.__eventTiming)
  };
  await browser.close();
  const out = path.join(outputDir, 'profile_result3.json');
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
let result;
main().catch(e => { console.error(e); process.exit(1); });
