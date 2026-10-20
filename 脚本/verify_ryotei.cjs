// 独立料亭版：输入一致性、内嵌脚本语法和详情路由重绘回归。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {liveOutput, archiveDir} = require('./live_output.cjs');
const root = path.resolve(__dirname,'..');
const read = (name) => fs.readFileSync(path.join(root,name),'utf8');
const originalPath = path.join(root,'成品/东方夜雀食堂攻略查询_和风版.html');
const original = fs.existsSync(originalPath) ? fs.readFileSync(originalPath,'utf8') : null;
const outputPath = liveOutput();
assert.ok(outputPath && fs.existsSync(outputPath),'活成品存在且可定位');
assert.ok(/^东方夜雀食堂攻略查询_\d{10}\.html$/.test(path.basename(outputPath)) || path.basename(outputPath) === '东方夜雀食堂攻略查询_料亭立体头像版.html','活成品符合命名规则');
const reportJson = JSON.parse(read('成品/料亭立体头像版_构建校验.json'));
if (reportJson.outputFile) assert.equal(path.basename(outputPath),reportJson.outputFile,'构建报告 outputFile 指向活成品');
if (reportJson.archivedPrevious) assert.ok(fs.existsSync(path.join(archiveDir,reportJson.archivedPrevious)),'上一份活成品已移入 旧版/');
const output = fs.readFileSync(outputPath,'utf8');
const template = read('脚本/guide_template_ryotei.html');
const appData = (html) => html.match(/<script id="app-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
assert.equal(appData(output),original ? appData(original) : read('中间数据/料亭版攻略数据基线.json'),'攻略 JSON 必须逐字符一致');
const embeddedRules=output.match(/<script id="guest-food-rules" type="application\/json">([\s\S]*?)<\/script>/);
assert.ok(embeddedRules,'新版必须内嵌原生客人特殊判定规则');
assert.equal(embeddedRules[1],read('中间数据/GAME_GUEST_FOOD_RULES.json'),'内嵌特殊规则须与机器提取结果一致');
let scriptCount = 0;
for (const match of output.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (match[1].includes('application/json')) { JSON.parse(match[2]);continue; }
  new vm.Script(match[2]);
  scriptCount++;
}
assert.ok(scriptCount > 0);
assert.ok(!/__RYOTEI_[A-Z]+__/.test(output),'素材占位符须全部注入');
assert.ok(!/<(?:script|img|link)\b[^>]*(?:src|href)="https?:/i.test(output),'离线页面不能依赖远程资源');

const getFunction = (name,source = template) => {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0,'函数存在: ' + name);
  const lineEnd = source.indexOf('\n',start);
  if (source.slice(start,lineEnd).trimEnd().endsWith('}')) return source.slice(start,lineEnd);
  return source.slice(start,source.indexOf('\n}',start) + 2);
};
const navigation = fs.existsSync(path.join(root,'脚本/ryotei_navigation.js')) ? read('脚本/ryotei_navigation.js') : '';
assert.ok(navigation.includes('function ryoteiCaptureReading('),'返回必须保存表内滚动和已展开的阅读内容');
assert.equal((template.match(/class="tab-btn primary-tab/g) || []).length,2,'顶栏收敛为营业图鉴与物品图鉴两个主入口');
assert.ok(!template.includes('data-group="meals"'),'配餐参考已并入营业图鉴，顶栏不再单列');
assert.ok(navigation.includes("guests:{label:'营业图鉴'"),'营业图鉴同时承载人物页签与备菜表页');
assert.ok(navigation.includes("['details','备菜料理'],['drinkrecs','推荐酒水'],['addons','加料参考']"),'备菜三表留在营业图鉴组内');
assert.ok(!template.includes('dlc-filter'),'版本筛选已全站移除');
assert.ok(!template.includes("{ key: '所属版本'") && !template.includes("{ secondary: true, key: '所属版本'"),'版本列已从全部表格移除（数据行构造保留字段）');
assert.ok(template.includes('id="detail-tabs"') && template.includes('data-detail-tab="meals"'),'客人详情为页签式，默认推荐料理');
assert.ok(template.includes('id="detail-tastes"'),'口味信息常驻详情头部');
for (const tab of ['guests','details','catalog','ingredients','beverages','addons','drinkrecs','normal','new440','guides','sources']) {
  assert.ok(template.includes('id="panel-' + tab + '"'),'原页面必须仍可达: ' + tab);
}
assert.ok(navigation.includes('function ryoteiVisitsPlace('),'营业地点筛选必须有明确的来访匹配逻辑');
assert.ok(template.includes('id="night-preparation"') && template.includes('id="night-preparation-body"'),'今晚备菜覆盖面板挂在备菜表工作区');
assert.ok(template.includes('需要准备的料理') && template.includes('需要准备的酒水'),'覆盖榜展示当前地点需要准备的料理与酒水');
assert.ok(template.includes('不是每晚必来') && template.includes('不含店面等级限制与出现概率'),'覆盖参考必须自带口径备注，不得暗示必来、概率或份数');
assert.ok(template.includes('DETAIL_MERGED_COLUMNS') && template.includes('DRINKREC_MERGED_COLUMNS'),'多客命中表提供一物一行的聚合列');
assert.ok(template.includes('客人与命中'),'合并行的逐客命中必须可在详情展开查看');
// 标签显示顺序：按附图游戏 Tag 列表（左到右上到下），派生/动态标签有明确落位。
const tagOrderStart = template.indexOf('/* ---------------- 标签显示顺序');
const tagOrderEnd = template.indexOf('/* ---------------- 拼音搜索');
assert.ok(tagOrderStart > 0 && tagOrderEnd > tagOrderStart,'模板包含料理/酒水标签显示顺序定义');
const tagOrderSource = template.slice(tagOrderStart,tagOrderEnd) + '\n' +
  getFunction('splitTags') + '\n' + getFunction('esc') + '\n' + getFunction('tagHtml');
vm.runInNewContext(`
  ${tagOrderSource}
  assert.deepEqual(sortTagsForDisplay(['辣','肉','昂贵','清淡','燃起来了','酸','大份','实惠']),
    ['昂贵','实惠','大份','肉','清淡','辣','燃起来了','酸'],'料理标签按附图顺序且大份/价格标签插入原位');
  assert.deepEqual(sortTagsForDisplay(['提神','无酒精','中酒精','高酒精','清酒','甘','辛']),
    ['无酒精','中酒精','高酒精','清酒','甘','辛','提神'],'酒水标签按附图顺序');
  assert.deepEqual(sortTagsForDisplay(['流行厌恶（动态）','甜','酸']),['甜','酸','流行厌恶（动态）'],'动态标签始终排在最后');
  const foodHtml = tagHtml('辣、肉、昂贵','good');
  assert.ok(foodHtml.indexOf('昂贵') < foodHtml.indexOf('肉') && foodHtml.indexOf('肉') < foodHtml.indexOf('辣'),'标签渲染使用统一顺序');
  const drinkHtml = tagHtml('昂贵、便宜、无酒精、高酒精','drink');
  assert.ok(drinkHtml.indexOf('昂贵') < drinkHtml.indexOf('便宜') && drinkHtml.indexOf('便宜') < drinkHtml.indexOf('无酒精'),'酒水价格标签排在同表酒水标签之前');
`,{assert});
assert.ok(template.includes('cfg.suggestions = sortTagsForDisplay(Array.from(set));'),'标签筛选建议使用统一顺序');
assert.ok(!output.includes('固定口味候选') && !output.includes('recommendation-note'),'各界面固定口味候选说明已移除');
vm.runInNewContext(`
  const state = {servicePlace:'魔法森林'};
  const ryoteiNormalNames = new Set();
  const dataOf = key=>key === 'guests' ? [{客人名字:'莉格露',出没地点:'妖怪兽道、魔法森林、太阳花田'},{客人名字:'橙',出没地点:'妖怪兽道'}] : [];
  const splitTags = value=>String(value || '').split('、').filter(Boolean);
  ${getFunction('ryoteiVisitsPlace',navigation)}
  ${getFunction('ryoteiPlanRows',navigation)}
  assert.equal(ryoteiVisitsPlace({出没地点:'魔法森林、太阳花田'}),true);
  assert.equal(ryoteiVisitsPlace({出没地点:'妖怪兽道'}),false);
  assert.equal(ryoteiVisitsPlace({出没地点:'魔法森林'},'all'),true);
  const recommendations=[{客人名字:'莉格露'},{客人名字:'橙'}];
  assert.deepEqual(ryoteiPlanRows(recommendations).map(r=>r.客人名字),['莉格露'],'配餐的地区筛选按对应客人来访名单执行');
  state.servicePlace='all';
  assert.equal(ryoteiPlanRows(recommendations).length,2,'全部地区必须恢复完整记录');
`,{assert});
vm.runInNewContext(`
  const state = {servicePlace:'红魔馆'};
  const ryoteiNormalNames = new Set(['小妖精']);
  const dataOf = key=>key === 'guests'
    ? [{客人名字:'甲',出没地点:'红魔馆'},{客人名字:'乙',出没地点:'红魔馆'},{客人名字:'丙',出没地点:'妖怪兽道'}]
    : [{普通客人:'小妖精',出没地点:'红魔馆'}];
  const splitTags = value=>String(value || '').split('、').filter(Boolean);
  const byLocale = (a,b)=>String(a).localeCompare(String(b),'zh-Hans-CN');
  const buildMealIndex = ()=>[
    {客人名字:'甲',菜品:'菜A',价格:'30'},{客人名字:'乙',菜品:'菜A',价格:'30'},
    {客人名字:'小妖精',菜品:'菜A',价格:'30'},{客人名字:'乙',菜品:'菜B',价格:'20'},
    {客人名字:'丙',菜品:'菜C',价格:'99'}
  ];
  const buildDrinkRecIndex = ()=>[{客人名字:'甲',酒水:'酒A',价格:'40'},{客人名字:'小妖精',酒水:'酒A',价格:'40'}];
  ${getFunction('ryoteiVisitsPlace',navigation)}
  ${getFunction('ryoteiPrepCoverage',template)}
  const food = ryoteiPrepCoverage('food');
  assert.equal(food.length,2,'地点外客人的菜不进覆盖榜');
  assert.equal(food[0].name,'菜A','覆盖客人数多的菜排前');
  assert.equal(food[0].special.length,2);assert.equal(food[0].normal.length,1,'普通客人单独计数');
  assert.equal(food[1].name,'菜B');assert.equal(food[1].price,20);
  const drink = ryoteiPrepCoverage('beverage');
  assert.equal(drink[0].name,'酒A');assert.equal(drink[0].special.length,1);assert.equal(drink[0].normal.length,1);
  state.servicePlace='all';
  assert.equal(ryoteiPrepCoverage('food').length,3,'全部地点不漏掉其他地区客人');
`,{assert});
vm.runInNewContext(`
  const splitTags = value=>String(value || '').split('、').filter(Boolean);
  ${getFunction('ryoteiMergeItemRows',template)}
  const rows = [
    {客人名字:'甲',菜品:'菜A',价格:'30',命中喜好:'下酒、和风',主料:'鱼'},
    {客人名字:'乙',菜品:'菜A',价格:'30',命中喜好:'昂贵、和风',主料:'鱼'},
    {客人名字:'乙',菜品:'菜B',价格:'20',命中喜好:'',主料:'肉'}
  ];
  const merged = ryoteiMergeItemRows(rows,'菜品');
  assert.equal(merged.length,2,'同一菜品只留一行');
  assert.equal(merged[0].客人名字,'2 位客人');
  assert.equal(merged[0].覆盖客人,2);
  assert.equal(merged[0].命中喜好,'下酒、和风、昂贵','命中喜好按客人并集去重');
  assert.equal(merged[0].主料,'鱼','物品字段保留首行值');
  assert.equal(merged[0].命中数,2,'兼容按命中数排序时按覆盖客人数');
  assert.equal(merged[0].客人与命中,'甲（下酒、和风）；乙（昂贵、和风）','展开字段逐客列出命中');
  assert.equal(merged[1].客人与命中,'乙','无命中喜好的客人也保留名字');
  assert.equal(rows[0].命中喜好,'下酒、和风','合并不修改原行');
`,{assert});
vm.runInNewContext(`
  const scrolls=[{scrollTop:310,scrollLeft:84}], details=[{open:true},{open:false}];
  const row={hidden:false}, rowClass={toggle(name,value){this.expanded=value;}};
  const buttons=[{expanded:'true',getAttribute(name){return name === 'aria-expanded' ? this.expanded : 'detail-row';},setAttribute(name,value){this.expanded=value;},closest(){return {classList:rowClass};}}];
  const scope={querySelectorAll(selector){return selector === 'details' ? details : selector === '[data-row-expand]' ? buttons : selector === '.table-wrap,.paged-table-scroll,.filter-content,.detail-scroller' ? scrolls : [];}};
  const $=()=>scope;
  const document={getElementById(){return row;}};
  ${getFunction('ryoteiCaptureReading',navigation)}
  ${getFunction('ryoteiRestoreReading',navigation)}
  const saved=ryoteiCaptureReading('#panel-details');
  scrolls[0].scrollTop=0;scrolls[0].scrollLeft=0;details[0].open=false;buttons[0].expanded='false';row.hidden=true;
  ryoteiRestoreReading([saved]);
  assert.equal(scrolls[0].scrollTop,310,'重建后的表内纵向滚动须恢复');
  assert.equal(scrolls[0].scrollLeft,84,'重建后的表内横向滚动须恢复');
  assert.equal(details[0].open,true,'原来展开的标签或攻略折叠须恢复');
  assert.equal(row.hidden,false);assert.equal(buttons[0].expanded,'true');assert.equal(rowClass.expanded,true);
`,{assert});
vm.runInNewContext(`
  const state={tab:'catalog',openGuest:'',catalogQuery:''};
  const ryoteiPages={catalogSort:{page:0,signature:'same'}};
  const view={state:{tab:'catalog',catalogQuery:''},pages:{catalogSort:{page:2,signature:'same'}},scroll:0,detailScroll:0};
  const history={state:{ryoteiView:view}},location={hash:'#catalog'};
  const ryoteiRenderedViews=new Map([['catalog','stale']]);
  let lastRenderedTab='catalog',domPage=0,renders=0;
  const route=()=>{if (lastRenderedTab !== state.tab) {domPage=ryoteiPages.catalogSort.page;renders++;lastRenderedTab=state.tab;}};
  const syncRyoteiControls=()=>{},ryoteiRestoreReading=()=>{},ryoteiNavigate=()=>{};
  const ryoteiParseRoute=()=>({tab:'catalog',guest:''});
  const requestAnimationFrame=fn=>fn(),cancelAnimationFrame=()=>{},window={scrollTo(){}},$=()=>({scrollTop:0});
  ${getFunction('ryoteiRenderSignature',template)}
  ${getFunction('ryoteiDetailViewSignature',navigation)}
  ${getFunction('ryoteiRestoreView',navigation)}
  ryoteiRestoreView();
  assert.equal(domPage,2,'同页同筛选但不同分页的返回必须刷新到保存页');
  assert.equal(renders,1);
  assert.equal(ryoteiRenderedViews.has('catalog'),false,'不同页码恢复要清除过期缓存，不可只清lastRenderedTab');
  ryoteiRestoreView();
  assert.equal(renders,1,'无状态差异的返回不能重建背景列表');
  ryoteiPages.catalogSort.page=1;
  assert.equal(view.pages.catalogSort.page,2,'恢复页码必须克隆快照，后续分页不能修改历史记录');
`,{assert});
vm.runInNewContext(`
  const state={guideTab:'2021'},TAG_FILTER_CONFIG=[];
  const buttons=['2024','2021'].map(guide=>({dataset:{guide},classList:{toggle(name,on){this.active=on;}}}));
  const $=()=>null,$$=()=>buttons;
  ${getFunction('syncRyoteiControls',navigation)}
  syncRyoteiControls();
  assert.equal(buttons[1].classList.active,true,'返回2021攻略时年份按钮必须与恢复内容一致');
  assert.equal(buttons[0].classList.active,false);
`,{assert});
vm.runInNewContext(`
  const state={openGuest:''},location={hash:'',href:'preview.html'};
  const history={state:{},replaceState(value){this.state=value;}};
  let scrolls=0,id=0;
  const callbacks=new Map();
  const requestAnimationFrame=fn=>{callbacks.set(++id,fn);return id;},cancelAnimationFrame=id=>callbacks.delete(id);
  const getComputedStyle=()=>({scrollMarginTop:'100px'});
  const $=()=>({open:true,getBoundingClientRect(){return {top:100};},scrollIntoView(){scrolls++;}});
  const ryoteiSaveView=()=>{},ryoteiCaptureView=()=>({hash:location.hash}),route=()=>{};
  ${getFunction('ryoteiNavigate',navigation)}
  ryoteiNavigate('#catalog?item=饭团');
  ryoteiNavigate('#details?who=normal');
  assert.equal(callbacks.size,1,'同帧连续导航仅保留最后一次阅读位置记录');
  for (const callback of callbacks.values()) callback();
  assert.equal(history.state.ryoteiView.hash,'#details?who=normal');
  assert.equal(scrolls,0,'已停在工作区时切页不应重复滚动');
`,{assert});
vm.runInNewContext(`
  const state={servicePlace:'魔法森林',serviceGuest:'all'};
  const TAB_IDS=['guests','details','catalog','ingredients','beverages','addons','drinkrecs','normal','new440','guides','sources'];
  ${getFunction('ryoteiHash',navigation)}
  ${getFunction('ryoteiParseRoute',navigation)}
  const hash=ryoteiHash('catalog',{item:'饭团'});
  const parsed=ryoteiParseRoute(hash);
  assert.equal(parsed.tab,'catalog');
  assert.equal(parsed.item,'饭团');
  assert.equal(parsed.place,'魔法森林','物品跳转保留当前营业地点');
  assert.equal(ryoteiParseRoute('#guests/' + encodeURIComponent('博丽灵梦')).guest,'博丽灵梦','旧人物链接兼容');
  assert.equal(ryoteiParseRoute('#ingredients?item=%E0%A4%A').tab,'ingredients','坏的参数编码不得使路由崩溃');
  assert.equal(ryoteiParseRoute('#unknown').tab,'guests','非法页面回到营业图鉴');
`,{assert,URLSearchParams});
vm.runInNewContext(`
  const state={servicePlace:'all',serviceGuest:'all'};
  const RYOTEI_PLACES=[],RYOTEI_ITEM_PAGES={recipe:{tab:'catalog',sheet:'recipes',key:'菜品'}};
  const dataOf=()=>[{菜品:'饭团'}],esc=value=>value,escAttr=value=>value;
  ${getFunction('ryoteiHash',navigation)}
  ${getFunction('ryoteiEntityLink',navigation)}
  assert.ok(ryoteiEntityLink('recipe','饭团').includes('href='));
  assert.equal(ryoteiEntityLink('recipe','旧攻略别名'),'旧攻略别名','无法对应现有条目的旧名称保留原文，不生成空目标链接');
`,{assert,URLSearchParams});
vm.runInNewContext(`
  const state={servicePlace:'all',serviceGuest:'all',detailGuest:'all',addonGuest:'all',drinkrecGuest:'all',focusTab:'catalog',focusItem:'饭团',catalogQuery:'饭团',catalogChips:['肉']};
  const RYOTEI_PLACES=['魔法森林'];
  const RYOTEI_ITEM_PAGES={recipe:{tab:'catalog',sheet:'recipes',key:'菜品',query:'catalogQuery',chips:'catalogChips'}};
  const dataOf=key=>key === 'recipes' ? [{菜品:'饭团'}] : [{客人名字:'莉格露',出没地点:'魔法森林'}];
  const splitTags=value=>String(value || '').split('、');
  const syncRyoteiControls=()=>{};
  ${getFunction('ryoteiGuestRecord',navigation)}
  ${getFunction('ryoteiVisitsPlace',navigation)}
  ${getFunction('ryoteiApplyRoute',navigation)}
  const target={tab:'catalog',place:'all',who:'all',item:'饭团'};
  assert.equal(ryoteiApplyRoute(target),true,'同一条目重新打开也须清除挡住结果的标签');
  assert.equal(state.catalogChips.length,0);
  assert.equal(ryoteiApplyRoute(target),false,'后续 hashchange 必须幂等，不能重复重绘');
  ryoteiApplyRoute({tab:'details',place:'魔法森林',who:'莉格露',item:''});
  assert.equal(state.detailGuest,'莉格露');assert.equal(state.addonGuest,'莉格露');assert.equal(state.drinkrecGuest,'莉格露');
  ryoteiApplyRoute({tab:'details',place:'魔法森林',who:'不存在的客人',item:''});
  assert.equal(state.serviceGuest,'all','无效客人不能造成空下拉框');
`,{assert});
const context = vm.createContext({assert,URLSearchParams});
vm.runInContext(`
  const TAB_IDS = ['guests','details','catalog'];
  const state = {tab:'guests',openGuest:'',servicePlace:'all',serviceGuest:'all'};
  const ryoteiRenderedViews = new Map(), ryoteiPages = {};
  let lastRenderedTab = '';
  const location = {hash:'#guests'};
  const REDUCED_MOTION = true;
  const counts = {list:0,detail:0,scroll:0};
  const panels = [{id:'panel-guests'},{id:'panel-details'},{id:'panel-catalog'}];
  const buttons = TAB_IDS.map(tab=>({dataset:{tab},classList:{toggle(){}}}));
  const $$ = selector=>selector === '.tab-panel' ? panels : buttons;
  const $ = ()=>({scrollIntoView(){counts.scroll++;}});
  const updateRyoteiHeading = ()=>{};
  const moveTabIndicator = ()=>{};
  const ryoteiRenderPrepCoverage = ()=>{};
  const renderTab = tab=>{counts.list++;ryoteiRememberRender(tab);};
  const openGuest = name=>{state.openGuest=name;counts.detail++;};
  const closeGuest = ()=>{state.openGuest='';};
  const ryoteiApplyRoute=()=>false;
  const ryoteiRevealItem=()=>{};
  const updateRyoteiReturn=()=>{};
  ${getFunction('ryoteiHash',navigation)}
  ${getFunction('ryoteiParseRoute',navigation)}
  ${getFunction('currentHash')}
  ${getFunction('ryoteiRenderSignature')}
  ${getFunction('ryoteiRememberRender')}
  ${getFunction('switchTab')}
  ${getFunction('route')}
  route();
  assert.equal(counts.list,1,'初次直达客人页必须渲染');
  openGuest('博丽灵梦');
  location.hash='#guests/' + encodeURIComponent('博丽灵梦');
  route();
  assert.equal(counts.list,1,'打开详情不能重建背景列表');
  assert.equal(counts.detail,1,'详情打开后的 hashchange 不能重复渲染');
  closeGuest();
  location.hash='#guests';
  route();
  assert.equal(counts.list,1,'退出详情不能重建背景列表');
  assert.equal(counts.scroll,0,'同页详情进退不能跳动页面位置');
  switchTab('catalog');
  route();
  assert.equal(counts.list,2,'切页及紧随的 hashchange 只渲染一次');
  switchTab('guests');
  assert.equal(counts.list,2,'切回未变的客人页应复用原内容，保留阅读状态');
  state.openGuest='';
  location.hash='#guests/' + encodeURIComponent('东风谷早苗');
  route();
  assert.equal(state.openGuest,'东风谷早苗','直达人物路由可打开新客人');
  assert.equal(counts.detail,2);
  ${getFunction('jumpToSearch')}
  const beforeJump = counts.list;
  jumpToSearch('catalog','#catalog-search','饭团','catalogQuery',renderTab);
  assert.equal(counts.list,beforeJump + 1,'搜索跳页应先设置查询，只渲染一次');
  jumpToSearch('catalog','#catalog-search','饭团','catalogQuery',renderTab);
  assert.equal(counts.list,beforeJump + 1,'相同搜索目标不重绘');
  jumpToSearch('catalog','#catalog-search','月饼','catalogQuery',renderTab);
  assert.equal(counts.list,beforeJump + 2,'当前页更换搜索目标需要更新');
`,context);
const ui = read('脚本/ryotei_ui.js');
vm.runInNewContext(`
  const state = {addonQuery:'',addonSort:{key:'价格',dir:1}};
  const ryoteiPages = Object.create(null);
  const RYOTEI_PAGE_SIZE = 50;
  ${getFunction('ryoteiTablePage',ui)}
  const columns = [{sortKey:'addonSort'}];
  const list = Array.from({length:656},(_,id)=>({id}));
  assert.equal(ryoteiTablePage(columns,list).rows.length,50);
  ryoteiPages.addonSort.page=1;
  assert.equal(ryoteiTablePage(columns,list).rows[0].id,50);
  ryoteiPages.addonSort.page=13;
  assert.deepEqual(ryoteiTablePage(columns,list).rows.map(r=>r.id),[650,651,652,653,654,655]);
  state.addonQuery='新查询';
  assert.equal(ryoteiTablePage(columns,list).rows[0].id,0,'修改搜索后回第一页');
  ryoteiPages.addonSort.page=2;
  state.addonSort.dir=-1;
  assert.equal(ryoteiTablePage(columns,list.slice().reverse()).rows[0].id,655,'排序作用于全量记录，再分页');
  ryoteiPages.addonSort.page=2;
  state.servicePlace='魔法森林';
  assert.equal(ryoteiTablePage(columns,list).rows[0].id,0,'地区变化即使条数相同也回第一页');
  for (const sortKey of ['detailMealSort','detailDrinkSort','detailAddonSort']) {
    const prefix=sortKey.replace(/Sort$/,'');
    const detailColumns=[{sortKey}];
    state.openGuest='客人甲';state[sortKey]={key:'价格',dir:-1};
    ryoteiTablePage(detailColumns,list);ryoteiPages[sortKey].page=2;
    state.openGuest='客人乙';
    assert.equal(ryoteiTablePage(detailColumns,list).rows[0].id,0,'同候选数换客不可继承详情页码: ' + sortKey);
    ryoteiPages[sortKey].page=2;state[prefix + 'Query']='新查询';
    assert.equal(ryoteiTablePage(detailColumns,list).rows[0].id,0,'同候选数换查询回第一页: ' + sortKey);
    ryoteiPages[sortKey].page=2;state[prefix + 'Chips']=['清淡'];
    assert.equal(ryoteiTablePage(detailColumns,list).rows[0].id,0,'同候选数换标签回第一页: ' + sortKey);
    ryoteiPages[sortKey].page=2;state[sortKey].dir=1;
    assert.equal(ryoteiTablePage(detailColumns,list.slice().reverse()).rows[0].id,655,'详情排序先全量后分页: ' + sortKey);
  }
`,{assert});
vm.runInNewContext(`
  const element = () => ({hidden:true,inert:false,offsetWidth:1,classList:{names:new Set(),add(x){this.names.add(x);},remove(x){this.names.delete(x);},contains(x){return this.names.has(x);}}});
  const panel=element(), backdrop=element(), background=[element(),element(),element()];
  const $=selector=>selector === '#detail-panel' ? panel : backdrop;
  const $$=()=>background;
  const document={body:{style:{overflow:''}}};
  const pending=new Map();
  let timerId=0;
  const window={setTimeout(fn){pending.set(++timerId,fn);return timerId;},clearTimeout(id){pending.delete(id);}};
  ${getFunction('setPanelOpen')}
  setPanelOpen(true);
  assert.equal(panel.inert,false);
  assert.ok(background.every(e=>e.inert));
  setPanelOpen(false);
  assert.equal(panel.inert,true,'关闭动画刚开始，旧详情就应退出键盘交互');
  assert.ok(background.every(e=>!e.inert),'关闭即释放背景交互');
  assert.equal(panel.hidden,false,'保留视觉退场，不通过取消动画掩盖点击阻挡');
  setPanelOpen(true);
  assert.equal(pending.size,0,'快速打开下一客人，应取消上一轮隐藏计时');
  assert.equal(panel.inert,false);
  setPanelOpen(false);
  assert.equal(pending.size,1,'仅保留最新退场计时');
  for(const callback of pending.values()) callback();
  assert.equal(panel.hidden,true);
  assert.equal(backdrop.hidden,true);
`,{assert});
vm.runInNewContext(`
  const state = { detailAddonSort: { key: '价格', dir: 1 } };
  const rows = [
    { '客人名字': '莉格露', '食材': '甲', '价格': 30, '等级': 2, '场景': '通用加料' },
    { '客人名字': '莉格露', '食材': '乙', '价格': 10, '等级': 5, '场景': '配菜示例' },
    { '客人名字': '莉格露', '食材': '丙', '价格': 20, '等级': 1, '场景': '通用加料' }
  ];
  const buildAddonIndex = () => rows;
  let captured = null;
  const makeTable = (columns, list) => { captured = { columns, order: list.map(r => r['食材']).join(',') }; return ''; };
  ${getFunction('sortObjects',template)}
  ${getFunction('addonTableForGuest',template)}
  addonTableForGuest('莉格露');
  assert.equal(captured.order,'乙,丙,甲','客人加料页默认按价格从低到高');
  const priceCol = captured.columns.find(c => c.key === '价格');
  const levelCol = captured.columns.find(c => c.key === '等级');
  const sceneCol = captured.columns.find(c => c.key === '场景');
  assert.equal(priceCol.sortable,true,'价格列头可点击排序');
  assert.equal(priceCol.sortKey,'detailAddonSort','加料排序状态独立于主页加料表');
  assert.equal(levelCol.sortable,true,'等级列头可点击排序');
  assert.equal(levelCol.sortKey,'detailAddonSort');
  assert.equal(sceneCol.sortable,undefined);
  state.detailAddonSort = { key: '价格', dir: -1 };
  addonTableForGuest('莉格露');
  assert.equal(captured.order,'甲,丙,乙','同列方向翻转按价格从高到低');
  state.detailAddonSort = { key: '等级', dir: -1 };
  addonTableForGuest('莉格露');
  assert.equal(captured.order,'乙,甲,丙','等级按数值排序，非字典序');
  state.detailAddonSort = { key: '等级', dir: 1 };
  addonTableForGuest('莉格露');
  assert.equal(captured.order,'丙,甲,乙','等级升序');
`,{assert});
// 整份源码 IIFE + 实际 UI/导航模块在 VM 中运行；仅以最小 DOM 替身替代浏览器，不调用自动 init。
// 这样分页回归真的经过 document click handler / 表格渲染，历史回归真的经过 route / openGuest。
function sourceRuntime(rules={}){
  const elements = new Map(), frames = new Map(), timers = new Map();
  let frameId = 0, timerId = 0;
  class Element {
    constructor(id='',classes=''){
      this.id=id;this.dataset={};this.hidden=false;this.disabled=false;this.inert=false;
      this.scrollTop=0;this.scrollLeft=0;this.writes=0;this.value='';this.open=false;
      this.attributes={};this.listeners=new Map();this.children=[];this.parentElement=null;
      this.style={setProperty(){}};this.clientHeight=600;this.offsetHeight=100;this.offsetWidth=900;
      const names=new Set(classes.split(' ').filter(Boolean));
      this.classList={add:name=>names.add(name),remove:name=>names.delete(name),contains:name=>names.has(name),
        toggle:(name,on)=>{if (on === undefined) on=!names.has(name);if (on) names.add(name);else names.delete(name);return on;}};
    }
    addEventListener(type,fn){const listeners=this.listeners.get(type)||[];listeners.push(fn);this.listeners.set(type,listeners);}
    emit(type,event){for(const fn of this.listeners.get(type)||[]) fn(event);}
    setAttribute(name,value){this.attributes[name]=String(value);}
    getAttribute(name){return this.attributes[name] ?? null;}
    removeAttribute(name){delete this.attributes[name];}
    focus(){document.activeElement=this;}
    getClientRects(){return [{width:1}];}
    getBoundingClientRect(){return {top:100,height:80,width:900};}
    scrollIntoView(){this.intoView=(this.intoView || 0)+1;}
    insertBefore(child){child.parentElement=this;this.children.push(child);}
    appendChild(child){this.insertBefore(child);return child;}
    remove(){this.removed=true;}
    matches(selector){
      return selector.split(',').some(part=>{
        const sel=part.trim();
        if (sel.startsWith('#')) return this.id === sel.slice(1);
        if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
        if (sel === 'details') return this.tagName === 'DETAILS';
        if (sel === '[data-row-expand]') return this.attributes['data-row-expand'] != null;
        if (sel === '[data-table-page]') return this.dataset.tablePage != null;
        if (sel === '[data-detail-tab]') return this.dataset.detailTab != null;
        if (sel === '[data-detail-chip]') return this.dataset.detailChip != null;
        return false;
      });
    }
    closest(selector){for(let node=this;node;node=node.parentElement) if(node.matches(selector)) return node;return null;}
    contains(child){for(let node=child;node;node=node.parentElement) if(node === this) return true;return false;}
    querySelector(selector){
      if (selector === '.detail-scroller') return this.scroller || null;
      if (selector === ':scope > .detail-name-mark') return this.mark || null;
      return this.querySelectorAll(selector)[0] || null;
    }
    querySelectorAll(selector){
      const result=[];
      const visit=node=>{for(const child of node.children){if(child.matches(selector)) result.push(child);visit(child);}};
      visit(this);return result;
    }
    get innerHTML(){return this.html || '';}
    set innerHTML(value){
      this.html=String(value);this.writes++;this.children=[];
      if(this.id === 'detail-body') {
        for(const id of ['detail-meal-search','detail-drink-search','detail-meal-count','detail-drink-count']) elements.delete(id);
        for(const match of this.html.matchAll(/<input id="([^"]+)"[^>]*value="([^"]*)"/g)) {
          const input=new Element(match[1]);input.value=match[2];elements.set(input.id,input);this.appendChild(input);
        }
        for(const match of this.html.matchAll(/<span id="(detail-[^"]+-count)"[^>]*>([^<]*)<\/span>/g)) {
          const counter=new Element(match[1]);counter.textContent=match[2];elements.set(counter.id,counter);this.appendChild(counter);
        }
        if(this.html.includes('id="detail-tag-message"')) this.appendChild(element('detail-tag-message'));
        if(this.html.includes('class="detail-chips"')) this.appendChild(new Element('','detail-chips'));
        this.scroller=new Element('','detail-scroller');this.appendChild(this.scroller);
        const start=this.html.indexOf('<div class="detail-scroller">');
        this.scroller.innerHTML=start >= 0 ? this.html.slice(start + '<div class="detail-scroller">'.length) : '';
      } else if(this.classList.contains('detail-scroller') || this.id.endsWith('-table-wrap')) {
        let tableHost=this;
        if(this.html.includes('class="paged-table-scroll"')) {tableHost=new Element('','paged-table-scroll');this.appendChild(tableHost);}
        for(const match of this.html.matchAll(/<button[^>]*data-table-page="([^"]+)"[^>]*data-direction="([^"]+)"([^>]*)>/g)) {
          const button=new Element();button.dataset.tablePage=match[1];button.dataset.direction=match[2];button.disabled=/\bdisabled\b/.test(match[3]);this.appendChild(button);
        }
        for(const match of this.html.matchAll(/<details\b[^>]*>/g)) {const fold=new Element();fold.tagName='DETAILS';this.appendChild(fold);}
        // 本回归数据的详情表不含宽列；其它读取/展开合同由上面的独立 VM 断言覆盖。
        this.tableHost=tableHost;
      }
    }
  }
  const element=(id,classes='')=>{const result=new Element(id,classes);elements.set(id,result);return result;};
  const panels=['guests','details','catalog','ingredients','beverages','addons','drinkrecs','normal','new440','guides','sources'].map(tab=>element('panel-'+tab,'tab-panel'));
  const panel=element('detail-panel');panel.hidden=true;panel.mark=new Element('','detail-name-mark');panel.appendChild(panel.mark);
  const body=element('detail-body');panel.appendChild(body);
  const filterContent=new Element('','filter-content');
  const aside=element('workbench-filters');aside.dataset.section='tags';aside.appendChild(filterContent);
  const head=element('ryotei-head-tools'),contextElement=element('service-context');aside.appendChild(contextElement);
  const tabs=['meals','drinks','addons','bonds'].map(tab=>{const button=new Element();button.dataset.detailTab=tab;return button;});
  for(const id of ['detail-title','detail-sub','detail-seal','detail-tastes','detail-tabs','detail-close','detail-backdrop',
    'section-nav','service-place','service-count','service-visitors','detail-guest-filter','addon-guest-filter','drinkrec-guest-filter',
    'visitor-filter','visitor-rare','visitor-normal','guest-grid','guest-count','filter-sections','filter-visitors','filter-tags',
    'filter-toggle','filter-close','filter-backdrop','page-filters','ryotei-workbench','reference-menu','global-results',
    'ryotei-page-title','ryotei-chapter-stamp','ryotei-page-code',
    'global-search','guest-search','guest-type-filter','detail-search','catalog-search','ingredient-search','ingredient-type-filter',
    'beverage-search','addon-search','addon-scene-filter','drinkrec-search','normal-search','guide-search','theme-toggle',
    'addon-sort-filter','drinkrec-sort-filter','detail-count','catalog-count','ingredient-count','beverage-count','addon-count','drinkrec-count']) element(id);
  for(const tab of tabs) elements.get('detail-tabs').appendChild(tab);
  for(const id of ['detail-table-wrap','catalog-table-wrap','ingredient-table-wrap','beverage-table-wrap','addon-table-wrap','drinkrec-table-wrap']) element(id,'table-wrap');
  const header=new Element('','site-header');
  const documentListeners=new Map();
  const document={documentElement:new Element(),body:{style:{overflow:''}},activeElement:null,
    getElementById:id=>elements.get(id)||null,
    querySelector(selector){
      if(selector === '#detail-body .detail-scroller') return body.scroller || null;
      if(selector === '#detail-body .detail-chips') return body.children.find(child=>child.classList.contains('detail-chips')) || null;
      if(selector === '#detail-panel > .detail-name-mark') return panel.mark;
      if(selector === '.site-header') return header;
      if(selector === '.filter-content') return filterContent;
      if(selector === '#page-filters > .toolbar:not([hidden])') return null;
      if(selector.startsWith('#') && !selector.includes(' ')) return elements.get(selector.slice(1)) || null;
      return null;
    },
    querySelectorAll(selector){
      if(selector === '.tab-panel') return panels;
      if(selector === '#detail-tabs [data-detail-tab]') return tabs;
      if(selector === '.site-header, main, .site-footer') return [header,head,aside];
      return [];
    },
    addEventListener(type,fn){const listeners=documentListeners.get(type)||[];listeners.push(fn);documentListeners.set(type,listeners);}
  };
  const location={hash:'#guests',href:'file:///guide.html#guests'};
  const history={state:{},replaceState(value,_title,url){this.state=value;if(url && String(url).startsWith('#')) location.hash=url;}};
  const window={WAFU_ASSETS:{avatars:{},normal:{},icons:{}},scrollY:0,scrollX:0,
    matchMedia:()=>({matches:true,addEventListener(){}}),addEventListener(){},requestIdleCallback(){},
    setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);},
    scrollTo(options){this.scrollY=options.top;this.scrollX=options.left || 0;}};
  const guests=['客人甲','客人乙'].map(name=>({'客人名字':name,'类型':'本篇稀客','出没地点':'妖怪兽道','持有金':'200-400',
    '喜好料理标签':'清淡','厌恶料理标签':'无','喜好酒水标签':'低酒精',
    '加料推荐':Array.from({length:112},(_,id)=>'食材'+String(id).padStart(3,'0')+'（补清淡）').join('；')}));
  const recipes=Array.from({length:112},(_,id)=>({'菜品':'料理'+String(id).padStart(3,'0'),'价格':String(id+1),'等级':'1','主料':'食材000','菜品标签':'清淡','厨具':'煮锅'}));
  const drinks=Array.from({length:112},(_,id)=>({'酒水':'酒水'+String(id).padStart(3,'0'),'价格':String(id+1),'等级':'1','标签':'低酒精'}));
  const ingredients=Array.from({length:112},(_,id)=>({'食材':'食材'+String(id).padStart(3,'0'),'价格':String(id+1),'等级':'1','标签':'清淡'}));
  const sheets={};
  for(const [key,rows] of Object.entries({guests,normal:[],recipes,beverages:drinks,ingredients})) {
    const headers=rows.length ? Object.keys(rows[0]) : [];
    sheets[key]={headers,rows:rows.map(row=>headers.map(key=>row[key]))};
  }
  const charPinyin={清:['qing'],淡:['dan'],家:['jia'],常:['chang'],素:['su'],酸:['suan'],生:['sheng'],低:['di'],酒:['jiu'],精:['jing']};
  element('app-data').textContent=JSON.stringify({sheets,charPinyin});
  element('guest-food-rules').textContent=JSON.stringify(rules);
  let source=Array.from(template.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)).find(match=>match[2].includes('const DATA = JSON.parse'))?.[2];
  assert.ok(source,'整份模板运行脚本存在');
  source=source.replace('/*__RYOTEI_UI__*/',()=>ui).replace('/*__RYOTEI_NAVIGATION__*/',()=>navigation);
  const entry='\ninit();\n})();';
  assert.ok(source.includes(entry),'测试只移除自动init入口，不裁掉业务函数');
  source=source.replace(entry,`\nglobalThis.testApp={state,ryoteiPages,route,switchTab,openGuest,closeGuest,bindEvents,ryoteiUiInit,
    ryoteiCaptureView,ryoteiRestoreView,ryoteiNavigate,renderDetailPane,makeRyoteiTable,
    resolveTags,handleTagInputKeydown,buildMealIndex,buildAddonIndex,ryoteiPrepCoverage,
    get lastRenderedTab(){return lastRenderedTab;}};\n})();`);
  const runtime=vm.createContext({document,window,location,history,URLSearchParams,
    requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id),
    getComputedStyle:()=>({scrollMarginTop:'100px'})});
  new vm.Script(source,{filename:'guide_template+ryotei_ui+ryotei_navigation.js'}).runInContext(runtime);
  const flush=()=>{let rounds=0;while(frames.size){assert.ok(++rounds < 10,'rAF队列必须收敛');const pending=Array.from(frames.values());frames.clear();for(const fn of pending) fn();}};
  const click=target=>{
    const event={target,button:0,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
    for(let node=target;node;node=node.parentElement) node.emit('click',event);
    for(const fn of documentListeners.get('click')||[]) fn(event);
  };
  return {app:runtime.testApp,elements,body,panel,tabs,window,location,history,frames,flush,click,element,
    nextButton:key=>{const button=body.querySelectorAll('[data-table-page]').find(button=>button.dataset.tablePage === key && button.dataset.direction === '1');assert.ok(button,'渲染结果中必须存在分页按钮: '+key);return button;}};
}
const sourceTest=sourceRuntime();
const {app,elements,body,panel,tabs,window:sourceWindow,location:sourceLocation,history:sourceHistory,frames,flush,click,nextButton}=sourceTest;
app.ryoteiUiInit();app.bindEvents();app.route();flush();
assert.equal(elements.get('guest-grid').writes,1,'整模块初次路由只渲染一次名簿');
sourceLocation.hash='#guests/' + encodeURIComponent('客人甲');app.route();flush();
const gridWrites=elements.get('guest-grid').writes;
app.state.detailMealSort={key:'价格',dir:-1};app.renderDetailPane({'客人名字':'客人甲'});flush();
const mealInput=elements.get('detail-meal-search');
click(nextButton('detailMealSort'));flush();
assert.equal(app.ryoteiPages.detailMealSort.page,1,'document分页点击必须翻到详情第二页');
assert.ok(body.scroller.innerHTML.includes('料理061'),'详情第二页真的重画为全量排序后的第51项');
assert.ok(!body.scroller.innerHTML.includes('料理111'),'详情第二页不能继续显示第一页');
assert.equal(elements.get('detail-meal-search'),mealInput,'料理分页保留工具栏与输入焦点节点');
assert.equal(elements.get('guest-grid').writes,gridWrites,'详情料理分页不得重画底层人物网格');
sourceLocation.hash='#guests/' + encodeURIComponent('客人乙');app.route();flush();
assert.equal(app.ryoteiPages.detailMealSort.page,0,'同候选数换客必须从第一页开始');
assert.ok(body.scroller.innerHTML.includes('料理111'));
assert.equal(app.state.detailGuest,'all','详情paneGuest与备菜route筛选detailGuest仍独立');
body.scroller.scrollTop=123;body.scroller.scrollLeft=48;
app.renderDetailPane({'客人名字':'客人乙'});flush();
assert.equal(body.scroller.scrollTop,123,'同客人局部重画保留纵向阅读位置');
assert.equal(body.scroller.scrollLeft,48,'同客人局部重画保留横向阅读位置');
click(tabs[1]);flush();
assert.equal(body.scroller.scrollTop,0,'正常切详情页签仍回到顶部');
assert.equal(body.scroller.scrollLeft,0,'正常切详情页签不继承前一表的横向位置');
const drinkInput=elements.get('detail-drink-search');
click(nextButton('detailDrinkSort'));flush();
assert.equal(app.ryoteiPages.detailDrinkSort.page,1,'详情酒水分页点击有效');
assert.equal(elements.get('detail-drink-search'),drinkInput,'酒水分页只刷新列表');
assert.equal(elements.get('guest-grid').writes,gridWrites);
click(tabs[2]);flush();click(nextButton('detailAddonSort'));flush();
assert.equal(app.ryoteiPages.detailAddonSort.page,1,'详情加料分页点击有效');
assert.ok(body.scroller.innerHTML.includes('食材050'),'加料页真实显示升序第二页');
assert.equal(elements.get('guest-grid').writes,gridWrites,'详情加料分页也不能重画网格');
const stale=nextButton('detailAddonSort');app.closeGuest(false);click(stale);flush();
assert.equal(app.ryoteiPages.detailAddonSort.page,1,'已关闭详情的旧分页按钮不能继续改页码');

