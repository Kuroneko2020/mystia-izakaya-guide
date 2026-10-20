// 全量口味匹配回归：对真实数据逐条核对，另覆盖动态标签和厌恶边界。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..');
const data = JSON.parse(fs.readFileSync(path.join(root,'中间数据/料亭版攻略数据基线.json'),'utf8'));
const source = fs.readFileSync(path.join(root,'脚本/ryotei_navigation.js'),'utf8');
// 生产导航复用模板中的统一标签顺序（命中喜好按游戏 Tag 顺序输出），独立回归需注入同一实现。
const template = fs.readFileSync(path.join(root,'脚本/guide_template_ryotei.html'),'utf8');
const tagOrderStart = template.indexOf('/* ---------------- 标签显示顺序');
const tagOrderEnd = template.indexOf('/* ---------------- 拼音搜索');
assert.ok(tagOrderStart > 0 && tagOrderEnd > tagOrderStart,'模板包含标签显示顺序定义');
const tagOrderSource = template.slice(tagOrderStart,tagOrderEnd);
const rules = JSON.parse(fs.readFileSync(path.join(root,'中间数据/GAME_GUEST_FOOD_RULES.json'),'utf8'));
const excludedPairs = new Set(rules.resolvedFoodExclusions.map(rule=>rule.guestName + '\u0001' + rule.foodName));
const fn = name => {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0,'需要生产函数: ' + name);
  return source.slice(start,source.indexOf('\n}',start)+2);
};
const dataOf = key => data.sheets[key].rows.map(row=>Object.fromEntries(data.sheets[key].headers.map((key,i)=>[key,row[i]])));
const splitTags = value => !value || value === '无' ? [] : String(value).split(/[、,，]/).filter(Boolean);
const counts={};
const context = {assert,dataOf,splitTags,Map,Set,counts,GUEST_FOOD_RULES:rules,excludedPairs};
vm.runInNewContext(`
  const ryoteiRecommendations = new Map();
  ${tagOrderSource}
  ${fn('ryoteiStaticTags')}
  ${fn('ryoteiFoodException')}
  ${fn('ryoteiIngredientException')}
  ${fn('ryoteiRecommendationRows')}
  assert.equal(ryoteiStaticTags('流行喜爱（动态）、甜、梦幻').join('、'),'甜、梦幻');
  for (const [kind,sheet,tagsField,likesField,dislikesField,itemField] of [
    ['food','recipes','菜品标签','喜好料理标签','厌恶料理标签','菜品'],
    ['drink','beverages','标签','喜好酒水标签','厌恶酒水标签','酒水']
  ]) {
    const rows = ryoteiRecommendationRows(kind);
    assert.equal(rows,ryoteiRecommendationRows(kind),'复用索引，切页不重新做客人和物品的笛卡尔匹配');
    let expectedTotal=0;
    for (const guest of dataOf('guests').concat(dataOf('normal'))) {
      const name=guest['客人名字'] || guest['普通客人'];
      const likes=ryoteiStaticTags(guest[likesField]), dislikes=ryoteiStaticTags(guest[dislikesField]);
      const expected=dataOf(sheet).filter(item=>{
        const tags=splitTags(item[tagsField]);
        return likes.some(tag=>tags.includes(tag)) && !dislikes.some(tag=>tags.includes(tag)) &&
          !(kind === 'food' && excludedPairs.has(name + '\u0001' + item[itemField]));
      }).map(item=>item[itemField]).sort();
      const actual=rows.filter(row=>row['客人名字']===name).map(row=>row[itemField]).sort();
      assert.equal(JSON.stringify(actual),JSON.stringify(expected),name + ' 的完整 ' + kind + ' 名单');
      expectedTotal+=expected.length;
    }
    assert.equal(rows.length,expectedTotal,'名单无重复且无数量、价格截断');
    assert.ok(rows.some(row=>Number(row['价格'])>200),'推荐可超过200元');
    counts[kind]={total:rows.length,guests:dataOf('guests').concat(dataOf('normal')).map(guest=>{
      const name=guest['客人名字'] || guest['普通客人'];
      return {name,count:rows.filter(row=>row['客人名字']===name).length};
    })};
  }
  assert.ok(ryoteiRecommendationRows('food').filter(row=>row['客人名字']==='因幡帝').length>6);
  assert.ok(ryoteiRecommendationRows('drink').some(row=>row['客人名字']==='妖怪兔'));
  for (const [guest,food] of [['古明地恋','无意识妖怪慕斯'],['绵月丰姬','蜜桃红烧肉'],['月人','蜜桃红烧肉'],['犬走椛','疯帽子茶会']]) {
    assert.ok(!ryoteiRecommendationRows('food').some(row=>row['客人名字']===guest && row['菜品']===food),'原生负向彩蛋不得推荐: '+guest+' / '+food);
  }
  assert.ok(ryoteiRecommendationRows('food').some(row=>row['客人名字']==='射命丸文' && row['菜品']==='真·海鲜味噌汤' && row['命中喜好']==='家常'),'无反证不得给文和真汤增加黑名单');
  assert.ok(ryoteiIngredientException('犬走椛','可可豆'),'加料食材特例与主料过滤共用规则');
  assert.equal(ryoteiIngredientException('射命丸文','可可豆'),undefined,'特例不能误伤其他客人');
  assert.ok(ryoteiFoodException('犬走椛',{'菜品':'临时菜','主料':'面粉＋可可豆'}),'新菜同样按主料规则排除，不只硬编码现有菜');
  assert.equal(ryoteiFoodException('犬走椛',{'菜品':'临时菜','主料':'面粉＋可可豆酱'}),undefined,'食材须精确匹配，不以名字包含关系误伤');
  counts.rules={food:GUEST_FOOD_RULES.foodExclusions.length,ingredient:GUEST_FOOD_RULES.ingredientExclusions.length};
`,context);
const auditPath=path.join(root,'验证记录/2026-10-17--家常误荐与标签回车/game_semantics_audit_01.json');
const audit=JSON.parse(fs.readFileSync(auditPath,'utf8'));
const actualFoodRows=vm.runInNewContext("ryoteiRecommendationRows('food');",context);
const pairKey=(guest,food)=>guest+'\u0001'+food;
const independent=new Map(audit.allFixedCandidateRelations.filter(row=>!row.exceptions.length)
  .map(row=>[pairKey(row.guestName,row.foodName),row.hits.slice().sort()]));
