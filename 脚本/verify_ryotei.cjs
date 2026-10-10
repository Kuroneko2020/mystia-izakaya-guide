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
let scriptCount = 0;
for (const match of output.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (match[1].includes('application/json')) continue;
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
  const scrolls=[{scrollTop:310,scrollLeft:84}], details=[{open:true},{open:false}];
  const row={hidden:false}, rowClass={toggle(name,value){this.expanded=value;}};
  const buttons=[{expanded:'true',getAttribute(name){return name === 'aria-expanded' ? this.expanded : 'detail-row';},setAttribute(name,value){this.expanded=value;},closest(){return {classList:rowClass};}}];
  const scope={querySelectorAll(selector){return selector === 'details' ? details : selector === '[data-row-expand]' ? buttons : scrolls;}};
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
  const history={state:{ryoteiView:view}};
  let lastRenderedTab='catalog',domPage=0,renders=0;
  const route=()=>{if (lastRenderedTab !== state.tab) {domPage=ryoteiPages.catalogSort.page;renders++;lastRenderedTab=state.tab;}};
  const syncRyoteiControls=()=>{},updateRyoteiReturn=()=>{},ryoteiRestoreReading=()=>{};
  const requestAnimationFrame=fn=>fn(),window={scrollTo(){}},$=()=>({scrollTop:0});
  ${getFunction('ryoteiRestoreView',navigation)}
  ryoteiRestoreView();
  assert.equal(domPage,2,'同页同筛选但不同分页的返回必须刷新到保存页');
  assert.equal(renders,1);
  ryoteiRestoreView();
  assert.equal(renders,1,'无状态差异的返回不能重建背景列表');
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
console.log('PASS: 攻略 JSON、离线资源、脚本语法、11 页导航、地区/共享客人、精确定位与幂等路由、阅读状态恢复、分页、详情关闭与连续切换');
