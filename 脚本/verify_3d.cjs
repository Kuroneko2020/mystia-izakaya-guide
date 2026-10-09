// 3D 试验只增加样式和装饰；业务脚本必须与成功输入逐字相同。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const successName = '成品/东方夜雀食堂攻略查询_料亭优化版.html';
const trialName = '成品/东方夜雀食堂攻略查询_3D拟物试验版.html';
const expectedSource = '01d36ce39add10e28982e16d793d1630c66e6adbc01d77d94d76d9c3c3edc65b';
const success = read(successName);
assert.equal(digest(fs.readFileSync(path.join(root, successName))), expectedSource, '成功版本不可变化');
const trial = read(trialName);
const scripts = html => Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g), m => m[0]);
assert.deepEqual(scripts(trial), scripts(success), '数据、资源和业务脚本必须逐字一致');
assert.ok(trial.includes('<style id="izakaya-3d-skin">'));
assert.ok(trial.includes('data-skin="3d-night-market"'));
assert.ok(!/<(?:script|img|link)\b[^>]*(?:src|href)="https?:/i.test(trial), '必须离线可用');
const report = JSON.parse(read('成品/3D拟物试验版_构建校验.json'));
assert.equal(digest(fs.readFileSync(path.join(root, trialName))), report.outputSha256);
const css = read(report.cssSource);
assert.equal(digest(css), report.cssSha256, 'CSS 变更后必须重新构建');
const scene = fs.readFileSync(path.join(root, report.scene));
assert.equal(digest(scene), report.sceneSha256, '场景素材必须和构建来源一致');
assert.equal(trial.match(/<style id="izakaya-3d-skin">\n([\s\S]*?)\n<\/style>/)[1],
  css, '内嵌皮肤必须和源 CSS 一致');
assert.equal(trial.match(/<img class="market-scene-image" src="([^"]+)"/)[1],
  'data:' + report.sceneMime + ';base64,' + scene.toString('base64'), '内嵌场景必须和素材来源一致');
assert.equal(report.scene, '脚本/ryotei_assets/night-stall.webp', '只使用已有官方游戏背景');
for (const [name, sha] of Object.entries(report.protectedFiles)) {
  assert.equal(digest(fs.readFileSync(path.join(root, name))), sha, '受保护文件不可改动：' + name);
}
assert.equal(digest(fs.readFileSync(path.join(root, report.sourceSnapshot))), expectedSource);
// 让现有回归检查读新成品，原检查脚本保持不变。
const inherited = read('脚本/verify_ryotei.cjs');
const oldLine = "const output = read('成品/东方夜雀食堂攻略查询_料亭优化版.html');";
assert.equal(inherited.split(oldLine).length, 2, '回归入口改变时需先核对');
vm.runInNewContext(inherited.replace(oldLine, 'const output = read(' + JSON.stringify(trialName) + ');'),
  {require, __dirname, console, URLSearchParams}, {filename: 'verify_ryotei_for_3d.cjs'});
console.log('PASS: 3D 独立构建、成功版保护、输入快照、业务脚本逐字一致、离线资源与继承回归');