// 同客人恢复另一个详情页签：query/chips/排序/页码和真实输入/行DOM/两个滚动方向都必须一致。
sourceLocation.hash='#guests/' + encodeURIComponent('客人甲');app.route();flush();
app.state.detailTab='drinks';app.state.detailDrinkQuery='酒水';app.state.detailDrinkChips=['低酒精'];
app.state.detailDrinkSort={key:'价格',dir:-1};app.openGuest('客人甲',false);flush();
click(nextButton('detailDrinkSort'));flush();
body.scroller.scrollTop=310;body.scroller.scrollLeft=84;sourceWindow.scrollY=190;sourceWindow.scrollX=27;
const saved=app.ryoteiCaptureView();
assert.equal(saved.detailScroll.top,310);assert.equal(saved.detailScroll.left,84,'详情scrollX保存于唯一detail-scroller');
assert.equal(saved.scrollLeft,27,'页面水平阅读位置也保存');
assert.equal(Object.hasOwn(saved.state,'paneGuest'),false,'快照不保存DOM已渲染客人的伪标记');
assert.equal(saved.reading.find(entry=>entry.selector === '#detail-body').scrolls[0].left,84,'reading快照真实包含detail-scroller');
click(tabs[0]);flush();app.state.detailMealQuery='料理';app.state.detailMealChips=['清淡'];app.openGuest('客人甲',false);flush();
sourceHistory.state={ryoteiView:saved};app.ryoteiRestoreView();flush();
assert.equal(app.state.detailTab,'drinks');assert.equal(app.state.detailDrinkQuery,'酒水');
assert.deepEqual(Array.from(app.state.detailDrinkChips),['低酒精']);
assert.equal(app.ryoteiPages.detailDrinkSort.page,1);
assert.ok(elements.get('detail-drink-search'),'同客人后退必须渲染已恢复的酒水页签DOM');
assert.equal(elements.get('detail-drink-search').value,'酒水','同客人后退必须重画已恢复的查询输入DOM');
assert.ok(body.innerHTML.includes('chip active'),'恢复的chip必须在真实工具栏标为选中');
assert.ok(body.scroller.innerHTML.includes('酒水061'),'恢复的页码必须落到真实列表DOM');
assert.equal(tabs.find(tab=>tab.dataset.detailTab === 'drinks').classList.contains('active'),true);
assert.equal(body.scroller.scrollTop,310);assert.equal(body.scroller.scrollLeft,84);
assert.equal(sourceWindow.scrollY,190);assert.equal(sourceWindow.scrollX,27);
assert.equal(elements.get('guest-grid').writes,gridWrites,'详情内的历史字段变化不重画背景网格');
const bodyWrites=body.writes;app.ryoteiRestoreView();flush();
assert.equal(body.writes,bodyWrites,'无详情字段/页码差异的重复恢复不能重画详情');

