// 卡片待机绘制回归：仅四处 CSS 改动，数据、脚本和立体头像块保持原样。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { liveOutput } = require('./live_output.cjs');
const root = path.resolve(__dirname, '..');
const evidence = path.join(root, '验证记录/2026-10-14--卡片待机闪烁修复');
const build = JSON.parse(fs.readFileSync(path.join(evidence, '隔离构建校验.json'), 'utf8'));
const currentPath = liveOutput();
const isolatedPath = path.join(root, build.outputFile);
const outputPath = fs.existsSync(isolatedPath) ? isolatedPath
  : path.join(root, '成品/旧版', path.basename(isolatedPath));
const output = fs.readFileSync(outputPath, 'utf8');
const current = fs.readFileSync(currentPath, 'utf8');
const source = fs.readFileSync(path.join(root, build.inputFile), 'utf8');
const css = fs.readFileSync(path.join(root, '脚本/ryotei.css'), 'utf8');
assert.equal(path.basename(outputPath), path.basename(build.outputFile));
assert.ok(current.includes('.guest-card{content-visibility:visible;contain-intrinsic-size:none}'), '当前活成品仍继承卡片稳定绘制');
assert.ok(current.includes('.guest-card::before{content:none}'), '当前活成品仍移除独立顶线');
assert.ok(css.includes('.guest-card{content-visibility:visible;contain-intrinsic-size:none}'));
assert.ok(output.includes('.guest-card{content-visibility:visible;contain-intrinsic-size:none}'));
assert.ok(!output.includes('.guest-card{content-visibility:auto;contain-intrinsic-size:auto 330px}'));
assert.ok(output.includes('.guest-card::before{content:none}'));
assert.ok(output.includes('box-shadow:inset 0 1px 0 #fff9ea,0 3px 0 #d0b79344'));
assert.ok(output.includes('box-shadow:inset 0 1px 0 #fff9ea,0 3px 0 #b79a7244'));
let reverted = output;
for (const patch of [...build.patches].reverse()) {
  assert.equal(reverted.split(patch.new).length - 1, 1);
  reverted = reverted.replace(patch.new, patch.old);
}
assert.equal(reverted, source, '逆向应用四处 CSS 后逐字节一致，不混入并发配餐功能');
const data = html => html.match(/<script id="app-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
assert.equal(data(output), data(source), '数据不变');
const avatar = html => html.match(/<style id="guest-avatar-3d">[\s\S]*?<\/style>/)[0];
assert.equal(avatar(output), avatar(source), '原头像效果块不变');
const scripts = html => [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(match => !match[1].includes('application/json')).map(match => match[2]);
assert.deepEqual(scripts(output), scripts(source), '业务和交互脚本不变');
for (const script of scripts(output)) new vm.Script(script);
const report = { status: 'PASS', outputFile: path.basename(outputPath), currentOutputFile: path.basename(currentPath),
  currentInheritsCardFix: true, cssPatchCount: 4,
  inverseByteEquality: true, appDataUnchanged: true, avatarUnchanged: true, scriptsUnchanged: true };
fs.writeFileSync(path.join(evidence, '静态回归结果.json'), JSON.stringify(report, null, 2));
console.log('PASS: 卡片稳定绘制样式、四处 CSS 隔离、原数据、立体头像及业务脚本保持不变。');
