"""构建当前维护的料亭立体头像版；独立输出与入口。

在项目目录运行：py 脚本/build_html_ryotei_avatar.py
数据基线与素材管线沿用料亭版；客人图鉴立体头像效果块由 脚本/guest_avatar_3d.css 原样注入。
本入口不调用 build_html_ryotei.main()，不重写成品/旧版 中的料亭优化版与 3D 试验版。

成品输出不覆盖：新件统一命名为 东方夜雀食堂攻略查询_yymmddHHMM.html（HHMM 为构建时刻），
上一份活成品移入 成品/旧版/ 保留原名。新名与旧版归档名任一已存在即中止，不覆盖任何成品。
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
OUTPUT_DIR = ROOT / "成品"
ARCHIVE_DIR = OUTPUT_DIR / "旧版"
LEGACY_OUTPUT = OUTPUT_DIR / "东方夜雀食堂攻略查询_料亭立体头像版.html"
STAMPED_NAME = re.compile(r"^东方夜雀食堂攻略查询_\d{10}\.html$")
AVATAR = SCRIPT / "guest_avatar_3d.css"
REPORT = OUTPUT_DIR / "料亭立体头像版_构建校验.json"


def live_output():
    """当前活成品：构建报告 outputFile 优先，其次 yymmddHHMM 命名最新件，再次旧固定名。"""
    if REPORT.exists():
        name = json.loads(REPORT.read_text(encoding="utf-8")).get("outputFile")
        if name and (OUTPUT_DIR / name).exists():
            return OUTPUT_DIR / name
    stamped = sorted(p for p in OUTPUT_DIR.iterdir() if STAMPED_NAME.match(p.name))
    if stamped:
        return stamped[-1]
    return LEGACY_OUTPUT if LEGACY_OUTPUT.exists() else None


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
    # 版本化输出：新件按构建时刻命名，旧活成品移入 旧版/，任何同名冲突都不覆盖。
    built = datetime.now(timezone(timedelta(hours=8)))
    new_name = "东方夜雀食堂攻略查询_" + built.strftime("%y%m%d%H%M") + ".html"
    new_path = OUTPUT_DIR / new_name
    current = live_output()
    if new_path.exists() or (ARCHIVE_DIR / new_name).exists():
        raise ValueError(f"同一分钟内已产出 {new_name}，停止：不覆盖成品或旧版同名文件")
    if current and (ARCHIVE_DIR / current.name).exists():
        raise ValueError(f"旧版/ 中已有 {current.name}，停止：不覆盖旧版文件")
    new_path.write_bytes(final)
    archived = None
    if current and current.resolve() != new_path.resolve():
        ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
        current.replace(ARCHIVE_DIR / current.name)
        archived = current.name
    report = {
        "builtAt": built.date().isoformat(),
        "builtAtFull": built.strftime("%Y-%m-%d %H:%M %z"),
        "variant": "料亭立体头像版",
        "method": "独立构建入口 build_html_ryotei_avatar.py：模板+CSS+UI+导航+数据基线整体重建，"
                  "客人图鉴立体头像效果块由 脚本/guest_avatar_3d.css 原样注入 </head> 前；"
                  "不调用 build_html_ryotei.main()，不重写 成品/旧版 中的料亭优化版与 3D 试验版",
        "namingPolicy": "成品不覆盖：新件 东方夜雀食堂攻略查询_yymmddHHMM.html，上一份活成品移入 成品/旧版/ 保留原名",
        "outputFile": new_name,
        "archivedPrevious": archived,
        "dataSource": "中间数据/料亭版攻略数据基线.json",
        "appDataSha256": hashlib.sha256(raw.encode("utf-8")).hexdigest(),
        "avatarBlockSha256": hashlib.sha256(avatar).hexdigest(),
        "avatarBlockBytes": len(avatar),
        "outputSha256": hashlib.sha256(final).hexdigest(),
        "outputBytes": len(final),
        "assetCounts": {k: len(v) for k, v in assets.items()},
        "sheetCounts": {k: len(v["rows"]) for k, v in data["sheets"].items()},
        "changes": [
            "客人详情重做：口味与来访常驻头部，章节改页签（推荐料理默认/推荐酒水/加料/羁绊与来源），消灭长滚动与嵌套滚动",
            "详情列表自带筛选：搜索、标签 chips（AND）、排序下拉（价格/命中/等级），换人清过滤、排序偏好保留",
            "全站移除版本展示与筛选：五个版本下拉、全部表格版本列、卡片与详情的“本篇/DLC”字样（数据字段保留）",
            "移除无信息量的“加料建议”列与行展开死代码；备菜大表与详情表同步精简",
            "顶栏两个主入口：营业图鉴（人物卡片+备菜表页）与物品图鉴；hash 页签名不变，旧地址天然兼容",
            "详情反馈轮：表头粘顶、列宽重分配去空白、竖排名字水印随列表滚动叠于行上、面板弹出与主题切换缓入缓出",
            "主题切换恢复圆形扩散（View Transitions，从按钮位置展开），黑白交接边缘带同步金色羽化光环",
            "详情列表排序改列头点击（新列默认降序、同列切换升降，默认价格从高到低），排序下拉移除，酒水补命中数列",
            "详情面板缩窄至 960 并重排列宽；表头改 separate 边框修复粘顶失效，滚动零泄露",
            "客人图鉴按今晚开店地点联动；因幡帝纳入所有地区；料理和酒水按全部静态标签匹配，不限数量价格",
        ],
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
