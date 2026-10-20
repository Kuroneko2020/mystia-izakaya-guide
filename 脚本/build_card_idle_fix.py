"""只发布卡片待机绘制修复，不混入工作区内其他尚未构建的功能改动。"""
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from build_html_ryotei_avatar import ARCHIVE_DIR, OUTPUT_DIR, REPORT, ROOT, live_output

EVIDENCE = ROOT / "验证记录" / "2026-10-14--卡片待机闪烁修复"
PATCHES = [
    (
        "gap:15px;box-shadow:0 3px 0 #d0b79344,0 7px 20px #58401f08;",
        "gap:15px;box-shadow:inset 0 1px 0 #fff9ea,0 3px 0 #d0b79344,0 7px 20px #58401f08;",
    ),
    (
        '.guest-card::before{content:"";position:absolute;top:0;left:16px;right:16px;height:1px;background:#fff9ea}',
        '.guest-card::before{content:none}',
    ),
    (
        "border-color:#b28a5d;box-shadow:0 3px 0 #b79a7244,0 10px 22px #62462d16,0 0 18px #dda55f22}",
        "border-color:#b28a5d;box-shadow:inset 0 1px 0 #fff9ea,0 3px 0 #b79a7244,0 10px 22px #62462d16,0 0 18px #dda55f22}",
    ),
    (
        '.guest-card{content-visibility:auto;contain-intrinsic-size:auto 330px}',
        '/* 图鉴卡片保留溢出的立体头像，不使用会引入 paint containment 的按需绘制。 */\n'
        '.guest-card{content-visibility:visible;contain-intrinsic-size:none}',
    ),
]


def main():
    before = json.loads((EVIDENCE / "改动前保护核验.json").read_text(encoding="utf-8"))
    current = live_output()
    if not current or current.name != before["liveOutput"]:
        raise ValueError("活成品已被其他构建更新，停止：不能把修复套到未知输入")
    source = current.read_bytes()
    input_sha = hashlib.sha256(source).hexdigest()
    if input_sha != before["files"]["成品/" + current.name]:
        raise ValueError("修复输入哈希不符，停止")
    css = (ROOT / "脚本" / "ryotei.css").read_text(encoding="utf-8")
    html = source.decode("utf-8")
    line_ending = "\r\n" if "\r\n" in html else "\n"
    applied = []
    for old, new in PATCHES:
        if new not in css:
            raise ValueError("生产 CSS 尚未包含修复，停止")
        old = old.replace("\n", line_ending)
        new = new.replace("\n", line_ending)
        if html.count(old) != 1:
            raise ValueError("待替换的卡片样式非唯一，停止")
        html = html.replace(old, new)
        applied.append({"old": old, "new": new})
    final = html.encode("utf-8")
    reverted = final.decode("utf-8")
    for patch in reversed(applied):
        reverted = reverted.replace(patch["new"], patch["old"])
    if reverted.encode("utf-8") != source:
        raise ValueError("隔离校验失败：存在卡片 CSS 之外的改动")
    built = datetime.now(timezone(timedelta(hours=8)))
    name = "东方夜雀食堂攻略查询_" + built.strftime("%y%m%d%H%M") + ".html"
    output = OUTPUT_DIR / name
    archived = ARCHIVE_DIR / current.name
    if output.exists() or (ARCHIVE_DIR / name).exists() or archived.exists():
        raise ValueError("新成品或归档同名冲突，停止：不覆盖任何成品")
    report = json.loads(REPORT.read_text(encoding="utf-8"))
    report.update({
        "builtAt": built.date().isoformat(),
        "builtAtFull": built.strftime("%Y-%m-%d %H:%M %z"),
        "method": "build_card_idle_fix.py 从已验证活成品隔离更新四处卡片 CSS；生产 ryotei.css 已同步。"
                  "逆向应用四处改动后逐字节等于输入，未混入并发配餐功能修改。",
        "outputFile": name,
        "archivedPrevious": current.name,
        "outputSha256": hashlib.sha256(final).hexdigest(),
        "outputBytes": len(final),
        "inputSha256": input_sha,
        "cardCssSha256": hashlib.sha256((ROOT / "脚本" / "ryotei.css").read_bytes()).hexdigest(),
    })
    report["changes"].append("卡片待机绘制加固：取消 content-visibility:auto，顶部亮线改静态内描边；立体头像与悬停反馈保留")
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    output.write_bytes(final)
    current.replace(archived)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (EVIDENCE / "隔离构建校验.json").write_text(json.dumps({
        "inputFile": archived.relative_to(ROOT).as_posix(),
        "outputFile": output.relative_to(ROOT).as_posix(),
        "patchCount": len(applied),
        "inverseByteEquality": True,
        "inputSha256": input_sha,
        "outputSha256": report["outputSha256"],
        "unchangedAppDataSha256": report["appDataSha256"],
        "unchangedAvatarSha256": report["avatarBlockSha256"],
        "patches": applied,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
