// 中间数据 vs 上游 records.ts 的逐字段对账（2026-10-20）。
// 上游=AnYiEE/touhou-mystia-izakaya-assistant（AGPL-3.0），用 gh api 取 raw（避免未认证限流）。
// 输出三类结论：一致 / 范围外（DLC9 等按项目范围主动排除）/ 真差异，并写验证记录。
const fs = require('node:fs');
const path = require('node:path');
const {execSync} = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const mid = path.join(root, '中间数据');
const outDir = path.join(root, '验证记录/2026-10-20--上游数据对账');
const REPO = 'AnYiEE/touhou-mystia-izakaya-assistant';
const REF = 'master';

const JOBS = [
  {local: 'BEVERAGE_LIST.json', upstream: 'beverages/records.ts', fields: ['name', 'price', 'level', 'dlc', 'tags']},
  {local: 'FOOD_LIST.json', upstream: 'foods/records.ts', fields: ['name', 'price', 'level', 'dlc', 'tags']},
  {local: 'INGREDIENT_LIST.json', upstream: 'ingredients/records.ts', fields: ['name', 'price', 'level', 'dlc', 'tags']},
  {local: 'COOKER_LIST.json', upstream: 'cookers/records.ts', fields: ['name', 'price', 'level', 'dlc']},
  {local: 'CLOTHES_LIST.json', upstream: 'clothes/records.ts', fields: ['name', 'price', 'level', 'dlc']},
  {local: 'DECORATION_LIST.json', upstream: 'decorations/records.ts', fields: ['name', 'price', 'level', 'dlc']},
  {local: 'NORMAL_GUEST_LIST.json', upstream: 'guests/normal/records.ts', fields: ['name', 'dlc']},
  {local: 'SPECIAL_GUEST_LIST.json', upstream: 'guests/special/records.ts', fields: ['name', 'dlc']}
];
// 项目范围外的上游内容：DLC9 = MetaMystia 联机 Mod 示例包（README 已声明不包含）。
const OUT_OF_SCOPE_DLC = 9;

function fetchUpstream(relPath) {
  const url = 'repos/' + REPO + '/contents/app/domain/data/' + relPath + '?ref=' + REF;
  return execSync('gh api "' + url + '" -H "Accept: application/vnd.github.raw"', {maxBuffer: 64 * 1024 * 1024}).toString('utf8');
}
// 按大括号深度切出数组里的每个记录块，避免整体 JS→JSON 转换受常量引用影响。
function blocks(src) {
  const start = src.indexOf('[');
  const out = [];
  let depth = 0, buf = '', str = '', esc = false;
  for (let i = start + 1; i < src.length; i += 1) {
    const c = src[i];
    if (esc) { buf += c; esc = false; continue; }
    if (c === '\\' && str) { buf += c; esc = true; continue; }
    if (str) { buf += c; if (c === str) str = ''; continue; }
    if (c === "'" || c === '"' || c === '`') { str = c; buf += c; continue; }
    if (c === '{') depth += 1;
    if (c === '}') { depth -= 1; if (depth === 0) { out.push(buf + c); buf = ''; continue; } }
    if (depth > 0) buf += c;
  }
  return out;
}
const pattern = (key) => new RegExp('(?:^|[{,\\s])' + key + '\\s*:\\s*([\\s\\S]*)');
function fieldOf(block, key) {
  const m = block.match(pattern(key));
  if (!m) return undefined;
  const rest = m[1];
  const str = rest.match(/^'([^']*)'/);
  if (str) return str[1];
  const dq = rest.match(/^"([^"]*)"/);
  if (dq) return dq[1];
  const num = rest.match(/^(-?\d+(?:\.\d+)?)/);
  if (num) return Number(num[1]);
  const arr = rest.match(/^\[([^\]]*)\]/);
  if (arr) return '[' + arr[1].replace(/\s+/g, '') + ']';
  const id = rest.match(/^[A-Za-z_$][\w$.]*/);
  if (id) return {constant: id[0]};
  return undefined;
}
const asText = (value) => (Array.isArray(value) ? '[' + value.join(',') + ']' : String(value));

