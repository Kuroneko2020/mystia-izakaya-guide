// 五次剖析：CDP 断点停在 renderTab 调用行（1708），读取暂停帧上的 state，归因 changed=true 的来源。
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
  const hits = [];
  client.on('Debugger.paused', async e => {
    const callFrames = e.callFrames;
    const top = callFrames[0];
    const scopeChain = top.scopeChain.find(s => s.type === 'local' || s.type === 'closure') || top.scopeChain[top.scopeChain.length - 1];
    let snapshot = null;
    try {
      const evalResult = await client.send('Debugger.evaluateOnCallFrame', {
        callFrameId: top.callFrameId,
        expression: `JSON.stringify({changed, tab, previousTab, wasRendered,
          servicePlace: state.servicePlace, serviceGuest: state.serviceGuest,
          detailGuest: state.detailGuest, addonGuest: state.addonGuest, drinkrecGuest: state.drinkrecGuest,
          focusTab: state.focusTab, focusItem: state.focusItem,
          openGuest: state.openGuest, lastRenderedTab, hash: location.hash,
          guestQuery: state.guestQuery, guestType: state.guestType})`,
        returnByValue: true
      });
      snapshot = evalResult.result.value;
    } catch (err) { snapshot = 'eval failed: ' + err.message; }
    hits.push({at: Date.now(), snapshot, stack: e.callFrames.slice(0, 8).map(f => {
      const cf = f.functionName || '(anon)';
      return cf + '@' + (f.location.scriptId + ':' + f.location.lineNumber + 1);
    })});
    await client.send('Debugger.resume');
  });
  const url = pathToFileURL(file).href;
  // 断点 1：route() 内 renderTab(tab) 行（1708 → 0 基 1707，列取行首后一个表达式）；断点 2：renderGuests 网格行。
  await client.send('Debugger.setBreakpointByUrl', {urlRegex: '2610102025', lineNumber: 1707, columnNumber: 2});
  await page.goto(url);
  await page.waitForSelector('#guest-grid .guest-card');
  await page.waitForTimeout(600);
  await page.click('#guest-grid .guest-card >> nth=0');
  await page.waitForTimeout(900);
  await page.click('#detail-close');
  await page.waitForTimeout(700);
  const result = {hits: hits.map(h => ({snapshot: h.snapshot, stack: h.stack}))};
  await client.send('Debugger.disable');
  await browser.close();
  const out = path.join(outputDir, 'profile_result5.json');
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
