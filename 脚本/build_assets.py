# -*- coding: utf-8 -*-
"""生成和风版 HTML 所需的美术素材（头像 + 物品图标）。

来源（均为本机已有的合法素材）：
1. 头像：游戏自带的官方粉丝素材包
   F:/Games/GamePlats/Steam/steamapps/common/Touhou Mystia Izakaya/东方夜雀食堂 头像&表情包 ~ Avatar Image
   文件夹/编号 -> 客人 的映射由人工识图确认（见 记录/2026-10-05--和风版界面记录.md），
   官方包未覆盖的客人不匹配，运行时回退为印章头像。
2. 物品图标：Minecraft 还原 Mod HiedaCamellia/MystiasIzakaya 的物品贴图（32px PNG）
   + 该 Mod 自带的 zh_cn 语言文件（拼音 id -> 中文名，权威映射）。

输出：
- 脚本/wafu_assets/avatars/<名字>.webp   (160px)
- 脚本/wafu_assets/icons/<名字>.webp     (32px)
- 脚本/asset_map.json                    {avatars:{名字:文件名}, icons:{名字:文件名}}
"""
import json
import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = Path(__file__).resolve().parent
ASSET_DIR = SCRIPTS / "wafu_assets"
GAME_AVATAR = Path(r"F:\Games\GamePlats\Steam\steamapps\common\Touhou Mystia Izakaya\东方夜雀食堂 头像&表情包 ~ Avatar Image")
MOD1 = ROOT / "原始资料" / "repos" / "MystiasIzakaya" / "src" / "generated" / "resources" / "assets" / "mystias_izakaya" / "lang" / "zh_cn.json"
MOD1_TEX = ROOT / "原始资料" / "repos" / "MystiasIzakaya" / "src" / "main" / "resources" / "assets" / "mystias_izakaya" / "textures" / "item"
HTML = ROOT / "成品" / "东方夜雀食堂攻略查询_和风版.html"

# 人工识图得到的 头像编号 -> 客人名字 映射（folder, 文件名首段）
AVATAR_MAP = {
    ("本体", "07"): "稗田阿求",
    ("本体", "08"): "博丽灵梦",
    ("本体", "12"): "露米娅",
    ("本体", "13"): "红美铃",
    ("本体", "15"): "魂魄妖梦",
    ("本体", "16"): "蕾米莉亚",
    ("本体", "17"): "星熊勇仪",
    ("本体", "18"): "莉格露",
    ("本体", "19"): "茨木华扇",
    ("本体", "21"): "帕秋莉",
    ("本体", "22"): "蓬莱山辉夜",
    ("本体", "23"): "琪露诺",
    ("本体", "24"): "森近霖之助",
    ("本体", "25"): "上白泽慧音",
    ("本体", "28"): "藤原妹红",
    ("本体", "29"): "比那名居天子",
    ("本体", "30"): "雾雨魔理沙",
    ("本体", "31"): "西行寺幽幽子",
    ("本体", "34"): "伊吹萃香",
    ("DLC1", "01"): "爱丽丝",
    ("DLC1", "02"): "东风谷早苗",
    ("DLC1", "03"): "河城荷取",
    ("DLC1", "06"): "犬走椛",
    ("DLC1", "07"): "矢田寺成美",
    ("DLC1", "08"): "饕餮尤魔",
    ("DLC2", "01"): "黑谷山女",
    ("DLC2", "02"): "火焰猫燐",
    ("DLC2", "03"): "橙",
    ("DLC2", "04"): "古明地觉",
    ("DLC2", "05"): "古明地恋",
    ("DLC2", "09"): "星熊勇仪",
    ("DLC3", "014"): "村纱水蜜",
    ("DLC3", "024"): "今泉影狼",
}


def load_target_names():
    text = HTML.read_text(encoding="utf-8")
    m = re.search(r'<script id="app-data" type="application/json">(.*?)</script>', text, re.S)
    data = json.loads(m.group(1).replace("<\\/", "</"))
    guests = [r[0] for r in data["sheets"]["guests"]["rows"]]
    names = set()
    for key, first_col in (("recipes", "菜品"), ("ingredients", "食材"), ("beverages", "酒水")):
        headers = data["sheets"][key]["headers"]
        idx = headers.index(first_col)
        for r in data["sheets"][key]["rows"]:
            v = r[idx]
            if v and not v.isdigit():
                names.add(v)
    return guests, names


