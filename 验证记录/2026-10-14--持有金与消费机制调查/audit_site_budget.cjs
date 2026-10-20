const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const report = JSON.parse(fs.readFileSync(path.join(root, '成品/料亭立体头像版_构建校验.json'), 'utf8'));
const livePath = path.join(root, '成品', report.outputFile);
const bytes = fs.readFileSync(livePath);
const html = bytes.toString('utf8');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
assert.equal(sha256(bytes), report.outputSha256);
const dataText = html.match(/<script id="app-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
const baseline = fs.readFileSync(path.join(root, '中间数据/料亭版攻略数据基线.json'), 'utf8');
assert.equal(dataText, baseline);
const data = JSON.parse(dataText);
const navigation = fs.readFileSync(path.join(root, '脚本/ryotei_navigation.js'), 'utf8');
const functionText = (source, name) => {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'Missing production function: ' + name);
  const end = source.indexOf('\n}', start);
  assert.ok(end > start);
  return source.slice(start, end + 2);
};
for (const name of ['ryoteiStaticTags', 'ryoteiRecommendationRows']) {
  assert.equal(functionText(html, name).replace(/\r\n/g, '\n'), functionText(navigation, name).replace(/\r\n/g, '\n'));
}
const dataOf = key => data.sheets[key].rows.map(row => Object.fromEntries(data.sheets[key].headers.map((name, i) => [name, String(row[i] ?? '')])));
const context = vm.createContext({ dataOf });
vm.runInContext('const ryoteiRecommendations = new Map();\n' + [
  functionText(html, 'splitTags'),
  functionText(html, 'ryoteiStaticTags'),
  functionText(html, 'ryoteiRecommendationRows')
].join('\n'), context);
const food = vm.runInContext("ryoteiRecommendationRows('food')", context);
const drink = vm.runInContext("ryoteiRecommendationRows('drink')", context);
const budgets = new Map(dataOf('guests').map(guest => {
  const numbers = guest['持有金'].match(/\d+(?:\.\d+)?/g).map(Number);
  assert.ok(numbers.length === 2 || (numbers.length === 1 && guest['持有金'].includes('固定')), guest['客人名字']);
  return [guest['客人名字'], { min: numbers[0], max: numbers[1] ?? numbers[0] }];
}));
const classify = rows => {
  const special = rows.filter(row => budgets.has(row['客人名字']));
  const categories = { atOrBelowMinimum: 0, aboveMinimumAtOrBelowMaximum: 0, aboveMaximum: 0 };
  const aboveMaximum = [];
  for (const row of special) {
    const budget = budgets.get(row['客人名字']);
    const price = Number(row['价格']);
    if (price <= budget.min) categories.atOrBelowMinimum++;
    else if (price <= budget.max) categories.aboveMinimumAtOrBelowMaximum++;
    else {
      categories.aboveMaximum++;
      aboveMaximum.push({ guest: row['客人名字'], item: row['菜品'] || row['酒水'], price, budget, hits: row['命中喜好'] });
    }
  }
  return { totalAllGuestPairs: rows.length, specialGuestPairs: special.length, categories, aboveMaximum };
};
const itemSummary = row => ({ item: row['菜品'] || row['酒水'], price: Number(row['价格']), hits: row['命中喜好'], hitCount: row['命中数'] });
const reimu = {
  budget: budgets.get('博丽灵梦'),
  food: food.filter(row => row['客人名字'] === '博丽灵梦').map(itemSummary),
  drink: drink.filter(row => row['客人名字'] === '博丽灵梦').map(itemSummary)
};
assert.ok(reimu.drink.some(row => row.item === '十四夜' && row.price === 440));
assert.ok(reimu.drink.some(row => row.item === '火鼠裘' && row.price === 420));
const output = {
  inspectedAt: new Date().toISOString(),
  status: 'PASS: deployed and source recommendation functions match; figures are price comparisons, not assertions of game eligibility',
  liveProduct: { relativePath: path.relative(root, livePath), bytes: bytes.length, sha256: sha256(bytes), appDataSha256: sha256(dataText) },
  matchingRule: 'At least one static preference hit; exclude known static dislikes; no price/wallet/order-total filtering',
  defaultOrdering: 'Price descending',
  caveat: 'Budget-range classifications do not establish affordability after prior orders, modifiers, or current hidden wallet. Game eligibility must be established independently from native code.',
  food: classify(food),
  drink: classify(drink),
  reimu
};
fs.writeFileSync(path.join(__dirname, 'site_budget_audit.json'), JSON.stringify(output, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ status: output.status, liveProduct: output.liveProduct, food: { ...output.food, aboveMaximum: output.food.aboveMaximum.length }, drink: { ...output.drink, aboveMaximum: output.drink.aboveMaximum.length }, reimu }, null, 2));
