"""构建当前维护的料亭立体头像版；独立输出与入口。

在项目目录运行：py 脚本/build_html_ryotei_avatar.py
数据基线与素材管线沿用料亭版；客人图鉴立体头像效果块由 脚本/guest_avatar_3d.css 原样注入。
本入口不调用 build_html_ryotei.main()，不重写成品/旧版 中的料亭优化版与 3D 试验版。
"""
import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from build_html import brand_seal_uri, wafu_font_css
from build_html_ryotei import ROOT, SCRIPT, ASSETS, uri

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
    # 界面构建只读取已纳入 Git 的素材，不重新转换或覆盖素材，也无需上游仓库。
    assets = {"avatars": {}, "icons": {}, "normal": {}}
    for sheet, name_key, kind in [("guests", "客人名字", "avatars"), ("normal", "普通客人", "normal"),
                                  ("recipes", "菜品", "icons"), ("ingredients", "食材", "icons"),
                                  ("beverages", "酒水", "icons")]:
        column = data["sheets"][sheet]["headers"].index(name_key)
        for row in data["sheets"][sheet]["rows"]:
            name = row[column]
            assets[kind][name] = uri(ASSETS / kind / (name + ".webp"))
    scene = uri(ASSETS / "night-stall.webp")
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
    avatar = AVATAR.read_bytes()
    raw_out = template.replace("\n", "\r\n").encode("utf-8")
    anchor = b"</head>"
    at = raw_out.find(anchor)
    if at < 0:
        raise ValueError("输出缺少 </head> 锚点，停止注入头像效果块")
    if b'<style id="guest-avatar-3d">' in raw_out:
        raise ValueError("输出已含头像效果块，检查是否重复构建")
    final = raw_out[:at] + avatar + b"\r\n" + raw_out[at:]
    OUTPUT.write_bytes(final)
    report = {
        "builtAt": datetime.now(timezone(timedelta(hours=8))).date().isoformat(),
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
            "全部地点：全部/普通/特殊置顶，保留106位具体客人；特定地点：展开头像名单并就地筛选配餐",
            "料理页直接拆出原表普通客人的282条推荐，不新增评分或推荐算法；酒水/加料未收录时显示原表边界和喜好",
            "压缩页头与筛选区，移除站内返回条；放大标签并显示当前数据全部标签",
            "按页面与查询状态复用已渲染内容，隐藏页按需渲染；指示条同帧合并并先读后写，避免强制重复布局",
        ],
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
