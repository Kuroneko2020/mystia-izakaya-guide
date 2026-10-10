// 当前单文件成品的浏览器回归和点击到下一次绘制采样；仅使用现有 Playwright。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const {liveOutput} = require('./live_output.cjs');
const root = path.resolve(__dirname, '..');
const baseline = process.argv.includes('--baseline');
const outputDir = path.join(root, baseline
  ? '验证记录/2026-10-10--侧栏布局与全量推荐'
  : '验证记录/2026-10-10--图鉴地点联动与成品版本化');
const file = baseline
  ? path.join(root, '验证记录/2026-10-10--侧栏布局与全量推荐/修复前.html')
  : liveOutput();
async function measure(page, selector) {
  return page.evaluate(async selector => {
    await new Promise(requestAnimationFrame);
    const start = performance.now();
    document.querySelector(selector).click();
    const handler = performance.now() - start;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const nextPaint = performance.now() - start;
    const panel = document.querySelector('.tab-panel:not([hidden])');
    const animations = panel.getAnimations({subtree:true}).filter(a=>a.effect.getComputedTiming().endTime<Infinity);
    const animationWait = Math.max(0,...animations.map(a=>a.effect.getComputedTiming().endTime - (a.currentTime || 0)));
    await Promise.all(animations.map(a=>a.finished.catch(()=>{})));
    await new Promise(requestAnimationFrame);
    return {handlerMs:+handler.toFixed(2), nextPaintMs:+nextPaint.toFixed(2), remainingAnimationMs:+animationWait.toFixed(2), settledMs:+(performance.now()-start).toFixed(2)};
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
      tags:Array.from(document.querySelectorAll('[data-filter-tab="details"] .tag.suggest,#panel-details .tag.suggest')).map(x=>x.dataset.tag),
      contentOffset:document.querySelector('#detail-table-wrap').getBoundingClientRect().top - document.querySelector('#ryotei-workbench').getBoundingClientRect().top,
      tagFont:getComputedStyle(document.querySelector('[data-filter-tab="details"] .tag.suggest,#panel-details .tag.suggest')).fontSize,
      hiddenTables:Array.from(document.querySelectorAll('.tab-panel[hidden] .data-table')).length
    }));
    const report = {mode:baseline?'baseline':'fixed',browser:await browser.version(),loadMs,metrics,summary,errors};
    fs.writeFileSync(path.join(outputDir, baseline?'性能_修复前.json':'性能_修复后.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({mode:report.mode,loadMs,metrics,summary:{contentOffset:summary.contentOffset,tagFont:summary.tagFont,tags:summary.tags.length,hiddenTables:summary.hiddenTables},errors},null,2));
    if (baseline) return;
    const sheets=JSON.parse(await page.locator('#app-data').textContent()).sheets;
    const records=key=>sheets[key].rows.map(row=>Object.fromEntries(sheets[key].headers.map((key,i)=>[key,row[i]])));
    const guests=records('guests').concat(records('normal'));
    const staticTags=value=>(value || '').split(/[、,，]/).filter(tag=>tag && tag!=='无' && !/动态|^流行/.test(tag));
    const expectedFood=guests.flatMap(guest=>records('recipes').filter(item=>{
      const tags=staticTags(item['菜品标签']);
      return staticTags(guest['喜好料理标签']).some(t=>tags.includes(t)) && !staticTags(guest['厌恶料理标签']).some(t=>tags.includes(t));
    }).map(item=>({...item,name:guest['客人名字'] || guest['普通客人'],normal:!!guest['普通客人']})));
    const countFor=(names,ordinary)=>expectedFood.filter(r=>(!names || names.has(r.name)) && (ordinary===undefined || r.normal===ordinary)).length;
    const rabbitCount=countFor(new Set(['妖怪兔']));
    assert.equal(await page.locator('.ryotei-hero,#ledger,#detail-stage-filter').count(),0);
    assert.equal(await page.locator('select option').filter({hasText:/前期|后期/}).count(),0);
    assert.ok(summary.contentOffset<85,'结果紧跟页签，筛选不占据上方高度');
    assert.equal(await page.locator('#workbench-filters #detail-search').count(),1);
    const prices=await page.locator('#detail-table-wrap .price-value').allTextContents();
    assert.ok(prices.every((p,i)=>i===0 || parseFloat(p)<=parseFloat(prices[i-1])),'料理默认价格降序');
    assert.ok(await page.locator('#detail-table-wrap .price-value').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize))<=14);
    assert.equal(await page.locator('.pbar,.pbar-cell').count(),0,'价格无底色框和比重条');
    assert.deepEqual(summary.guestOptions.slice(0,3).map(x=>x.label),['全部','普通','特殊']);
    assert.equal(summary.guestOptions.length,109);
    assert.ok(summary.tags.includes('西式'));
    assert.ok(parseFloat(summary.tagFont)>=13);
    assert.equal(await page.locator('#jump-return').count(),0);
    await page.locator('#detail-guest-filter').selectOption('normal');
    assert.match(await page.locator('#detail-count').innerText(),new RegExp('^'+countFor(null,true)+' /'));
    assert.equal(await page.locator('#detail-table-wrap .data-row').count(),50);
    await page.locator('#detail-guest-filter').selectOption('special');
    assert.match(await page.locator('#detail-count').innerText(),new RegExp('^'+countFor(null,false)+' /'));
    await page.locator('#detail-guest-filter').selectOption('妖怪兔');
    assert.equal(await page.locator('#detail-table-wrap .data-row').count(),Math.min(50,rabbitCount));
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
    assert.equal(await page.locator('#detail-table-wrap .data-row').count(),Math.min(50,rabbitCount));
    await page.screenshot({path:path.join(outputDir,'配餐_地点与头像选客.png')});
    await page.locator('[data-section-tab="drinkrecs"]').click();
    assert.match(await page.locator('#drinkrec-table-wrap').innerText(),/喜好|原表/);
    const drinkPrices=await page.locator('#drinkrec-table-wrap .price-value').allTextContents();
    assert.ok(drinkPrices.length>3,'普通客人酒水推荐未截为三条');
    assert.ok(drinkPrices.every((p,i)=>i===0 || parseFloat(p)<=parseFloat(drinkPrices[i-1])),'酒水默认价格降序');
    assert.match(page.url(),/who=/);
    await page.locator('[data-section-tab="addons"]').click();
    assert.match(await page.locator('#addon-table-wrap').innerText(),/原表/);
    await page.locator('#visitor-rare [data-plan-guest]').first().click();
    assert.ok(await page.locator('#addon-table-wrap .data-row').count()>0);
    await page.locator('button.primary-tab[data-group="items"]').click();
    await page.locator('[data-filter-tab="catalog"] [data-tag="西式"]').click();
    const rows = await page.locator('#catalog-table-wrap .data-row').allTextContents();
    assert.ok(rows.length>0);
    assert.ok(rows.every(x=>x.includes('西式')));
    await page.locator('[data-filter-tab="catalog"] [data-action="clear"]').click();
    await page.locator('#catalog-search').fill('xishi');
    await page.locator('#catalog-search').press('Enter');
    assert.equal(await page.locator('[data-filter-tab="catalog"] .tag.chip[data-tag="西式"]').count(),1);
    await page.screenshot({path:path.join(outputDir,'图鉴_完整标签筛选.png')});
    await page.locator('[data-filter-tab="catalog"] [data-action="clear"]').click();
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
        const tab=prefix==='details'?'details':{ingredient:'ingredients',beverage:'beverages'}[prefix] || prefix;
        const actual=[...document.querySelectorAll('.tag-filter-bar[data-filter-tab="'+tab+'"] [data-tag]')].map(x=>x.dataset.tag).sort();
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
      assert.equal(await page.locator('#visitor-rare [data-plan-guest="因幡帝"]').count(),1,'每个地区都可选因幡帝');
      const names=new Set(guests.filter(guest=>guest['客人名字']==='因幡帝' || guest['出没地点'].split('、').includes(place)).map(guest=>guest['客人名字'] || guest['普通客人']));
      const expected={special:countFor(names,false),ordinary:countFor(names,true)};
      assert.match(await page.locator('#detail-count').innerText(),new RegExp(`^${expected.special+expected.ordinary} /`));
      await page.locator('#visitor-filter [data-plan-guest="normal"]').click();
      assert.match(await page.locator('#detail-count').innerText(),new RegExp(`^${expected.ordinary} /`));
      await page.locator('#visitor-filter [data-plan-guest="special"]').click();
      assert.match(await page.locator('#detail-count').innerText(),new RegExp(`^${expected.special} /`));
      regions.push({place,...expected});
    }
    fs.writeFileSync(path.join(outputDir,'浏览器_15地区分类.json'),JSON.stringify(regions,null,2));
    await page.locator('#service-place').selectOption('博丽神社');
    await page.locator('#visitor-rare [data-plan-guest="因幡帝"]').click();
    await page.locator('[data-filter-section="tags"]').click();
    await page.setViewportSize({width:1440,height:720});
    assert.equal(await page.locator('#service-visitors').isVisible(),false);
    assert.equal(await page.locator('[data-filter-tab="details"] .tag.suggest').first().isVisible(),true);
    const layout=await page.evaluate(()=>{
      const aside=document.querySelector('#workbench-filters'),scroll=document.querySelector('.filter-content');
      scroll.scrollTop=scroll.scrollHeight;
      const last=document.querySelector('[data-filter-tab="details"] .tf-suggest').lastElementChild;
      const lastRect=last.getBoundingClientRect(),rect=scroll.getBoundingClientRect();
      const input=document.querySelector('#detail-search'),ctx=document.createElement('canvas').getContext('2d');ctx.font=getComputedStyle(input).font;
      return {sidebarBottom:aside.getBoundingClientRect().bottom,height:innerHeight,lastTagBottom:lastRect.bottom,scrollBottom:rect.bottom,overflow:getComputedStyle(document.querySelector('#service-visitors')).overflow,
        scrollbar:getComputedStyle(scroll).scrollbarColor,placeholderWidth:ctx.measureText(input.placeholder).width,inputWidth:input.clientWidth};
    });
    assert.ok(layout.sidebarBottom<=layout.height,'筛选面板不能超出视口');
    assert.ok(layout.lastTagBottom<=layout.scrollBottom,'最后一行标签完整可读');
    assert.equal(layout.overflow,'visible','来客名单不产生嵌套滚动和粘贴遮挡');
    assert.ok(layout.placeholderWidth<=layout.inputWidth-45,'搜索提示完整显示');
    assert.notEqual(layout.scrollbar,'auto');
    fs.writeFileSync(path.join(outputDir,'侧栏_可达与遮挡检查.json'),JSON.stringify(layout,null,2));
    await page.screenshot({path:path.join(outputDir,'侧栏_最后一行标签.png')});
    assert.ok(await page.locator('.filter-content').evaluate(el=>el.scrollTop)>0);
    await page.locator('#detail-table-wrap .data-row .col-item a').first().click();
    await page.goBack();
    await page.waitForFunction(()=>!document.querySelector('#panel-details').hidden);
    assert.equal(await page.locator('[data-filter-section="tags"]').getAttribute('aria-pressed'),'true','后退恢复侧栏标签面板');
    assert.ok(await page.locator('.filter-content').evaluate(el=>el.scrollTop)>0,'后退恢复侧栏阅读位置');
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('button.primary-tab[data-group="guests"]').click();
    assert.equal(await page.locator('#workbench-filters').isVisible(),false);
    await page.locator('#service-place').selectOption('all');
    assert.equal(await page.locator('#guest-grid .guest-card').count(),59,'全部地点显示完整名簿');
    const bounds=await page.locator('#guest-grid').boundingBox();
    assert.ok(bounds.width>1300,'图鉴卡片使用全部内容宽度');
    // 图鉴页没有筛选侧栏，今晚开店选框必须跟随标题行，分类页签整体靠右。
    const headTools=await page.evaluate(()=>{
      const head=document.querySelector('#ryotei-head-tools'),ctx=document.querySelector('#service-context'),nav=document.querySelector('#section-nav');
      const box=el=>{const b=el.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom};};
      return {ctxParent:ctx.parentElement.id,ctxVisible:ctx.offsetParent!==null,navParent:nav.parentElement.id,
        tabs:Array.from(nav.querySelectorAll('.section-tab')).map(x=>x.textContent),
        ctxBox:box(ctx),navBox:box(nav),toolsBox:box(head),label:ctx.querySelector('label').textContent};
    });
    assert.equal(headTools.ctxVisible,true,'图鉴页必须能直接看到今晚开店选框');
    assert.equal(headTools.ctxParent,'ryotei-head-tools','图鉴页的今晚开店位于标题行工具区');
    assert.equal(headTools.label,'今晚开店');
    assert.deepEqual(headTools.tabs,['稀有/特殊客人','普通客人'],'图鉴页签使用稀有/特殊客人');
    assert.ok(headTools.ctxBox.right<=headTools.navBox.left+1,'今晚开店选框在分类页签左侧');
    assert.ok(headTools.navBox.right>=headTools.toolsBox.right-1,'分类页签整体靠右对齐');
    assert.ok(headTools.ctxBox.top<headTools.toolsBox.bottom,'选框与页签同排');
    // 今晚开店联动：两个页签都随地点变为该地点清单；全部地点恢复完整名单。
    const rareRows=records('guests'), normalRows=records('normal');
    const visitsPlace=(row,place)=>row['客人名字']==='因幡帝' || String(row['出没地点']).split('、').includes(place);
    const place='妖怪兽道';
    const rareExpected=rareRows.filter(row=>visitsPlace(row,place)).length;
    const normalExpected=normalRows.filter(row=>visitsPlace(row,place)).length;
    assert.ok(rareExpected>0 && rareExpected<59,'该地点应有部分稀客');
    await page.locator('#service-place').selectOption(place);
    assert.equal(await page.locator('#guest-grid .guest-card').count(),rareExpected,'稀有/特殊客人页签随今晚开店地点变动');
    assert.match(page.url(),/place=/);
    await page.locator('[data-section-tab="normal"]').click();
    assert.equal(await page.locator('#normal-grid .guest-card').count(),normalExpected,'普通客人页签随今晚开店地点变动');
    await page.locator('[data-section-tab="guests"]').click();
    await page.locator('#service-place').selectOption('all');
    assert.equal(await page.locator('#guest-grid .guest-card').count(),59,'退出地点恢复完整名簿');
    await page.screenshot({path:path.join(outputDir,'图鉴_今晚开店与分类页签.png')});
    fs.writeFileSync(path.join(outputDir,'图鉴_标题行工具区.json'),JSON.stringify(headTools,null,2));
    await page.locator('#global-search').fill('妖怪兔');
    await page.locator('#global-search').press('Enter');
    await page.waitForFunction(()=>!document.querySelector('#panel-normal').hidden);
    assert.equal(await page.locator('#normal-grid .guest-card').count(),1);
    await page.locator('[data-section-tab="normal"]').click();
    assert.equal(await page.locator('#normal-grid .guest-card').count(),47,'退出顶部普通客人精确检索可恢复完整名簿');
    await page.locator('[data-section-tab="guests"]').click();
    await page.locator('#guest-grid [data-guest="博丽灵梦"]').click();
    await page.waitForFunction(()=>document.querySelector('#detail-panel').classList.contains('open'));
    const detailBounds=await page.locator('#detail-panel').boundingBox();
    assert.ok(detailBounds.width>=1100,'详情扩展到左侧');
    assert.equal(await page.locator('#detail-body .pbar,#detail-body .pbar-cell').count(),0);
    assert.equal(await page.locator('#guest-meals .data-row').count(),countFor(new Set(['博丽灵梦'])),'详情包含全部推荐料理');
    assert.ok(!/前期|后期/.test(await page.locator('#detail-body').innerText()));
    await page.screenshot({path:path.join(outputDir,'人物详情_全量推荐.png')});
    await page.locator('#detail-close').click();
    await page.locator('button.primary-tab[data-group="meals"]').click();
    await page.locator('#service-place').selectOption('魔法森林');
    await page.locator('button.primary-tab[data-group="guests"]').click();
    await page.locator('[data-section-tab="normal"]').click();
    // 妖怪兔出没于魔法森林；顺带确认普通客人页签随地点收缩后仍能找到它。
    const forestNormal=normalRows.filter(row=>String(row['出没地点']).split('、').includes('魔法森林')).length;
    assert.equal(await page.locator('#normal-grid .guest-card').count(),forestNormal,'普通客人页签随地点变动后进入链接验证');
    const rabbit=page.locator('#normal-grid .guest-card').filter({has:page.locator('h3 a[data-entity-name="妖怪兔"]')});
    // 身份链接的标准属性名是 data-entity-name；由内容后备定位，避免给测试添加生产专用属性。
    const card=await rabbit.count() ? rabbit : page.locator('#normal-grid .guest-card').filter({has:page.locator('h3',{hasText:'妖怪兔'})});
    await card.locator('.normal-meals summary').click();
    await card.locator('a').filter({hasText:'全部推荐料理'}).click();
    const params=new URLSearchParams(page.url().split('?')[1]);
    assert.equal(params.get('place'),null,'普通客人全量配餐链接退出旧地点条件');
    assert.equal(params.get('who'),'妖怪兔');
    assert.match(await page.locator('#detail-count').innerText(),new RegExp('^'+rabbitCount+' /'));
    await page.locator('#service-place').selectOption('all');
    await page.locator('button.primary-tab[data-group="items"]').click();
    await page.locator('[data-section-tab="catalog"]').click();
    await page.locator('[data-filter-tab="catalog"] [data-tag="西式"]').click();
    await page.locator('#theme-toggle').click();
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(outputDir,'手机_结果.png')});
    assert.equal(await page.locator('#catalog-search').isVisible(),false);
    await page.locator('#filter-toggle').click();
    assert.equal(await page.locator('#catalog-search').isVisible(),true);
    await page.screenshot({path:path.join(outputDir,'手机_图鉴标签.png')});
    await page.locator('#filter-close').click();
    assert.equal(await page.locator('#catalog-search').isVisible(),false);
    await page.locator('button.primary-tab[data-group="guests"]').click();
    await page.locator('button.primary-tab[data-group="meals"]').click();
    await page.locator('#filter-toggle').click();
    await page.goBack();
    await page.waitForFunction(()=>!document.querySelector('#panel-normal').hidden);
    assert.equal(await page.locator('#filter-backdrop').isVisible(),false,'退回图鉴无遗留抽屉遮罩');
    await page.locator('button.primary-tab[data-group="items"]').click();
    await page.locator('#filter-toggle').click();
    await page.setViewportSize({width:1440,height:1000});
    assert.equal(await page.locator('#filter-backdrop').isVisible(),false,'扩大到桌面关闭抽屉遮罩');
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
