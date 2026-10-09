"""构建独立的料亭优化版；只读取原和风版，不调用原版构建入口。

在项目目录运行：py 脚本/build_html_ryotei.py
攻略 JSON 逐字复用原和风版，游戏贴图通过现有夜雀助手的 ID/名称映射。
"""
import base64
import hashlib
import json
import re
from pathlib import Path

from PIL import Image

from build_html import brand_seal_uri, wafu_font_css

SCRIPT = Path(__file__).resolve().parent
ROOT = SCRIPT.parent
ORIGINAL = ROOT / "成品" / "东方夜雀食堂攻略查询_和风版.html"
OUTPUT = ROOT / "成品" / "东方夜雀食堂攻略查询_料亭优化版.html"
ASSETS = SCRIPT / "ryotei_assets"
REPO = ROOT / "原始资料" / "repos" / "touhou-mystia-izakaya-assistant"
SPRITES = REPO / "scripts" / "assets" / "sprites" / "input"
OFFICIAL = ROOT / "原始资料" / "料亭版官方素材"


def uri(path):
    return "data:image/webp;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def build_assets(data):
    ASSETS.mkdir(exist_ok=True)
    assets = {"avatars": {}, "icons": {}, "normal": {}}
    manifest = []
    groups = [
        ("guests", "SPECIAL_GUEST_LIST", "special_guests", "客人名字", "avatars"),
        ("recipes", "FOOD_LIST", "foods", "菜品", "icons"),
        ("ingredients", "INGREDIENT_LIST", "ingredients", "食材", "icons"),
        ("beverages", "BEVERAGE_LIST", "beverages", "酒水", "icons"),
        ("normal", "NORMAL_GUEST_LIST", "normal_guests", "普通客人", "normal"),
    ]
    for sheet_key, record_name, category, name_key, kind in groups:
        records = json.loads((ROOT / "中间数据" / (record_name + ".json")).read_text(encoding="utf-8"))
        lookup = {r["name"]: r["id"] for r in records if r.get("dlc") != 9}
        sheet = data["sheets"][sheet_key]
        col = sheet["headers"].index(name_key)
        dest = ASSETS / kind
        dest.mkdir(exist_ok=True)
        for row in sheet["rows"]:
            name = row[col]
            sprite_id = lookup[name]
            filename = str(sprite_id) if sprite_id < 0 or sprite_id >= 9000 else f"{sprite_id:04d}"
            source = SPRITES / category / (filename + ".png")
            target = dest / (name + ".webp")
            with Image.open(source) as im:
                im.convert("RGBA").save(target, "WEBP", lossless=True, method=6)
            assets[kind][name] = uri(target)
            manifest.append({"name": name, "kind": kind, "source": source.relative_to(ROOT).as_posix(),
                             "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                             "output": target.relative_to(ROOT).as_posix()})
    scene = ASSETS / "night-stall.webp"
    with Image.open(OFFICIAL / "store-background.jpg") as im:
        im.convert("RGB").save(scene, "WEBP", quality=90, method=6)
    (ASSETS / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return assets, uri(scene)


def main():
    before = ORIGINAL.read_bytes()
    original_hash = hashlib.sha256(before).hexdigest()
    match = re.search(r'<script id="app-data" type="application/json">(.*?)</script>', before.decode("utf-8"), re.S)
    if not match:
        raise ValueError("原和风版未包含攻略 JSON，停止构建")
    raw = match.group(1)
    data = json.loads(raw)
    assets, scene = build_assets(data)
    template = (SCRIPT / "guide_template_ryotei.html").read_text(encoding="utf-8")
    css = (SCRIPT / "ryotei.css").read_text(encoding="utf-8")
    ui = (SCRIPT / "ryotei_ui.js").read_text(encoding="utf-8")
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
        "__RYOTEI_SCENE__": scene,
    }
    for key, value in replacements.items():
        template = template.replace(key, value)
    if re.search(r"__(?:APP_DATA|WAFU_ASSETS|RYOTEI_[A-Z]+)__", template):
        raise ValueError("仍有未注入的页面资源，停止构建")
    OUTPUT.write_text(template, encoding="utf-8")
    if ORIGINAL.read_bytes() != before:
        raise RuntimeError("原版文件在构建期间变化，请检查其他写入者")
    report = {"builtAt": "2026-10-06", "originalSha256": original_hash,
              "outputSha256": hashlib.sha256(OUTPUT.read_bytes()).hexdigest(),
              "outputBytes": OUTPUT.stat().st_size,
              "assetCounts": {k: len(v) for k, v in assets.items()},
              "sheetCounts": {k: len(v["rows"]) for k, v in data["sheets"].items()}}
    (ROOT / "成品" / "料亭优化版_构建校验.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