const report = {checkedAt: new Date().toISOString(), upstream: REPO + '@' + REF, files: [], differences: [], outOfScope: []};
for (const job of JOBS) {
  const localRows = JSON.parse(fs.readFileSync(path.join(mid, job.local), 'utf8'));
  const parsedBlocks = blocks(fetchUpstream(job.upstream)).map((block) => ({block, id: fieldOf(block, 'id')}));
  const upstreamById = new Map();
  for (const item of parsedBlocks) if (typeof item.id === 'number') upstreamById.set(item.id, item.block);
  // 末尾可能跟着不属于数组的嵌套对象（如类型/配置字面量），只按有数字 id 的块计数。
  const upstreamCount = upstreamById.size;
  const localIds = new Set(localRows.map((row) => row.id));
  const entry = {file: job.local, local: localRows.length, upstream: upstreamCount, parsedBlocks: parsedBlocks.length, matched: 0, outOfScope: 0, constantFields: 0, fieldDiffs: []};
  for (const row of localRows) {
    const block = upstreamById.get(row.id);
    if (!block) { entry.fieldDiffs.push({id: row.id, name: row.name, issue: '上游无此 id'}); continue; }
    let ok = true;
    for (const key of job.fields) {
      const upstreamValue = fieldOf(block, key);
      if (upstreamValue === undefined) continue;
      if (upstreamValue && typeof upstreamValue === 'object' && upstreamValue.constant) { entry.constantFields += 1; continue; }
      const localValue = row[key];
      if (localValue === undefined) continue;
      if (asText(upstreamValue) !== asText(localValue)) {
        ok = false;
        entry.fieldDiffs.push({id: row.id, name: row.name, field: key, local: asText(localValue), upstream: asText(upstreamValue)});
      }
    }
    if (ok) entry.matched += 1;
  }
  for (const [id, block] of upstreamById) {
    if (localIds.has(id)) continue;
    const dlc = fieldOf(block, 'dlc');
    const name = fieldOf(block, 'name');
    const item = {file: job.local, id, name: typeof name === 'string' ? name : '(常量名)', dlc};
    if (dlc === OUT_OF_SCOPE_DLC) { entry.outOfScope += 1; report.outOfScope.push(item); }
    else report.differences.push({...item, issue: '上游有、本地无'});
  }
  report.files.push(entry);
}

const failed = report.differences.length > 0 || report.files.some((entry) => entry.fieldDiffs.length > 0);
fs.mkdirSync(outDir, {recursive: true});
fs.writeFileSync(path.join(outDir, '对账结果.json'), JSON.stringify(report, null, 2));

const lines = ['# 中间数据 ↔ 上游 records.ts 对账（' + report.checkedAt.slice(0, 10) + '）', '',
  '上游：' + report.upstream + '（AGPL-3.0），用 gh api 取 raw 文件，按 id 逐字段比对 name/price/level/dlc/tags。', '',
  '| 文件 | 本地 | 上游 | 一致 | 范围外(DLC9) | 字段差异 |', '| --- | --- | --- | --- | --- | --- |'];
for (const entry of report.files) lines.push('| ' + [entry.file, entry.local, entry.upstream, entry.matched, entry.outOfScope, entry.fieldDiffs.length].join(' | ') + ' |');
lines.push('', '恒量字段（上游用常量写值，无法按字面比对）：' + report.files.reduce((sum, entry) => sum + entry.constantFields, 0) + ' 处');
if (report.outOfScope.length) {
  lines.push('', '## 范围外（项目 README 声明不含 DLC9 MetaMystia Mod 内容）');
  for (const item of report.outOfScope) lines.push('- ' + item.file + ' id=' + item.id + ' ' + item.name);
}
if (report.differences.length || report.files.some((entry) => entry.fieldDiffs.length)) {
  lines.push('', '## 真差异');
  for (const item of report.differences) lines.push('- ' + item.file + ' id=' + item.id + ' ' + item.name + '：' + item.issue);
  for (const entry of report.files) for (const diff of entry.fieldDiffs) lines.push('- ' + entry.file + ' id=' + diff.id + ' ' + (diff.name || '') + ' ' + (diff.field || diff.issue) + '：本地 ' + (diff.local ?? '-') + ' / 上游 ' + (diff.upstream ?? '-'));
} else {
  lines.push('', '## 结论', '', '除范围外内容外，本地中间数据与上游逐字段一致。');
}
fs.writeFileSync(path.join(outDir, '对账说明.md'), lines.join('\n') + '\n', 'utf8');

for (const entry of report.files) console.log(entry.file + ': 本地 ' + entry.local + ' / 上游 ' + entry.upstream + ' / 一致 ' + entry.matched + ' / 范围外 ' + entry.outOfScope + ' / 字段差异 ' + entry.fieldDiffs.length);
console.log('范围外条目: ' + report.outOfScope.map((item) => item.name).join('、') || '无');
console.log(failed ? 'FAIL: 存在真差异，详见 验证记录/2026-10-20--上游数据对账/' : 'PASS: 除范围外内容外与上游一致');
process.exit(failed ? 1 : 0);
