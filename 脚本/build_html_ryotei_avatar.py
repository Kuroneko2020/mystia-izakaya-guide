"""构建当前维护的料亭立体头像版；独立输出与入口。

在项目目录运行：py 脚本/build_html_ryotei_avatar.py
数据基线与素材管线沿用料亭版；客人图鉴立体头像效果块由 脚本/guest_avatar_3d.css 原样注入。
本入口不调用 build_html_ryotei.main()，不重写成品/旧版 中的料亭优化版与 3D 试验版。
"""
import hashlib
import json
import re
from pathlib import Path

from build_html import brand_seal_uri, wafu_font_css
from build_html_ryotei import ROOT, SCRIPT, build_assets

BASELINE = ROOT / "中间数据" / "料亭版攻略数据基线.json"
ORIGINAL = ROOT / "成品" / "东方夜雀食堂攻略查询_和风版.html"
OUTPUT = ROOT / "成品" / "东方夜雀食堂攻略查询_料亭立体头像版.html"
AVATAR = SCRIPT / "guest_avatar_3d.css"
REPORT = ROOT / "成品" / "料亭立体头像版_构建校验.json"


def main():
    raw = BASELINE.read_text(encoding="utf-8")
    if ORIGINAL.exists():
        match = re.search(r'<script id="app-data" type="application/json">(.*?)</script>',
                          ORIGINAL.read_text(encoding="utf-8"), re.S)
        if not match:
            raise ValueError("原和风版未包含攻略 JSON，停止构建")
        if match.group(1) != raw:
            raise ValueError("原版数据与料亭版基线不同，停止构建")
    data = json.loads(raw)
    assets, scene = build_assets(data)
    template = (SCRIPT / "guide_template_ryotei.html").read_text(encoding="utf-8")
    css = (SCRIPT / "ryotei.css").read_text(encoding="utf-8")
    ui = (SCRIPT / "ryotei_ui.js").read_text(encoding="utf-8")
    navigation = (SCRIPT / "ryotei_navigation.js").read_text(encoding="utf-8")
    replacements = {
        "__APP_DATA__": raw,
        "__GENERATED_AT__": data["meta"]["generatedAt"],
        "__VERSION__": data["meta"]["version"],
        "__EXCEL_NAME__": data["meta"]["excelName"],
        "__BRAND_SEAL__": brand_seal_uri(),
        "/*__WAFU_FONT__*/": wafu_font_css(),
        "__WAFU_ASSETS__": json.dumps(assets, ensure_ascii=False, separators=(",", ":")),
        "/*__RYOTEI_CSS__*/": css,
        "/*__RYOTEI_UI__*/": ui,
        "/*__RYOTEI_NAVIGATION__*/": navigation,
        "__RYOTEI_SCENE__": scene,
    }
    for key, value in replacements.items():
        template = template.replace(key, value)
    if re.search(r"__(?:APP_DATA|WAFU_ASSETS|RYOTEI_[A-Z]+)__", template):
        raise ValueError("仍有未注入的页面资源，停止构建")
    OUTPUT.write_text(template, encoding="utf-8")
    avatar = AVATAR.read_bytes()
    raw_out = OUTPUT.read_bytes()
    anchor = b"</head>"
    at = raw_out.find(anchor)
    if at < 0:
        raise ValueError("输出缺少 </head> 锚点，停止注入头像效果块")
    if b'<style id="guest-avatar-3d">' in raw_out:
        raise ValueError("输出已含头像效果块，检查是否重复构建")
    OUTPUT.write_bytes(raw_out[:at] + avatar + b"\r\n" + raw_out[at:])
    final = OUTPUT.read_bytes()
    report = {
        "builtAt": "2026-10-09",
        "variant": "料亭立体头像版",
        "method": "独立构建入口 build_html_ryotei_avatar.py：模板+CSS+UI+导航+数据基线整体重建，"
                  "客人图鉴立体头像效果块由 脚本/guest_avatar_3d.css 原样注入 </head> 前；"
                  "不调用 build_html_ryotei.main()，不重写 成品/旧版 中的料亭优化版与 3D 试验版",
        "dataSource": "中间数据/料亭版攻略数据基线.json",
        "appDataSha256": hashlib.sha256(raw.encode("utf-8")).hexdigest(),
        "avatarBlockSha256": hashlib.sha256(avatar).hexdigest(),
        "avatarBlockBytes": len(avatar),
        "outputSha256": hashlib.sha256(final).hexdigest(),
        "outputBytes": len(final),
        "assetCounts": {k: len(v) for k, v in assets.items()},
        "sheetCounts": {k: len(v["rows"]) for k, v in data["sheets"].items()},
        "changes": [
            "配餐参考（料理/酒水/加料）客人选单改为三个分类选项：全部客人 / 稀客/特殊客人 / 普通客人；"
            "料理页含普通客人表前/后期推荐菜拆出的明细行，酒水/加料页选普通客人时给出说明入口",
            "表格首列列分割由生硬切线改为渐变边缘：首列背景与行身同步过渡（transition .16s），"
            "首列右缘 16px 暖色渐变；账目条分栏线同样改为渐变分隔",
        ],
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