def first_expr_file(folder: Path, cid: str) -> Path | None:
    for f in sorted(folder.glob(cid + "-*.png")):
        return f
    exact = folder / (cid + ".png")
    if exact.exists():
        return exact
    return None


def save_webp(img: Image.Image, out: Path, size: int | None = None, lossless: bool = False) -> None:
    if size:
        img = img.resize((size, size), Image.LANCZOS)
    kw = {"method": 6}
    if lossless:
        kw.update({"lossless": True})
    else:
        kw.update({"quality": 84})
    img.save(out, "WEBP", **kw)


def main() -> None:
    av_dir = ASSET_DIR / "avatars"
    ic_dir = ASSET_DIR / "icons"
    av_dir.mkdir(parents=True, exist_ok=True)
    ic_dir.mkdir(parents=True, exist_ok=True)
    guests, item_names = load_target_names()

    avatar_map = {}
    for (folder, cid), name in AVATAR_MAP.items():
        f = first_expr_file(GAME_AVATAR / folder, cid)
        if not f:
            print("!! 头像缺失：", folder, cid, name)
            continue
        out = av_dir / (name + ".webp")
        save_webp(Image.open(f).convert("RGB"), out, size=160)
        avatar_map[name] = out.name

    # 物品图标：mod1 语言文件（拼音id -> 中文名）+ 物品贴图
    lang = json.load(open(MOD1, encoding="utf-8"))
    id_to_name = {
        k.replace("item.mystias_izakaya.", ""): v
        for k, v in lang.items()
        if k.startswith("item.mystias_izakaya.")
    }
    name_to_id = {}
    for pid, zh in id_to_name.items():
        name_to_id.setdefault(zh, pid)

    def normalize(s: str) -> str:
        return re.sub(r"[\s·～~！!？?（）()、“”\"'、。]", "", s)

    synonyms = {"西蓝花": "西兰花", "手握寿司": "握寿司"}
    name_to_id_norm = {}
    for zh, pid in name_to_id.items():
        name_to_id_norm.setdefault(normalize(zh), pid)
    norm_targets = {normalize(n): n for n in item_names}
    icon_map = {}
    missing = []
    for norm, name in sorted(norm_targets.items()):
        pid = name_to_id.get(name) or name_to_id_norm.get(norm) or name_to_id.get(synonyms.get(name, ""))
        if not pid:
            missing.append(name)
            continue
        tex = MOD1_TEX / (pid + ".png")
        if not tex.exists():
            missing.append(name)
            continue
        img = Image.open(tex).convert("RGBA")
        stem = ASSET_DIR / "icons" / name
        out = stem.with_suffix(".webp")
        save_webp(img, out, lossless=True)
        lossy = stem.with_suffix(".lossy.webp")
        save_webp(img, lossy, lossless=False)
        png = stem.with_suffix(".png")
        img.save(png, "PNG", optimize=True)
        best = min([out, lossy, png], key=lambda p: p.stat().st_size)
        for p in (out, lossy, png):
            if p != best:
                p.unlink()
        final = stem.with_suffix(".webp")
        if best != final:
            best.replace(final)
        icon_map[name] = final.name

    covered = sum(1 for g in guests if g in avatar_map)
    print(f"头像：{len(avatar_map)} 张，覆盖 {covered}/{len(guests)} 位客人")
    print(f"图标：{len(icon_map)} 个（目标条目 {len(item_names)}）")
    json.dump({"avatars": avatar_map, "icons": icon_map}, open(SCRIPTS / "asset_map.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    no_icon = sorted(n for n in item_names if n not in icon_map)
    print("无图标条目：", "、".join(no_icon) if no_icon else "无")
    no_avatar = sorted(g for g in guests if g not in avatar_map)
    print("无头像客人：", "、".join(no_avatar))


if __name__ == "__main__":
    main()
