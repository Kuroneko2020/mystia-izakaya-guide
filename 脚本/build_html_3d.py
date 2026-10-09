"""从固定的成功料亭成品构建独立 3D 试验；只注入 CSS 和非交互装饰。"""
import base64
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent
ROOT = SCRIPT.parent
SOURCE = ROOT / "成品" / "东方夜雀食堂攻略查询_料亭优化版.html"
OUTPUT = ROOT / "成品" / "东方夜雀食堂攻略查询_3D拟物试验版.html"
SOURCE_SHA = "01d36ce39add10e28982e16d793d1630c66e6adbc01d77d94d76d9c3c3edc65b"
SNAPSHOT = ROOT / "制作材料" / "3D拟物试验输入" / ("料亭优化版_" + SOURCE_SHA[:12] + ".html")
SCENE = SCRIPT / "ryotei_assets" / "night-stall.webp"
SCENE_MIME = "image/webp"


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError("输入结构改变，停止构建：" + old[:60])
    return text.replace(old, new, 1)


def main():
    raw = SOURCE.read_bytes()
    if digest(raw) != SOURCE_SHA:
        raise ValueError("成功版与本次固定输入不同，须先核对新版；不会自动覆盖或重新构建成功版")
    protected_paths = [SOURCE, SCRIPT / "build_html_ryotei.py", SCRIPT / "guide_template_ryotei.html",
                       SCRIPT / "ryotei.css", SCRIPT / "ryotei_ui.js", SCRIPT / "ryotei_navigation.js",
                       SCRIPT / "verify_ryotei.cjs", SCRIPT / "guide_template_wafu.html",
                       ROOT / "中间数据" / "料亭版攻略数据基线.json"]
    protected_paths += list((ROOT / "成品").glob("*.xlsx"))
    protected = {p.relative_to(ROOT).as_posix(): digest(p.read_bytes()) for p in protected_paths}
    SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
    if not SNAPSHOT.exists():
        with SNAPSHOT.open("xb") as stream:
            stream.write(raw)
    if digest(SNAPSHOT.read_bytes()) != SOURCE_SHA:
        raise ValueError("保存的成功输入快照不一致，停止构建")

    page = raw.decode("utf-8")
    assets_match = re.search(r"window\.WAFU_ASSETS = (\{[^\n]+\});", page)
    if not assets_match:
        raise ValueError("无法找到原有游戏素材")
    assets = json.loads(assets_match.group(1))
    scene_bytes = SCENE.read_bytes()
    scene_uri = "data:" + SCENE_MIME + ";base64," + base64.b64encode(scene_bytes).decode("ascii")
    css_path = SCRIPT / "izakaya_night_market.css"
    css = css_path.read_text(encoding="utf-8")
    page = replace_once(page, "</head>", '<style id="izakaya-3d-skin">\n' + css + '\n</style>\n</head>')
    page = replace_once(page, "<body>", '<body data-skin="3d-night-market">')
    hero = ('<section class="ryotei-hero night-market" aria-labelledby="hero-title">'
            '<div class="hero-scene" aria-hidden="true"><img class="market-scene-image" src="' + scene_uri + '" alt="" decoding="async"></div><div class="hero-lantern" aria-hidden="true"></div>'
            '<div class="hero-copy"><p class="hero-eyebrow">幻想乡 · 今夜开张</p>'
            '<h2 id="hero-title">夜雀食堂<br><em>备菜手帖</em></h2>'
            '<div class="hero-actions"><button class="hero-action" type="button" data-jump="guests">客人名簿 <span aria-hidden="true">↗</span></button>'
            '<button class="hero-action secondary" type="button" data-jump="catalog">料理目录 <span aria-hidden="true">→</span></button></div></div>'
            '<span class="market-open" aria-hidden="true">夜间营业</span></section>')
    hero_match = re.search(r'<section class="ryotei-hero".*?</section>', page, re.S)
    if not hero_match:
        raise ValueError("无法找到原封面区")
    page = replace_once(page, hero_match.group(0), hero)
    still_life = '<div class="market-still-life" aria-hidden="true"><span class="market-tray"></span>'
    for index, name in enumerate(("饭团", "绿茶", "蘑菇")):
        still_life += '<img class="market-prop prop-' + str(index) + '" src="' + assets["icons"][name] + '" alt="">'
    still_life += '</div>'
    page = replace_once(page, '<div class="ryotei-workbench" id="ryotei-workbench">',
                        '<div class="ryotei-workbench" id="ryotei-workbench">' + still_life)
    page = replace_once(page, 'MYSTIA’S IZAKAYA · <a', '<span class="skeuo-edition">3D 试作</span> MYSTIA’S IZAKAYA · <a')
    page = replace_once(page, '料亭优化版 · 美术：游戏像素贴图（夜雀助手整理）、官方 Steam 宣传夜景',
                        '3D夜摊试验版 · 美术：游戏像素贴图（夜雀助手整理）、官方 Steam 宣传夜景')
    page = re.sub(r"<title>.*?</title>", '<title>夜雀食堂 · 夜摊备菜手帖 · 3D拟物试验版</title>', page, count=1)
    # 字节保留业务代码：新增装饰不会引入脚本或改变已有 script 标签。
    original_scripts = re.findall(r"<script\b[^>]*>.*?</script>", raw.decode("utf-8"), re.S)
    if re.findall(r"<script\b[^>]*>.*?</script>", page, re.S) != original_scripts:
        raise ValueError("原业务脚本出现变化，停止写出")
    for name, sha in protected.items():
        if digest((ROOT / name).read_bytes()) != sha:
            raise RuntimeError("构建期间受保护输入发生变化：" + name)
    OUTPUT.write_bytes(page.encode("utf-8"))
    report = {"builtAt": datetime.now(timezone.utc).isoformat(), "sourceSha256": SOURCE_SHA,
              "sourceSnapshot": SNAPSHOT.relative_to(ROOT).as_posix(), "protectedFiles": protected,
              "outputSha256": digest(OUTPUT.read_bytes()), "outputBytes": OUTPUT.stat().st_size,
              "cssSource": css_path.relative_to(ROOT).as_posix(),
              "cssSha256": digest(css.encode("utf-8")), "newRuntimeScripts": 0,
              "assetCounts": {key: len(value) for key, value in assets.items()},
              "scene": SCENE.relative_to(ROOT).as_posix(), "sceneMime": SCENE_MIME,
              "sceneSha256": digest(scene_bytes),
              "assetSource": "游戏头像与物品原贴图逐字保留；背景为原有官方 Steam 宣传画面；不使用生成图"}
    (ROOT / "成品" / "3D拟物试验版_构建校验.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "protectedFiles"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
