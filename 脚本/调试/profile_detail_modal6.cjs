// 六次剖析：日志断点（条件恒 false、副作用记录）追踪 applyRoute 的每次 assign 与 route 的 changed 值。
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
  const client = await page.context().newCDPSession(page);
  await client.send('Debugger.enable');
  const url = pathToFileURL(file).href;
  await page.goto(url);
  await page.waitForSelector('#guest-grid .guest-card');
  await page.waitForTimeout(600);
  // 初始化日志数组（在页面主世界）。
  await page.evaluate(() => { window.__log = []; });
  const bp = (lineNumber, columnNumber, condition) =>
    client.send('Debugger.setBreakpointByUrl', {urlRegex: '2610102025', lineNumber, columnNumber, condition});
  // applyRoute 入口（1-based 3162 行 let changed → 0-based 3161）。
  await bp(3161, 2, `(window.__log=window.__log||[]).push(['applyRoute',route.tab,route.place,route.who,route.item,
    state.servicePlace,state.serviceGuest,state.detailGuest,state.focusTab,state.focusItem]),false`);
  // assign 内 changed=true（1-based 3163 col≈81 → 0-based 3162）。
  await bp(3162, 81, `(window.__log=window.__log||[]).push(['ASSIGN',key,String(value).slice(0,30),String(state[key]).slice(0,30)]),false`);
  // route() 的 renderTab 行（1-based 1708 → 0-based 1707）。
  await bp(1707, 2, `(window.__log=window.__log||[]).push(['renderTabCheck','changed='+changed,'prev='+previousTab,'was='+wasRendered,'tab='+tab,'open='+state.openGuest]),false`);
  await page.click('#guest-grid .guest-card >> nth=0');
  await page.waitForTimeout(900);
  const result = {log: await page.evaluate(() => window.__log || 'no log')};
  await client.send('Debugger.disable');
  await browser.close();
  const out = path.join(outputDir, 'profile_result6.json');
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