// 换客人后后退保留旧查询，不走普通换人清过滤。
sourceLocation.hash='#guests/' + encodeURIComponent('客人乙');app.route();flush();
assert.equal(app.state.detailDrinkQuery,'','正常导航换客仍清查询');
assert.equal(app.state.detailDrinkChips.length,0,'正常导航换客仍清chips');
sourceLocation.hash='#guests/' + encodeURIComponent('客人甲');sourceHistory.state={ryoteiView:saved};app.ryoteiRestoreView();flush();
assert.equal(app.state.openGuest,'客人甲');assert.equal(app.state.detailDrinkQuery,'酒水','换客后退不能被openGuest清空恢复查询');
assert.deepEqual(Array.from(app.state.detailDrinkChips),['低酒精']);
assert.equal(elements.get('detail-drink-search').value,'酒水');assert.equal(app.ryoteiPages.detailDrinkSort.page,1);
assert.equal(body.scroller.scrollLeft,84);assert.equal(body.scroller.scrollTop,310);
app.state.detailDrinkChips.push('测试标签');app.ryoteiPages.detailDrinkSort.page=2;
assert.deepEqual(Array.from(saved.state.detailDrinkChips),['低酒精'],'继续改chip不能污染历史快照');
assert.equal(saved.pages.detailDrinkSort.page,1,'继续翻页不能污染历史快照');
app.ryoteiRestoreView();flush();

