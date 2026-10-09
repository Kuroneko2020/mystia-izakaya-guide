// 独立料亭版：输入一致性、内嵌脚本语法和详情路由重绘回归。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..');
const read = (name) => fs.readFileSync(path.join(root,name),'utf8');
const original = read('成品/东方夜雀食堂攻略查询_和风版.html');
const output = read('成品/东方夜雀食堂攻略查询_料亭优化版.html');
const template = read('脚本/guide_template_ryotei.html');
const appData = (html) => html.match(/<script id="app-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
assert.equal(appData(output),appData(original),'攻略 JSON 必须逐字符一致');
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
const context = vm.createContext({assert});
vm.runInContext(`
  const TAB_IDS = ['guests','details','catalog'];
  const state = {tab:'guests',openGuest:''};
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
  const renderTab = ()=>{counts.list++;};
  const openGuest = name=>{state.openGuest=name;counts.detail++;};
  const closeGuest = ()=>{state.openGuest='';};
  ${getFunction('currentHash')}
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
  assert.equal(counts.list,3,'真实切回客人页应正常渲染');
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
console.log('PASS: 攻略 JSON、离线资源、脚本语法、导航/详情/搜索重绘、分页、详情关闭交互与连续切换');
