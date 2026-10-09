// 全量口味匹配回归：对真实数据逐条核对，另覆盖动态标签和厌恶边界。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..');
const data = JSON.parse(fs.readFileSync(path.join(root,'中间数据/料亭版攻略数据基线.json'),'utf8'));
const source = fs.readFileSync(path.join(root,'脚本/ryotei_navigation.js'),'utf8');
const fn = name => {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0,'需要生产函数: ' + name);
  return source.slice(start,source.indexOf('\n}',start)+2);
};
const dataOf = key => data.sheets[key].rows.map(row=>Object.fromEntries(data.sheets[key].headers.map((key,i)=>[key,row[i]])));
const splitTags = value => !value || value === '无' ? [] : String(value).split(/[、,，]/).filter(Boolean);
const counts={};
const context = {assert,dataOf,splitTags,Map,Set,counts};
vm.runInNewContext(`
  const ryoteiRecommendations = new Map();
  ${fn('ryoteiStaticTags')}
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
        return likes.some(tag=>tags.includes(tag)) && !dislikes.some(tag=>tags.includes(tag));
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
`,context);
const evidence=path.join(root,'验证记录/2026-10-10--侧栏布局与全量推荐');
fs.mkdirSync(evidence,{recursive:true});
fs.writeFileSync(path.join(evidence,'全量口味匹配_逐客人检查.json'),JSON.stringify({status:'PASS',...counts},null,2));
console.log('PASS: 106 位客人的全部料理和酒水匹配集合、厌恶排除、动态标签、无上限、缓存。');