// 恢复帧不能覆盖更晚的导航；旧记录仅有纵向detailScroll也要保持兼容。
app.ryoteiRestoreView();app.ryoteiNavigate('#catalog?item=' + encodeURIComponent('料理001'));flush();
assert.equal(app.state.tab,'catalog');assert.equal(app.state.openGuest,'');
assert.equal(app.state.focusItem,'料理001','历史恢复不破精确条目跳转');
assert.equal(elements.get('catalog-table-wrap').innerHTML.includes('料理001'),true);
assert.equal(elements.get('catalog-table-wrap').innerHTML.includes('料理002'),false);
sourceLocation.hash='#guests/' + encodeURIComponent('客人甲');
sourceHistory.state={ryoteiView:{...saved,detailScroll:321}};app.ryoteiRestoreView();flush();
assert.equal(body.scroller.scrollTop,321,'兼容既有仅存纵向位置的history条目');
assert.equal(body.scroller.scrollLeft,84,'旧纵向字段不覆盖reading快照恢复的横向位置');
assert.equal(frames.size,0);

// 不同底层页签后退也须恢复真正的表格页码/query/chips/纵横滚动，不能仅赋state跳过渲染。
app.ryoteiNavigate('#catalog');flush();
app.state.catalogQuery='料理';app.state.catalogChips=['清淡'];app.state.catalogSort={key:'价格',dir:-1};
app.route({}); // 当前页无路由变化；由真实筛选输入触发其表格重画。
elements.get('catalog-search').emit('input',{target:{value:'料理'}});flush();
const catalogWrap=elements.get('catalog-table-wrap');
const nextCatalog=catalogWrap.querySelectorAll('[data-table-page]').find(button=>button.dataset.direction === '1');
assert.ok(nextCatalog,'底层菜谱有第二页');click(nextCatalog);flush();
assert.equal(app.ryoteiPages.catalogSort.page,1);
catalogWrap.tableHost.scrollTop=215;catalogWrap.tableHost.scrollLeft=67;
const catalogView=app.ryoteiCaptureView();
app.ryoteiNavigate('#guests');flush();sourceLocation.hash='#catalog';sourceHistory.state={ryoteiView:catalogView};
app.ryoteiRestoreView();flush();
assert.equal(app.state.tab,'catalog');assert.equal(app.state.catalogQuery,'料理');assert.deepEqual(Array.from(app.state.catalogChips),['清淡']);
assert.equal(elements.get('catalog-search').value,'料理');assert.equal(app.ryoteiPages.catalogSort.page,1);
assert.ok(catalogWrap.innerHTML.includes('料理061'),'跨底层页签后退恢复真实第二页内容');
assert.equal(catalogWrap.tableHost.scrollTop,215);assert.equal(catalogWrap.tableHost.scrollLeft,67);

