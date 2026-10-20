from pathlib import Path
import hashlib
import json
import re
import subprocess
from datetime import datetime

root = Path(__file__).resolve().parents[3]
evidence = Path(__file__).resolve().parent
before = json.loads((evidence / 'input_snapshot.json').read_text(encoding='utf-8'))
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
changes = []
protected_errors = []
archive_checks = []
protected_count = 0
for name, record in before['files'].items():
    path = root / name
    if name.startswith('中间数据/') or name.endswith('.xlsx') or name == '脚本/guest_avatar_3d.css':
        protected_count += 1
        if not path.is_file() or sha(path) != record['sha256']:
            protected_errors.append(name)
    elif name.startswith('成品/') and path.suffix == '.html':
        candidate = path if path.exists() else root / '成品' / '旧版' / path.name
        same = candidate.is_file() and sha(candidate) == record['sha256']
        archive_checks.append({'original': name, 'current': candidate.relative_to(root).as_posix(), 'sameBytes': same})
        if not same:
            protected_errors.append(name)
    if not path.exists():
        changes.append({'file': name, 'change': 'archived' if name.startswith('成品/') and (root / '成品' / '旧版' / path.name).exists() else 'missing'})
    elif sha(path) != record['sha256']:
        changes.append({'file': name, 'change': 'modified'})

current_files = {path.relative_to(root).as_posix() for folder in ['脚本', '中间数据', '成品'] for path in (root / folder).rglob('*') if path.is_file() and '__pycache__' not in path.parts}
added = sorted(current_files - set(before['files']))
report_path = root / '成品' / '料亭立体头像版_构建校验.json'
report = json.loads(report_path.read_text(encoding='utf-8'))
live = root / '成品' / report['outputFile']
html = live.read_text(encoding='utf-8')
app_match = re.search(r'<script id="app-data" type="application/json">(.*?)</script>', html, re.S)
baseline = (root / '中间数据' / '料亭版攻略数据基线.json').read_text(encoding='utf-8')
assert app_match and app_match.group(1) == baseline
assert sha(live) == report['outputSha256']
css = (root / '脚本' / 'ryotei.css').read_text(encoding='utf-8')
patches = json.loads((root / '验证记录' / '2026-10-14--卡片待机闪烁修复' / '隔离构建校验.json').read_text(encoding='utf-8'))['patches']
for patch in patches:
    assert patch['old'] in css and patch['old'] in html
    assert patch['new'].replace('\r\n', '\n') not in css
    assert patch['new'].replace('\r\n', '\n') not in html
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
result = {
    'checkedAt': datetime.now().astimezone().isoformat(),
    'status': 'PASS' if not protected_errors and head == before['head'] else 'FAIL',
    'liveProduct': report['outputFile'],
    'liveProductSha256': sha(live),
    'protectedInputCount': protected_count,
    'protectedInputErrors': protected_errors,
    'archivedProductChecks': archive_checks,
    'appDataUnchanged': True,
    'avatarBlockSha256': report['avatarBlockSha256'],
    'mistakenCardCssRestoredInSourceAndProduct': True,
    'changedSourceFiles': changes,
    'addedFilesInProductionFolders': added,
    'headBefore': before['head'],
    'headAfter': head,
    'note': 'Existing changes are retained. Historical false card-fix tools/artifacts are not task requirements and are kept only for tracing; no reset/clean/delete/commit/push. New meal data is separate from protected original inputs.'
}
stamp = datetime.now().strftime('%H%M%S')
with (evidence / f'final_integrity_{stamp}.json').open('x', encoding='utf-8') as handle:
    json.dump(result, handle, ensure_ascii=False, indent=2)
result['report'] = f'final_integrity_{stamp}.json'
print(json.dumps({key: result[key] for key in ['status', 'liveProduct', 'liveProductSha256', 'protectedInputCount', 'protectedInputErrors', 'appDataUnchanged', 'mistakenCardCssRestoredInSourceAndProduct', 'headAfter', 'report']}, ensure_ascii=False, indent=2))
assert result['status'] == 'PASS'
