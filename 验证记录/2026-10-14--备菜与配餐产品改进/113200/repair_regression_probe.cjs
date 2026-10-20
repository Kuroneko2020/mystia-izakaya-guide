// 在内存中注入单个旧缺陷，验证生产回归断言会失败；不改源码、不构建、不写成品。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname,'..','..','..');
const verifyPath = path.join(root,'脚本','verify_ryotei.cjs');
const uiPath = path.join(root,'脚本','ryotei_ui.js');
const navigationPath = path.join(root,'脚本','ryotei_navigation.js');
const verify = fs.readFileSync(verifyPath,'utf8');
const ui = fs.readFileSync(uiPath,'utf8').replace(/\r\n/g,'\n');
const navigation = fs.readFileSync(navigationPath,'utf8').replace(/\r\n/g,'\n');
const requireFromVerify = createRequire(verifyPath);
const results = [];
function replaceOne(source,from,to){
  assert.equal(source.split(from).length,2,'探针必须精确命中一个源码片段');
  return source.replace(from,()=>to);
}
function run(name,mutateUi,mutateNavigation,expectedFailure){
  const changedUi = mutateUi ? mutateUi(ui) : ui;
  const changedNavigation = mutateNavigation ? mutateNavigation(navigation) : navigation;
  const logs=[];
  const fsRead = {...fs,readFileSync(file,...args){
    const resolved=path.resolve(String(file));
    const changed=resolved === uiPath ? changedUi : resolved === navigationPath ? changedNavigation : null;
    if(changed != null) return typeof args[0] === 'string' || args[0]?.encoding ? changed : Buffer.from(changed);
    return fs.readFileSync(file,...args);
  }};
  let error=null;
  try {
    vm.runInNewContext(verify,{
      require:name=>name === 'node:fs' ? fsRead : requireFromVerify(name),
      __dirname:path.dirname(verifyPath),URLSearchParams,console:{log:(...values)=>logs.push(values.join(' '))}
    },{filename:verifyPath,timeout:60000});
  } catch (failure) {
    error={name:failure.name,message:failure.message};
  }
  if(expectedFailure) assert.ok(error,name + ': 注入缺陷后回归必须失败');
  else assert.equal(error,null,name + ': 当前源码应通过');
  results.push({name,expectedFailure,actual: error ? 'FAIL' : 'PASS',error,logs});
  console.log((expectedFailure ? 'CAUGHT' : 'PASS') + ': ' + name + (error ? ' — ' + error.message.split('\n')[0] : ''));
}
run('当前三份源码与模板控制组',null,null,false);
run('详情分页误刷新背景网格',source=>replaceOne(source,
  "if (detailTab === 'meals') ryoteiRefreshMealList();\n        else if (detailTab === 'drinks') ryoteiRefreshDrinkList();\n        else renderDetailPane(guest);",
  'renderTab(state.tab);'),null,true);
run('同候选数换客继承页码',source=>replaceOne(source,"detail ? state.openGuest || '' : ''","detail ? '' : ''"),null,true);
run('后退同客人不渲染已恢复详情',null,source=>replaceOne(source,'route({restoreDetail});','route();'),true);
run('详情横向滚动不保存',null,source=>replaceOne(source,'left:scroller?.scrollLeft || 0','left:0'),true);
run('reading漏掉唯一详情滚动容器',null,source=>source.replaceAll('.table-wrap,.paged-table-scroll,.filter-content,.detail-scroller','.table-wrap,.paged-table-scroll,.filter-content'),true);
run('恢复页码与历史快照共用引用',null,source=>replaceOne(source,
  'Object.assign(ryoteiPages,JSON.parse(JSON.stringify(view.pages || {})));',
  'Object.assign(ryoteiPages,view.pages || {});'),true);
const inputs=Object.fromEntries([
  '脚本/ryotei_ui.js','脚本/ryotei_navigation.js','脚本/verify_ryotei.cjs','脚本/guide_template_ryotei.html'
].map(name=>[name,{sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')} ]));
fs.writeFileSync(path.join(__dirname,'repair_mutation_results.json'),JSON.stringify({
  createdAt:new Date().toISOString(),node:process.version,inputs,results,
  scope:'纯Node VM；仅替换内存读入文本，不执行构建、不写生产文件或成品。控制组包含活成品静态检查和源码runtime回归；独立MealUI/消费session业务未加载。'
},null,2));
