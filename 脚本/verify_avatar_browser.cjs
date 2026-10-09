// 当前单文件成品的浏览器回归和点击到下一次绘制采样；仅使用现有 Playwright。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const baseline = process.argv.includes('--baseline');
const outputDir = path.join(root, '验证记录/2026-10-09--筛选布局与性能修复');
const file = path.join(root, baseline
  ? '制作材料/备菜选单与渐变改造前-20261009-001715/东方夜雀食堂攻略查询_料亭立体头像版.html'
  : '成品/东方夜雀食堂攻略查询_料亭立体头像版.html');
async function measure(page, selector) {
  return page.evaluate(async selector => {
    await new Promise(requestAnimationFrame);
    const start = performance.now();
    document.querySelector(selector).click();
    const handler = performance.now() - start;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {handlerMs: +handler.toFixed(2), nextPaintMs: +(performance.now() - start).toFixed(2)};
  }, selector);
}
async function main() {
  fs.mkdirSync(outputDir, {recursive:true});
  const browser = await chromium.launch({channel:'msedge', headless:true});
  const errors = [];
  const page = await browser.newPage({viewport:{width:1440,height:1000}, reducedMotion:'no-preference'});
  page.on('pageerror', error => errors.push(error.message));
  try {
    const start = Date.now();
    await page.goto(pathToFileURL(file).href);
    await page.waitForSelector('#guest-grid .guest-card');
    const loadMs = Date.now()-start;
    await page.addStyleTag({content:'.guest-card{animation:none!important}'});
    const profiler = process.argv.includes('--profile') ? await page.context().newCDPSession(page) : null;
    if (profiler) {await profiler.send('Profiler.enable');await profiler.send('Profiler.start');}
    const metrics = [];
    for (let round=0; round<4; round++) {
      for (const group of ['meals','items','guests']) {
        metrics.push({group, round, ...await measure(page, `button.primary-tab[data-group="${group}"]`)});
      }
    }
    if (profiler) {
      const {profile}=await profiler.send('Profiler.stop');
      const hits=new Map();
      for (const id of profile.samples || []) hits.set(id,(hits.get(id)||0)+1);
      const top=profile.nodes.map(node=>({name:node.callFrame.functionName,line:node.callFrame.lineNumber+1,samples:hits.get(node.id)||0})).filter(x=>x.samples).sort((a,b)=>b.samples-a.samples).slice(0,25);
      fs.writeFileSync(path.join(outputDir,baseline?'CPU_修复前.json':'CPU_修复后.json'),JSON.stringify(top,null,2));
      console.log('CPU '+JSON.stringify(top));
    }
    await page.locator('button.primary-tab[data-group="meals"]').click();
    const summary = await page.evaluate(() => ({
      guestOptions:Array.from(document.querySelector('#detail-guest-filter').options).map(x=>({value:x.value,label:x.textContent})),
      tags:Array.from(document.querySelectorAll('#panel-details .tag.suggest')).map(x=>x.dataset.tag),
      contentOffset:document.querySelector('#detail-table-wrap').getBoundingClientRect().top - document.querySelector('#ryotei-workbench').getBoundingClientRect().top,
      tagFont:getComputedStyle(document.querySelector('#panel-details .tag.suggest')).fontSize,
      hiddenTables:Array.from(document.querySelectorAll('.tab-panel[hidden] .data-table')).length
    }));
    const report = {mode:baseline?'baseline':'fixed',browser:await browser.version(),loadMs,metrics,summary,errors};
    fs.writeFileSync(path.join(outputDir, baseline?'性能_修复前.json':'性能_修复后.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({mode:report.mode,loadMs,metrics,summary:{contentOffset:summary.contentOffset,tagFont:summary.tagFont,tags:summary.tags.length,hiddenTables:summary.hiddenTables},errors},null,2));
    if (baseline) return;
    assert.deepEqual(summary.guestOptions.slice(0,3).map(x=>x.label),['全部','普通','特殊']);
    assert.equal(summary.guestOptions.length,109);
    assert.ok(summary.tags.includes('西式'));
    assert.ok(parseFloat(summary.tagFont)>=13);
    assert.equal(await page.locator('#jump-return').count(),0);
    await page.locator('#detail-guest-filter').selectOption('normal');
    assert.match(await page.locator('#detail-count').innerText(),/282/);
    assert.equal(await page.locator('#detail-table-wrap .data-row').count(),50);
    await page.locator('#detail-guest-filter').selectOption('special');
    assert.match(await page.locator('#detail-count').innerText(),/339/);
    await page.locator('#detail-guest-filter').selectOption('妖怪兔');
    assert.equal(await page.locator('#detail-table-wrap .data-row').count(),6);
    await page.locator('#detail-guest-filter').selectOption('all');
    await page.screenshot({path:path.join(outputDir,'配餐_全部地点.png')});
    await page.locator('#service-place').selectOption('妖怪兽道');
    await page.waitForFunction(()=>document.querySelector('#service-visitors').open);
    assert.equal(await page.locator('#detail-guest-filter').isVisible(),false);
    const who = await page.locator('#visitor-rare [data-plan-guest]').first().getAttribute('data-plan-guest');
    await page.locator('#visitor-rare [data-plan-guest]').first().click();
    assert.match(await page.locator('#detail-table-wrap .data-row').first().innerText(),new RegExp(who));
    assert.equal(await page.locator('#detail-panel').isVisible(),false);
    assert.match(page.url(),/#details/);
    await page.locator('#visitor-normal [data-plan-guest="妖怪兔"]').click();
    assert.equal(await page.locator('#detail-table-wrap .data-row').count(),6);
    await page.screenshot({path:path.join(outputDir,'配餐_地点与头像选客.png')});
    await page.locator('[data-section-tab="drinkrecs"]').click();
    assert.match(await page.locator('#drinkrec-table-wrap').innerText(),/喜好|原表/);
    assert.match(page.url(),/who=/);
    await page.locator('[data-section-tab="addons"]').click();
    assert.match(await page.locator('#addon-table-wrap').innerText(),/原表/);
    await page.locator('#visitor-rare [data-plan-guest]').first().click();
    assert.ok(await page.locator('#addon-table-wrap .data-row').count()>0);
    await page.locator('button.primary-tab[data-group="items"]').click();
    await page.locator('#panel-catalog [data-tag="西式"]').click();
    const rows = await page.locator('#catalog-table-wrap .data-row').allTextContents();
    assert.ok(rows.length>0);
    assert.ok(rows.every(x=>x.includes('西式')));
    await page.locator('#panel-catalog [data-action="clear"]').click();
    await page.locator('#catalog-search').fill('xishi');
    await page.locator('#catalog-search').press('Enter');
    assert.equal(await page.locator('#panel-catalog .tag.chip[data-tag="西式"]').count(),1);
    await page.screenshot({path:path.join(outputDir,'图鉴_完整标签筛选.png')});
    await page.locator('#panel-catalog [data-action="clear"]').click();
    await page.locator('[data-table-page="catalogSort"][data-direction="1"]').click();
    await page.locator('#catalog-table-wrap [data-row-expand]').first().click();
    const firstDish=await page.locator('#catalog-table-wrap .data-row .col-item').first().innerText();
    await page.evaluate(()=>{
      const scroll=document.querySelector('#catalog-table-wrap .paged-table-scroll');
      scroll.scrollTop=120;
      document.querySelector('#catalog-table-wrap .data-row').dataset.cacheProbe='keep';
    });
    await page.locator('[data-section-tab="ingredients"]').click();
    await page.goBack();
    await page.waitForFunction(()=>!document.querySelector('#panel-catalog').hidden);
    assert.equal(await page.locator('#catalog-table-wrap .data-row').first().getAttribute('data-cache-probe'),'keep','未改变条件的返回保留 DOM');
    assert.equal(await page.locator('#catalog-table-wrap [data-row-expand]').first().getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('#catalog-table-wrap .data-row .col-item').first().innerText(),firstDish);
    assert.ok(await page.evaluate(()=>document.querySelector('#catalog-table-wrap .paged-table-scroll').scrollTop)>0);
    await page.locator('#catalog-table-wrap .data-row .col-item a').first().click();
    assert.equal(await page.locator('#catalog-table-wrap .data-row').count(),1);
    await page.goBack();
    await page.waitForFunction(()=>document.querySelectorAll('#catalog-table-wrap .data-row').length===50);
    assert.equal(await page.locator('#catalog-table-wrap .data-row .col-item').first().innerText(),firstDish,'精确条目返回恢复分页');
    await page.locator('#catalog-search').fill('饭团');
    assert.equal(await page.locator('#catalog-table-wrap .data-row').count(),4);
    await page.locator('[data-section-tab="ingredients"]').click();
    await page.locator('[data-section-tab="catalog"]').click();
    assert.equal(await page.locator('#catalog-search').inputValue(),'饭团');
    assert.equal(await page.locator('#catalog-table-wrap .data-row').count(),4,'缓存应与最近搜索一致');
    await page.locator('#catalog-search').fill('');
    await page.locator('button.primary-tab[data-group="meals"]').click();
    await page.locator('#service-place').selectOption('魔法森林');
    await page.locator('button.primary-tab[data-group="items"]').click();
    const cachedPlace=await page.locator('#catalog-table-wrap .data-row .col-item a').first().getAttribute('href');
    assert.equal(new URLSearchParams(cachedPlace.split('?')[1]).get('place'),'魔法森林','缓存里的条目链接必须携带当前地点');
    await page.locator('#catalog-table-wrap .data-row .col-item a').first().click();
    await page.locator('button.primary-tab[data-group="meals"]').click();
    assert.equal(await page.locator('#service-place').inputValue(),'魔法森林','条目跳转不能恢复过时地点');
    await page.locator('#service-place').selectOption('妖怪兽道');
    await page.locator('button.primary-tab[data-group="items"]').click();
    await page.locator('#catalog-search').fill('');
    const tagAudit=await page.evaluate(()=>{
      const data=JSON.parse(document.querySelector('#app-data').textContent).sheets;
      return [['catalog','recipes','菜品标签'],['details','recipes','菜品标签'],['ingredient','ingredients','标签'],['beverage','beverages','标签']].map(([prefix,sheet,field])=>{
        const index=data[sheet].headers.indexOf(field);
        const expected=[...new Set(data[sheet].rows.flatMap(row=>row[index].split(/[、,，]/).filter(x=>x && x!=='无')))].sort();
        const input=document.getElementById(prefix==='details'?'detail-search':prefix+'-search');
        const actual=[...input.closest('.toolbar').querySelectorAll('[data-tag]')].map(x=>x.dataset.tag).sort();
        return {sheet,expected,actual};
      });
    });
    for (const audit of tagAudit) assert.deepEqual(audit.actual,audit.expected,`${audit.sheet} 标签不得截断`);
    fs.writeFileSync(path.join(outputDir,'浏览器_标签覆盖.json'),JSON.stringify(tagAudit,null,2));
    await page.locator('button.primary-tab[data-group="meals"]').click();
    await page.locator('[data-section-tab="details"]').click();
    const places=await page.locator('#service-place option').evaluateAll(options=>options.map(x=>x.value).filter(x=>x!=='all'));
    const regions=[];
    for (const place of places) {
      await page.locator('#service-place').selectOption(place);
      await page.locator('#visitor-filter [data-plan-guest="all"]').click();
      const expected=await page.evaluate(place=>{
        const sheets=JSON.parse(document.querySelector('#app-data').textContent).sheets;
        const names=new Set();
        for(const key of ['guests','normal']) {
          const sheet=sheets[key],location=sheet.headers.indexOf('出没地点'),name=sheet.headers.indexOf(key==='guests'?'客人名字':'普通客人');
          for(const row of sheet.rows) if(row[location].split('、').includes(place)) names.add(row[name]);
        }
        const guest=sheets.details.headers.indexOf('客人名字');
        const special=sheets.details.rows.filter(row=>names.has(row[guest])).length;
        const normal=sheets.normal,normalName=normal.headers.indexOf('普通客人'),early=normal.headers.indexOf('前期推荐菜（≤80元）'),late=normal.headers.indexOf('后期推荐菜（≤200元）');
        const ordinary=normal.rows.filter(row=>names.has(row[normalName])).reduce((sum,row)=>sum+row[early].split('\n').length+row[late].split('\n').length,0);
        return {special,ordinary};
      },place);
      assert.match(await page.locator('#detail-count').innerText(),new RegExp(`^${expected.special+expected.ordinary} /`));
      await page.locator('#visitor-filter [data-plan-guest="normal"]').click();
      assert.match(await page.locator('#detail-count').innerText(),new RegExp(`^${expected.ordinary} /`));
      await page.locator('#visitor-filter [data-plan-guest="special"]').click();
      assert.match(await page.locator('#detail-count').innerText(),new RegExp(`^${expected.special} /`));
      regions.push({place,...expected});
    }
    fs.writeFileSync(path.join(outputDir,'浏览器_15地区分类.json'),JSON.stringify(regions,null,2));
    await page.locator('#service-place').selectOption('all');
    await page.locator('button.primary-tab[data-group="items"]').click();
    await page.locator('[data-section-tab="catalog"]').click();
    await page.locator('#panel-catalog [data-tag="西式"]').click();
    await page.locator('#theme-toggle').click();
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(outputDir,'手机_图鉴标签.png')});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
    report.functionalChecks='PASS';
    report.errors=errors;
    report.regionCount=regions.length;
    fs.writeFileSync(path.join(outputDir,'性能_修复后.json'),JSON.stringify(report,null,2));
    console.log('PASS: 本地 file://、15 地区三分类/106 客人、地点头像、共享选客、完整标签、拼音、缓存/分页/展开/后退、桌面手机布局与浏览器错误检查');
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
