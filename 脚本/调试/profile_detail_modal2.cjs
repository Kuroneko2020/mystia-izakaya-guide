// 二次剖析：CPU 采样定位打开点击的 119ms 长调用；测量连续开/关的稳态输入延迟；监测网格重渲染。
// 运行：NODE_PATH=<pw_bridge>/node_modules node 脚本/调试/profile_detail_modal2.cjs
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
  const result = {file: path.basename(file)};
  try {
    await page.goto(pathToFileURL(file).href);
    await page.waitForSelector('#guest-grid .guest-card');
    await page.waitForTimeout(600);

    // 监测主内容区是否被重建。
    await page.evaluate(() => {
      window.__mutations = {grid: 0, detail: 0, normal: 0};
      const mo = new MutationObserver(list => list.forEach(e => {
        if (e.target.id === 'guest-grid') window.__mutations.grid++;
        if (e.target.id === 'detail-body') window.__mutations.detail++;
        if (e.target.id === 'normal-grid') window.__mutations.normal++;
      }));
      mo.observe(document.body, {childList: true, subtree: true});
      window.__eventTiming = [];
      new PerformanceObserver(list => list.getEntries().forEach(e => {
        if (e.interactionId) window.__eventTiming.push({name: e.name, duration: Math.round(e.duration),
          processingStart: Math.round(e.processingStart), startTime: Math.round(e.startTime)});
      })).observe({type: 'event', durationThreshold: 16, buffered: true});
      window.__longtasks = [];
      new PerformanceObserver(list => list.getEntries().forEach(e =>
        window.__longtasks.push({duration: Math.round(e.duration), startTime: Math.round(e.startTime)})
      )).observe({entryTypes: ['longtask']});
    });

    // 稳态模拟用户操作：开 → 关 × 4（不同客人），不加 tracing 开销。
    const cards = page.locator('#guest-grid .guest-card');
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(700);
      await cards.nth(i).click();
      await page.waitForTimeout(700);
      await page.click('#detail-close');
    }
    await page.waitForTimeout(300);
    result.steadyEventTiming = await page.evaluate(() => window.__eventTiming);
    result.steadyLongtasks = await page.evaluate(() => window.__longtasks);
    result.mutations = await page.evaluate(() => window.__mutations);

    // 新开页面做 CPU 采样：第 1 次与第 2 次打开对比。
    const page2 = await browser.newPage({viewport: {width: 1440, height: 900}, reducedMotion: 'no-preference'});
    await page2.goto(pathToFileURL(file).href);
    await page2.waitForSelector('#guest-grid .guest-card');
    await page2.waitForTimeout(600);
    const client = await page2.context().newCDPSession(page2);
    await client.send('Profiler.enable');
    const cpu = {};
    for (const round of ['first', 'second']) {
      await client.send('Profiler.start');
      await page2.click('#guest-grid .guest-card >> nth=0');
      await page2.waitForTimeout(650);
      const {profile} = await client.send('Profiler.stop');
      // 汇总自耗时最高的 JS 函数（闭包名可能为空，用 url+line 定位）。
      const nodes = new Map(profile.nodes.map(n => [n.id, n]));
      const self = new Map();
      const byTime = (samples, deltas) => {
        samples.forEach((id, i) => {
          const n = nodes.get(id);
          if (!n || !n.callFrame.url.includes('2610') && !n.callFrame.url.includes('file:')) return;
          const key = (n.callFrame.functionName || '(anonymous)') + ' @' + n.callFrame.url.split('/').pop() + ':' + n.callFrame.lineNumber;
          self.set(key, (self.get(key) || 0) + deltas[i]);
        });
      };
      // 时间片近似：每个采样点间隔 = total 时间/采样数（profile 有 timeDeltas）。
      byTime(profile.samples, profile.timeDeltas.map(d => d / 1000));
      cpu[round] = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)
        .map(([k, v]) => ({fn: k, selfMs: +v.toFixed(1)}));
      if (round === 'first') { // 复位到关闭态再测第二次打开
        await page2.click('#detail-close');
        await page2.waitForTimeout(500);
      }
    }
    result.cpu = cpu;
    result.mutations2 = await page2.evaluate(() => window.__mutations || 'n/a');
    await page2.close();
  } finally {
    await browser.close();
  }
  const out = path.join(outputDir, 'profile_result2.json');
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
