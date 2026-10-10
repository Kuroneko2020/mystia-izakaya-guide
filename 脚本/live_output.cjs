// 活成品定位：构建报告 outputFile 优先，其次 yymmddHHMM 命名最新件，再次旧固定名。
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, '成品');
const archiveDir = path.join(outDir, '旧版');
function liveOutput(){
  const reportPath = path.join(outDir, '料亭立体头像版_构建校验.json');
  if (fs.existsSync(reportPath)) {
    const name = JSON.parse(fs.readFileSync(reportPath, 'utf8')).outputFile;
    if (name && fs.existsSync(path.join(outDir, name))) return path.join(outDir, name);
  }
  const stamped = fs.readdirSync(outDir).filter(n => /^东方夜雀食堂攻略查询_\d{10}\.html$/.test(n)).sort();
  if (stamped.length) return path.join(outDir, stamped[stamped.length - 1]);
  return path.join(outDir, '东方夜雀食堂攻略查询_料亭立体头像版.html');
}
module.exports = {root, outDir, archiveDir, liveOutput};
