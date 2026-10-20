# -*- coding: utf-8 -*-
"""把修正版工作簿同步为料亭版攻略数据基线（站点数据源）。

用法：py 脚本/sync_site_baseline.py <工作簿.xlsx>

- 复用 build_html.read_sheets / build_char_pinyin 的装载口径，保证与 Excel 成品同源。
- 输出 中间数据/料亭版攻略数据基线.json；原基线先备份到 验证记录 对应目录再替换（带 sha256）。
- 原始工作簿 东方夜雀食堂_客人攻略查询表_v4.4.0_2026-10-04.xlsx 永远不作为写入目标。
"""
import argparse
import hashlib
import json
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

from build_html import build_char_pinyin, read_sheets

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / "中间数据" / "料亭版攻略数据基线.json"
EVIDENCE = ROOT / "验证记录" / "2026-10-14--数据修正自动重算"


def sha256_of(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser(description="同步料亭版攻略数据基线")
    ap.add_argument("workbook", help="修正版工作簿路径")
    args = ap.parse_args()
    workbook = Path(args.workbook).resolve()
    if not workbook.exists():
        raise SystemExit(f"工作簿不存在：{workbook}")
    if workbook.name == "东方夜雀食堂_客人攻略查询表_v4.4.0_2026-10-04.xlsx":
        raise SystemExit("拒绝把原始工作簿当同步源之外的写入目标语义：请传修正版工作簿")

    sheets = read_sheets(workbook)
    old_meta = {}
    if BASELINE.exists():
        old_meta = json.loads(BASELINE.read_text(encoding="utf-8")).get("meta", {})
    payload = {
        "meta": {
            "generatedAt": datetime.now(timezone(timedelta(hours=8))).date().isoformat(),
            "version": old_meta.get("version", "v4.4.0"),
            "excelName": workbook.name,
            "sheetNames": list(sheets.keys()),
        },
        "charPinyin": build_char_pinyin(sheets),
        "sheets": sheets,
    }
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    EVIDENCE.mkdir(parents=True, exist_ok=True)
    backed_up = None
    if BASELINE.exists():
        backup = EVIDENCE / f"料亭版攻略数据基线_替换前_{datetime.now().strftime('%H%M%S')}.json"
        shutil.copy2(BASELINE, backup)
        backed_up = {"path": str(backup.relative_to(ROOT)).replace("\\", "/"),
                     "sha256": sha256_of(backup)}
    BASELINE.write_text(raw, encoding="utf-8")
    report = {
        "workbook": str(workbook.relative_to(ROOT)).replace("\\", "/"),
        "workbookSha256": sha256_of(workbook),
        "baseline": str(BASELINE.relative_to(ROOT)).replace("\\", "/"),
        "baselineSha256": sha256_of(BASELINE),
        "replacedBaseline": backed_up,
        "sheetCounts": {k: len(v["rows"]) for k, v in sheets.items()},
    }
    out = EVIDENCE / "基线同步报告.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
