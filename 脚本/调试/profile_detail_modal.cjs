// 诊断营业图鉴详情弹窗开/关的卡顿来源：真 Edge + CDP Tracing（含样式失效追踪）+ Event Timing + 微基准。
// 模板主脚本为 IIFE 闭包，无法打桩，因此用 tracing 事件与合成微基准归因。
// 运行：NODE_PATH=<pw_bridge>/node_modules node 脚本/调试/profile_detail_modal.cjs [--headed]
// 产物：验证记录/2026-10-11--详情弹窗性能排查/profile_result.json
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const {liveOutput} = require('../live_output.cjs');

const root = path.resolve(__dirname, '..', '..');
const outputDir = path.join(root, '验证记录', '2026-10-11--详情弹窗性能排查');
const file = liveOutput();

async function traceWindow(page, action) {
  const client = await page.context().newCDPSession(page);
  await client.send('Tracing.start', {traceConfig: {includedCategories: [
    'devtools.timeline', 'toplevel',
    'disabled-by-default-devtools.timeline.invalidationTracking'
  ]}});
  const result = await action();
  const stream = '';
  let done;
  const dataPromise = new Promise(r => { done = r; });
  const chunks = [];
  client.on('Tracing.dataCollected', e => chunks.push(...e.value));
  client.on('Tracing.tracingComplete', done);
  await client.send('Tracing.end');
  await dataPromise;
  // 主线程事件归类：按 name 汇总时长与次数，样式失效按 reason 汇总。
  const byName = new Map();
  const invalidations = new Map();
  for (const e of chunks) {
    if (!e.cat || !String(e.cat).includes('devtools.timeline')) continue;
    if (['EventDispatch', 'FunctionCall', 'UpdateLayoutTree', 'UpdateLayout', 'Paint', 'PrePaint',
      'UpdateLayerTree', 'Commit', 'HitTest', 'ImageDecodeTask', 'DecodeImage', 'FireAnimationFrame',
      'RecalculateStyles', 'ScheduleStyleRecalculation', 'InvalidateLayout', 'RunTask'].includes(e.name)) {
      const dur = e.dur || 0;
      const item = byName.get(e.name) || {count: 0, totalMs: 0, maxMs: 0};
      item.count++; item.totalMs += dur / 1000; item.maxMs = Math.max(item.maxMs, dur / 1000);
      byName.set(e.name, item);
    }
    if (e.name === 'StyleRecalcInvalidationTracking') {
      const reason = (e.args && e.args.data && e.args.data.reason) || 'unknown';
      const item = invalidations.get(reason) || {count: 0, samples: []};
      item.count++;
      const node = e.args && e.args.data ? (e.args.data.nodeName || '') + (e.args.data.addedAttribute || e.args.data.changedAttribute ? '.' + (e.args.data.addedAttribute || e.args.data.changedAttribute) : '') : '';
      if (item.samples.length < 3) item.samples.push(node);
      invalidations.set(reason, item);
    }
  }
  const summary = Object.fromEntries([...byName.entries()]
    .map(([k, v]) => [k, {count: v.count, totalMs: +v.totalMs.toFixed(1), maxMs: +v.maxMs.toFixed(1)}])
    .sort((a, b) => b[1].totalMs - a[1].totalMs));
  const invSummary = Object.fromEntries([...invalidations.entries()]
    .map(([k, v]) => [k, {count: v.count, samples: v.samples}])
    .sort((a, b) => b[1].count - a[1].count));
  return {...result, timeline: summary, styleInvalidations: invSummary};
}

const frameProbe = () => `
  window.__stamps=[];window.__stop=false;
  (function loop(t){window.__stamps.push(t);if(!window.__stop)requestAnimationFrame(loop);})(performance.now());`;

async function frameResult(page) {
  const stamps = await page.evaluate(() => { window.__stop = true; return window.__stamps.slice(); });
  const gaps = stamps.slice(1).map((t, i) => t - stamps[i]).filter(g => g >= 0 && g < 250);
  const sorted = gaps.slice().sort((a, b) => a - b);
  return {frames: gaps.length, medianGap: sorted.length ? +sorted[Math.floor(sorted.length / 2)].toFixed(1) : 0,
    p95Gap: sorted.length ? +sorted[Math.floor(sorted.length * 0.95)].toFixed(1) : 0,
    maxGap: sorted.length ? +sorted[sorted.length - 1].toFixed(1) : 0,
    jankyOver32ms: gaps.filter(g => g > 32).length};
}

