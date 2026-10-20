// 只运行Node回归并写repair_证据；不构建，不写其它生产文件、成品或历史证据。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const root = path.resolve(__dirname,'..','..','..');
const owned=['脚本/ryotei_ui.js','脚本/ryotei_navigation.js','脚本/verify_ryotei.cjs'];
const baseline=JSON.parse(fs.readFileSync(path.join(__dirname,'repair_owned_before.json'),'utf8'));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function protectedState(){
  const files={};
  const walk=dir=>{if(!fs.existsSync(dir)) return;for(const item of fs.readdirSync(dir,{withFileTypes:true})) {
    const name=path.join(dir,item.name);
    if(item.isDirectory()) walk(name);
    else if(item.isFile()) files[path.relative(root,name).replaceAll('\\','/')]=sha(fs.readFileSync(name));
  }};
  walk(path.join(root,'成品'));
  files['中间数据/料亭版攻略数据基线.json']=sha(fs.readFileSync(path.join(root,'中间数据','料亭版攻略数据基线.json')));
  return files;
}
const protectedBefore=protectedState(),commands=[];
function run(program,args){
  const result=cp.spawnSync(program,args,{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
  const entry={program:program === process.execPath ? 'node' : program,args,status:result.status,
    stdout:result.stdout || '',stderr:result.stderr || '',error:result.error?.message || null};
  commands.push(entry);return entry;
}
for(const name of owned) run(process.execPath,['--check',path.join(root,name)]);
run(process.execPath,[path.join(root,'脚本','verify_ryotei.cjs')]);
run(process.execPath,[path.join(__dirname,'repair_regression_probe.cjs')]);
run('git',['-C',root,'-c','core.quotepath=false','diff','--check','--',...owned]);
const protectedAfter=protectedState();
const changed=Array.from(new Set([...Object.keys(protectedBefore),...Object.keys(protectedAfter)]))
  .filter(name=>protectedBefore[name] !== protectedAfter[name]).map(name=>({name,before:protectedBefore[name],after:protectedAfter[name]}));
const after={},patches=[];
for(const name of owned) {
  const bytes=fs.readFileSync(path.join(root,name));
  const original=baseline.files[name].text.replace(/\r\n/g,'\n').split('\n');
  const current=bytes.toString('utf8').replace(/\r\n/g,'\n').split('\n');
  let first=0;while(first < original.length && first < current.length && original[first] === current[first]) first++;
  let endOld=original.length,endNew=current.length;
  while(endOld > first && endNew > first && original[endOld-1] === current[endNew-1]) {endOld--;endNew--;}
  const patch=['--- owned-before/'+name,'+++ working/'+name,
    '@@ -'+(first+1)+','+(endOld-first)+' +'+(first+1)+','+(endNew-first)+' @@',
    ...original.slice(first,endOld).map(line=>'-'+line),...current.slice(first,endNew).map(line=>'+'+line)].join('\n')+'\n';
  patches.push(patch);
  after[name]={beforeSha256:baseline.files[name].sha256,sha256:sha(bytes),bytes:bytes.length};
}
fs.writeFileSync(path.join(__dirname,'repair_owned_delta.patch'),patches.join(''));
const head=cp.spawnSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'});
const status=cp.spawnSync('git',['-C',root,'-c','core.quotepath=false','status','--short','--',...owned],{encoding:'utf8'});
const mutation=JSON.parse(fs.readFileSync(path.join(__dirname,'repair_mutation_results.json'),'utf8'));
const report=JSON.parse(fs.readFileSync(path.join(root,'成品','料亭立体头像版_构建校验.json'),'utf8'));
const result={createdAt:new Date().toISOString(),node:process.version,head:head.stdout.trim(),
  ownedStatus:status.stdout,files:after,templateSha256:sha(fs.readFileSync(path.join(root,'脚本','guide_template_ryotei.html'))),
  activeOutputObserved:report.outputFile || null,commands,
  mutation:{control:mutation.results[0].actual,expectedDefects:mutation.results.length-1,caught:mutation.results.filter(item=>item.expectedFailure && item.actual === 'FAIL').length},
  protectedDuringThisRun:{count:Object.keys(protectedBefore).length,changes:changed,
    scope:'只比较本证据脚本执行前后。并行工作期间主线或其它线程的早先成品变化不归属于本线程，也未回退。'},
  actualScope:{productionModified:owned,uncommitted:true,buildExecuted:false,browserExecuted:false,installation:false,gameTouched:false,commit:false,
    templateContract:'主线已接入 route(options={}), options.restoreDetail -> openGuest(name,false,{restoreView}), openGuest跳过历史恢复时换客清过滤。',
    boundaries:'源码runtime测试整份模板IIFE与ui/nav，不自动init、不加载独立MealUI/domain/session业务；成品仅静态一致性/离线/语法检查，不是新功能成品或浏览器验收。'},
  initialFailedAttempts:[
    '旧verify DOMstub无cancelAnimationFrame，补stub及真实signature后通过，未放宽断言。',
    '整runtime替换源码字符串的$$被replace特殊语义缩成$，改函数替换；补齐heading元素及详情tab父节点。',
    'mutation外层VM缺URLSearchParams，且ui为CRLF影响精确匹配；补全环境并仅规范化内存换行。'
  ]};
const success=commands.every(command=>command.status === 0) && changed.length === 0 && result.mutation.caught === 6;
result.result=success ? 'PASS' : 'FAIL';
fs.writeFileSync(path.join(__dirname,'repair_validation.json'),JSON.stringify(result,null,2));
fs.writeFileSync(path.join(__dirname,'repair_validation.log'),commands.map(command=>
  [command.program+' '+command.args.join(' '),'exit='+command.status,command.stdout,command.stderr].join('\n')).join('\n'));
console.log(JSON.stringify({result:result.result,commands:commands.map(item=>({program:item.program,args:item.args,status:item.status})),
  mutation:result.mutation,protectedCount:result.protectedDuringThisRun.count,protectedChanges:changed.length,ownedStatus:result.ownedStatus},null,2));
if(!success) process.exitCode=1;