assert.equal(independent.size,9202,'独立原生审计排除且仅排除四条');
assert.equal(actualFoodRows.length,independent.size);
for(const row of actualFoodRows){
  const key=pairKey(row['客人名字'],row['菜品']);
  assert.ok(independent.has(key),'生产关系必须在独立原生审计中: '+key);
  assert.deepEqual(splitTags(row['命中喜好']).sort(),independent.get(key),'每对命中标签须与独立审计完全相同: '+key);
  independent.delete(key);
}
assert.equal(independent.size,0,'生产集合与独立原生审计双向无遗漏');
counts.independentAudit={cartesianPairs:17278,selectedComparisons:2227,before:9206,removed:4,after:actualFoodRows.length,allHitSetsIdentical:true};
const outAt = process.argv.indexOf('--out-dir');
if (outAt >= 0) {
  assert.ok(process.argv[outAt + 1], '--out-dir 需要显式目录');
  const evidence = path.resolve(process.argv[outAt + 1]);
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, '全量口味匹配_逐客人检查.json'), JSON.stringify({ status: 'PASS', ...counts }, null, 2), { flag: 'wx' });
}
console.log('PASS: 106 位客人的全部料理和酒水匹配集合、厌恶/原生彩蛋排除、食材特例、动态标签、无上限、缓存。');