async function main() {
  fs.mkdirSync(outputDir, {recursive: true});
  const headed = process.argv.includes('--headed');
  const browser = await chromium.launch({channel: 'msedge', headless: !headed});
  const page = await browser.newPage({viewport: {width: 1440, height: 900}, reducedMotion: 'no-preference'});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const result = {file: path.basename(file), mode: headed ? 'headed' : 'headless', errors};
  try {
    await page.goto(pathToFileURL(file).href);
    await page.waitForSelector('#guest-grid .guest-card');
    await page.waitForTimeout(800);

    result.environment = await page.evaluate(() => {
      const pick = (selector, props) => { const el = document.querySelector(selector); if (!el) return null;
        const cs = getComputedStyle(el); return Object.fromEntries(props.map(p => [p, cs.getPropertyValue(p)])); };
      return {
        styles: {
          backdrop: pick('.detail-backdrop', ['backdrop-filter', 'background-color', 'transition', 'z-index']),
          panel: pick('.detail-panel', ['backdrop-filter', 'box-shadow', 'transition-property', 'transition-duration', 'width', 'will-change', 'position']),
          head: pick('.detail-head', ['backdrop-filter', 'position', 'z-index']),
          html: pick('html', ['scrollbar-gutter', 'overflow', 'scrollbar-width']),
          body: pick('body', ['overflow', 'scrollbar-width'])
        },
        domNodes: document.getElementsByTagName('*').length,
        scrollHeight: document.documentElement.scrollHeight,
        scrollbarPx: window.innerWidth - document.documentElement.clientWidth
      };
    });

    // Event Timing：真实点击的输入延迟+处理+呈现总时长。
    await page.evaluate(() => {
      window.__eventTiming = [];
      new PerformanceObserver(list => list.getEntries().forEach(e => {
        if (e.interactionId) window.__eventTiming.push({name: e.name, duration: Math.round(e.duration),
          processingStart: Math.round(e.processingStart), startTime: Math.round(e.startTime)});
      })).observe({type: 'event', durationThreshold: 16, buffered: true});
      new PerformanceObserver(list => list.getEntries().forEach(e =>
        window.__eventTiming.push({longtask: true, duration: Math.round(e.duration), startTime: Math.round(e.startTime)})
      )).observe({entryTypes: ['longtask']});
    });

    // 打开（真实路径：点卡片）+ tracing。
    result.open = await traceWindow(page, async () => {
      await page.evaluate(frameProbe());
      const t0 = Date.now();
      await page.click('#guest-grid .guest-card >> nth=1');
      await page.waitForTimeout(900);
      const frames = await frameResult(page);
      return {wallMs: Date.now() - t0, ...frames};
    });

    // 关闭（真实路径：点关闭按钮）+ tracing。
    result.close = await traceWindow(page, async () => {
      await page.evaluate(frameProbe());
      const t0 = Date.now();
      await page.click('#detail-close');
      await page.waitForTimeout(900);
      const frames = await frameResult(page);
      return {wallMs: Date.now() - t0, ...frames};
    });

    result.eventTiming = await page.evaluate(() => window.__eventTiming);

    // 微基准（面板关闭态、干净布局下）：
    result.micro = await page.evaluate(async () => {
      const raf = () => new Promise(r => requestAnimationFrame(r));
      const time = async fn => { await raf(); const t0 = performance.now(); fn(); return +(performance.now() - t0).toFixed(2); };
      const out = {};
      const main = document.querySelector('main');
      out.inertOnMain = [];
      for (let i = 0; i < 3; i++) out.inertOnMain.push(await time(() => { main.inert = true; }));
      for (let i = 0; i < 3; i++) out.inertOffMain = [...(out.inertOffMain || []), await time(() => { main.inert = false; })];
      out.bodyOverflowHidden = await time(() => { document.body.style.overflow = 'hidden'; });
      await raf();
      const clientWhileHidden = document.documentElement.clientWidth;
      document.body.style.overflow = '';
      out.clientWidthWhileHidden = clientWhileHidden;
      out.clientWidthNormal = document.documentElement.clientWidth;
      return out;
    });
    // 详情表 DOM 重建近似成本：抓当前 detail-body 的 HTML，重设 innerHTML 计时。
    await page.click('#guest-grid .guest-card >> nth=1');
    await page.waitForSelector('#detail-panel.open');
    await page.waitForTimeout(500);
    result.detailBody = await page.evaluate(async () => {
      const raf = () => new Promise(r => requestAnimationFrame(r));
      const time = async fn => { await raf(); const t0 = performance.now(); fn(); return +(performance.now() - t0).toFixed(2); };
      const out = {};
      const html = document.querySelector('#detail-body').innerHTML;
      out.nodeCount = document.querySelectorAll('#detail-body *').length;
      out.htmlChars = html.length;
      out.rebuild = [];
      for (let i = 0; i < 3; i++) out.rebuild.push(await time(() => { document.querySelector('#detail-body').innerHTML = html; }));
      document.querySelector('#detail-close').click();
      return out;
    });
    await page.waitForTimeout(400);
    result.eventTiming = await page.evaluate(() => window.__eventTiming);
  } finally {
    await browser.close();
  }
  const out = path.join(outputDir, 'profile_result.json');
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