const tagTest=sourceRuntime();
const tagApp=tagTest.app;
tagApp.ryoteiUiInit();tagApp.bindEvents();tagApp.openGuest('客人甲',false);tagTest.flush();
const typeTag=value=>{
  const id=tagApp.state.detailTab === 'meals' ? 'detail-meal-search' : 'detail-drink-search';
  const input=tagTest.elements.get(id);input.value=value;
  tagTest.body.emit('input',{target:input});
  return input;
};
const pressTag=(input,key='Enter',extra={})=>{
  const event={target:input,key,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...extra};
  tagTest.body.emit('keydown',event);tagTest.flush();return event;
};
const tagGridWrites=tagTest.elements.get('guest-grid').writes;
for(const query of ['清淡','qingdan','qd']) {
  tagApp.state.detailMealChips=[];
  const input=typeTag(query);input.focus();
  assert.equal(pressTag(input).defaultPrevented,true);
  assert.deepEqual(Array.from(tagApp.state.detailMealChips),['清淡'],'中文/全拼/首字母回车加入料理标签: '+query);
  assert.equal(tagApp.state.detailMealQuery,'');assert.equal(input.value,'');
  assert.equal(tagTest.elements.get('detail-meal-search'),input,'固定标签只刷新列表，不重建输入节点');
  assert.equal(tagTest.body.innerHTML.includes('回车选择标签'),true);
  assert.ok(tagTest.body.children.find(child=>child.classList.contains('detail-chips')).outerHTML.includes('chip active'));
  typeTag(query);pressTag(input);
  assert.equal(tagApp.state.detailMealChips.length,1,'重复回车不取消也不重复选中标签');
  pressTag(input,'Backspace');assert.equal(tagApp.state.detailMealChips.length,0,'空搜索框退格取消最后一项');
  assert.equal(tagTest.elements.get('guest-grid').writes,tagGridWrites,'标签交互不重画背景名簿');
}
const composing=typeTag('qingdan');
assert.equal(pressTag(composing,'Enter',{isComposing:true}).defaultPrevented,false,'输入法组合回车不拦截');
assert.equal(tagApp.state.detailMealChips.length,0);assert.equal(composing.value,'qingdan');
assert.equal(pressTag(composing,'Enter',{keyCode:229}).defaultPrevented,false,'旧输入法229也不触发标签选择');
const unmatched=typeTag('找不到的标签');pressTag(unmatched);
assert.equal(unmatched.value,'找不到的标签');assert.equal(tagApp.state.detailMealChips.length,0);
assert.ok(tagTest.elements.get('detail-tag-message').textContent.includes('未找到唯一标签'));
assert.equal(unmatched.value,tagApp.state.detailMealQuery,'失败时保留普通搜索词');
const clicked=tagTest.element('test-detail-chip');clicked.dataset.detailChip='清淡';tagTest.body.appendChild(clicked);
tagTest.click(clicked);tagTest.flush();
assert.deepEqual(Array.from(tagApp.state.detailMealChips),['清淡'],'鼠标点击与键盘选择写入相同清单');
tagApp.state.detailMealChips=[];typeTag('qingdan');pressTag(tagTest.elements.get('detail-meal-search'));
assert.deepEqual(Array.from(tagApp.state.detailMealChips),['清淡']);
tagTest.click(tagTest.tabs[1]);tagTest.flush();
for(const query of ['低酒精','dijiujing','djj']) {
  tagApp.state.detailDrinkChips=[];
  const input=typeTag(query);pressTag(input);
  assert.deepEqual(Array.from(tagApp.state.detailDrinkChips),['低酒精'],'酒水详情也支持标签回车: '+query);
  assert.equal(tagApp.state.detailDrinkQuery,'');assert.equal(input.value,'');
}
const uniqueCfg={suggestions:['家常','清淡']};
assert.deepEqual(Array.from(tagApp.resolveTags(uniqueCfg,'jc')),['家常']);
assert.deepEqual(Array.from(tagApp.resolveTags(uniqueCfg,'jiachang')),['家常']);
assert.deepEqual(Array.from(tagApp.resolveTags(uniqueCfg,'jc qd')),['家常','清淡'],'多个无歧义拼音可一起加入');
assert.equal(tagApp.resolveTags({suggestions:['素','酸']},'s').length,0,'歧义缩写不得按标签排序静默选第一项');
assert.deepEqual(Array.from(tagApp.resolveTags({suggestions:['素','酸']},'su')),['素']);
assert.deepEqual(Array.from(tagApp.resolveTags({suggestions:['素','酸']},'suan')),['酸']);
assert.deepEqual(Array.from(tagApp.resolveTags({suggestions:['生']},'seng')),['生'],'继续支持z/zh c/ch s/sh模糊音');
tagApp.openGuest('客人乙',false);tagTest.flush();
assert.equal(tagApp.state.detailMealChips.length,0);assert.equal(tagApp.state.detailDrinkChips.length,0,'换人仍清空详情标签');
const exceptionTest=sourceRuntime({
  foodExclusions:[{guestName:'客人甲',foodName:'料理111',reason:'菜品彩蛋直接判最低评价'}],
  ingredientExclusions:[{guestName:'客人甲',ingredientName:'食材001',reason:'食材特殊判定'}]
});
exceptionTest.app.ryoteiUiInit();exceptionTest.app.bindEvents();exceptionTest.app.openGuest('客人甲',false);exceptionTest.flush();
assert.equal(exceptionTest.app.buildMealIndex().filter(row=>row['客人名字']==='客人甲').length,111,'实际索引排除已知坏评菜');
assert.ok(!exceptionTest.body.scroller.innerHTML.includes('料理111'),'客人详情不可显示坏评菜');
assert.ok(exceptionTest.elements.get('detail-tastes').innerHTML.includes('特殊判定'),'详情头部说明排除原因');
assert.ok(exceptionTest.elements.get('detail-tastes').innerHTML.includes('食材001'));
assert.ok(!exceptionTest.app.buildAddonIndex().some(row=>row['客人名字']==='客人甲' && row['食材']==='食材001'),'实际加料索引排除受特殊判定影响的食材');
assert.ok(exceptionTest.app.buildAddonIndex().some(row=>row['客人名字']==='客人乙' && row['食材']==='食材001'),'食材特例不能误删其他客人的加料');
const coverage=exceptionTest.app.ryoteiPrepCoverage('food').find(item=>item.name==='料理111');
assert.deepEqual(Array.from(coverage.special),['客人乙'],'覆盖榜复用修正后的索引，不再把坏评客人算作覆盖');
exceptionTest.app.ryoteiNavigate('#details?who=' + encodeURIComponent('客人甲'));exceptionTest.flush();
assert.ok(!exceptionTest.elements.get('detail-table-wrap').innerHTML.includes('料理111'),'备菜单客明细也不可显示坏评菜');
assert.ok(!exceptionTest.elements.get('detail-table-wrap').innerHTML.includes('固定口味候选') && !exceptionTest.elements.get('detail-table-wrap').innerHTML.includes('recommendation-note'),'备菜页不再显示固定口味候选说明');
console.log('PASS: 负向菜品/加料特例同步到详情、备菜与覆盖榜，保留其他客人，显示特殊判定原因');
console.log('PASS: 详情标签中文/全拼/首字母回车、去重、退格、输入法保护、失败提示、歧义拒选、焦点节点保持及鼠标一致性');
console.log('PASS: 源码整模块VM — 详情三表document分页、同候选数换客重置、history页签/查询/chips/页码/scrollXY、快照不可变、精确定位、恢复帧竞态');
console.log('PASS: 攻略 JSON、离线资源、脚本语法、11 页导航、地区/共享客人、精确定位与幂等路由、阅读状态恢复、分页、客人加料列头排序、详情关闭与连续切换');
