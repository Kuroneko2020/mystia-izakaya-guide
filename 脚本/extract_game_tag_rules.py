# -*- coding: utf-8 -*-
"""成餐标签合成规则机器提取：游戏原生数据 + 上游源码 → 中间数据/GAME_TAG_RULES.json。

来源（均为本地已有材料，可用参数覆盖路径）：
1. 游戏 FoodTagRuleProfile 原始提取物 —— 覆盖规则对（Sellable.get_Tags → SolveTagPriority 消费的规则表）。
2. 游戏规范化目录 idNameMaps —— 负数标签的官方中文名（料理/酒水两个类别分开）。
3. 夜雀助手 FoodCatalog.ts —— 价格标签阈值、大份派生阈值、成餐食材位上限。
4. 夜雀助手 tagFacts.ts DYNAMIC_FOOD_TAG_MAP —— 动态标签 ID 常量。

只做解析与溯源记录，不手工录入任何数值；输出含每个来源的相对路径与 sha256。
"""
import argparse
import hashlib
import json
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GAME_RAW = ROOT / "验证记录" / "2026-10-13--全量数据核查" / "游戏原始核验"
ANYI = (ROOT / "原始资料" / "repos" / "touhou-mystia-izakaya-assistant"
        / "app" / "domain")
DEFAULT_OUT = ROOT / "中间数据" / "GAME_TAG_RULES.json"

FOOD_CATALOG = ANYI / "catalog" / "food" / "FoodCatalog.ts"
TAG_FACTS = ANYI / "data" / "tags" / "tagFacts.ts"


def sha256_of(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rel(path):
    return str(Path(path).resolve().relative_to(ROOT)).replace("\\", "/")


def parse_dynamic_tag_map(text):
    m = re.search(r"export\s+const\s+DYNAMIC_FOOD_TAG_MAP\s*=\s*\{(.*?)\}\s*as const",
                  text, re.S)
    if not m:
        raise ValueError("tagFacts.ts 中未找到 DYNAMIC_FOOD_TAG_MAP")
    out = {}
    for key, value in re.findall(r"(\w+)\s*:\s*(-?\d+)", m.group(1)):
        out[key] = int(value)
    return out


def parse_food_catalog(text):
    """从上游源码文本提取阈值常量（正则即为提取器，不手抄数值）。"""
    patterns = {
        "expensiveAbove": r"food\.price\s*>\s*(\d+)",
        "cheapBelow": r"food\.price\s*<\s*(\d+)",
        "largeMinTotalIngredients": r"totalIngredientCount\s*>=\s*(\d+)",
        "mealSlotCap": r"extraIngredients'\]\.length\s*<=\s*(\d+)",
    }
    out = {}
    for key, pattern in patterns.items():
        m = re.search(pattern, text)
        if not m:
            raise ValueError(f"FoodCatalog.ts 中未找到 {key} 的阈值表达式")
        out[key] = int(m.group(1))
    return out


def parse_upstream_cover_map(text, dynamic):
    """解析上游 tagCoverMap，符号引用（DYNAMIC_FOOD_TAG_MAP.x）解析为数字 ID。"""
    m = re.search(r"public static readonly tagCoverMap\s*=\s*\{(.*?)\}\s*as const",
                  text, re.S)
    if not m:
        raise ValueError("FoodCatalog.ts 中未找到 tagCoverMap")

    def to_id(sym, num):
        if sym:
            if sym not in dynamic:
                raise ValueError(f"未知动态标签符号 {sym}")
            return dynamic[sym]
        return int(num)

    pairs = []
    key = (r"(?:\[(?:DYNAMIC_FOOD_TAG_MAP\.(?P<cs>\w+)|(?P<cn>-?\d+))\]"
           r"|(?:DYNAMIC_FOOD_TAG_MAP\.(?P<cs2>\w+)|(?P<cn2>-?\d+)))")
    for m2 in re.finditer(
            key + r"\s*:\s*"
            r"(?:DYNAMIC_FOOD_TAG_MAP\.(?P<ks>\w+)|(?P<kn>-?\d+))", m.group(1)):
        coverer = to_id(m2.group("cs") or m2.group("cs2"),
                        m2.group("cn") or m2.group("cn2"))
        covered = to_id(m2.group("ks"), m2.group("kn"))
        pairs.append([coverer, covered])
    return pairs


def main():
    ap = argparse.ArgumentParser(description="提取成餐标签合成规则")
    ap.add_argument("--rule-profile", default=str(GAME_RAW / "FoodTagRuleProfile_raw.json"))
    ap.add_argument("--catalog-normalized", default=str(GAME_RAW / "game_catalog_raw_normalized.json"))
    ap.add_argument("--food-catalog-ts", default=str(FOOD_CATALOG))
    ap.add_argument("--tag-facts-ts", default=str(TAG_FACTS))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    args = ap.parse_args()

    rule_profile_path = Path(args.rule_profile)
    catalog_path = Path(args.catalog_normalized)
    food_catalog_path = Path(args.food_catalog_ts)
    tag_facts_path = Path(args.tag_facts_ts)
    out_path = Path(args.out)

    rule_raw = json.loads(rule_profile_path.read_text(encoding="utf-8"))
    tree = rule_raw["tree"]
    game_pairs = [list(pair["rule"]) for pair in tree["rules"]]
    tag_type = tree.get("tagType")
    if tag_type != 0:
        raise ValueError(f"FoodTagRuleProfile.tagType 预期 0（料理），实际 {tag_type}")

    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    id_name_maps = catalog["idNameMaps"]
    food_names = {int(k): v for k, v in id_name_maps["foodTag"].items()}
    beverage_names = {int(k): v for k, v in id_name_maps["beverageTag"].items()}

    catalog_text = food_catalog_path.read_text(encoding="utf-8")
    thresholds = parse_food_catalog(catalog_text)

    tag_facts_text = tag_facts_path.read_text(encoding="utf-8")
    dynamic = parse_dynamic_tag_map(tag_facts_text)
    for key in ("expensive", "economical", "largePartition"):
        if key not in dynamic:
            raise ValueError(f"DYNAMIC_FOOD_TAG_MAP 缺少 {key}")

    # 上游6 对必须是游戏 7 对的子集（上游缺 水产→素）；符号名解析为 ID 后比较。
    resolved_upstream = parse_upstream_cover_map(catalog_text, dynamic)
    missing_in_upstream = [p for p in game_pairs if p not in resolved_upstream]
    extra_in_upstream = [p for p in resolved_upstream if p not in game_pairs]
    if extra_in_upstream:
        raise ValueError(f"上游覆盖对不在游戏规则表中：{extra_in_upstream}")

    expensive_tag = dynamic["expensive"]
    economical_tag = dynamic["economical"]
    large_tag = dynamic["largePartition"]
    if food_names.get(expensive_tag) != "昂贵" or food_names.get(economical_tag) != "实惠":
        raise ValueError("价格标签 ID 与游戏标签名映射不一致")
    if food_names.get(large_tag) != "大份":
        raise ValueError("大份标签 ID 与游戏标签名映射不一致")
    if beverage_names.get(expensive_tag) != "昂贵" or beverage_names.get(economical_tag) != "便宜":
        raise ValueError("酒水价格标签 ID 与游戏标签名映射不一致")

    now = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M %z")
    rules = {
        "schemaVersion": 1,
        "generatedAt": now,
        "semantics": {
            "food": "游戏原生 Sellable.get_Tags 口径：原始标签 + 价格动态标签 + 大份派生（成餐食材总数达阈值）后，"
                    "按 FoodTagRuleProfile 覆盖规则表去重（SolveTagPriority）。",
            "beverage": "酒水与料理同为 Sellable（原生 get_PriceTag 为共享基类），派生价格标签；"
                        "覆盖规则表为 FoodTagRuleProfile（tagType=0，料理类别），不套用到酒水标签 ID（两个类别独立编号）。",
        },
        "priceTag": {
            "food": {str(expensive_tag): food_names[expensive_tag],
                     str(economical_tag): food_names[economical_tag]},
            "beverage": {str(expensive_tag): beverage_names[expensive_tag],
                         str(economical_tag): beverage_names[economical_tag]},
            "expensiveAbove": thresholds["expensiveAbove"],
            "cheapBelow": thresholds["cheapBelow"],
            "comparison": "严格大于 / 严格小于（原生 cmp 后 jl / jle）",
            "skippedIds": [-1],
        },
        "largePortion": {
            "tag": large_tag,
            "name": food_names[large_tag],
            "minTotalIngredients": thresholds["largeMinTotalIngredients"],
            "note": "成餐食材总数（主料 + 额外加料）达阈值即派生，随后参与覆盖（大份覆盖小巧）。",
        },
        "mealSlots": {"maxTotalIngredients": thresholds["mealSlotCap"],
                      "note": "上游 isMealFood：主料 + 额外加料 ≤ 上限，超出的加料组合不成餐。"},
        "foodCoverPairs": game_pairs,
        "foodCoverNames": [[food_names.get(a, f"<{a}>"), food_names.get(b, f"<{b}>")]
                           for a, b in game_pairs],
        "beverageCoverPairs": [],
        "upstreamCrossCheck": {
            "tagCoverMapPairs": resolved_upstream,
            "missingInUpstream": missing_in_upstream,
            "note": "上游 FoodCatalog.tagCoverMap 仅 6 对；游戏规则表多出的对以游戏为准。",
        },
        "gameTagNames": {
            "food": {str(k): v for k, v in sorted(food_names.items()) if k < 0},
            "beverage": {str(k): v for k, v in sorted(beverage_names.items()) if k < 0},
        },
        "provenance": {
            "sources": [
                {"path": rel(rule_profile_path), "sha256": sha256_of(rule_profile_path),
                 "role": "游戏覆盖规则表（7 对，tagType=0）"},
                {"path": rel(catalog_path), "sha256": sha256_of(catalog_path),
                 "role": "游戏标签名映射"},
                {"path": rel(food_catalog_path), "sha256": sha256_of(food_catalog_path),
                 "role": "上游阈值与覆盖表交叉核对"},
                {"path": rel(tag_facts_path), "sha256": sha256_of(tag_facts_path),
                 "role": "动态标签 ID 常量"},
            ],
        },
    }
    out_path.write_text(json.dumps(rules, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
    print(out_path)
    print(f"覆盖对 {len(game_pairs)}（上游缺 {len(missing_in_upstream)}）："
          f"{rules['foodCoverNames']}")
    print(f"价格阈值 >{thresholds['expensiveAbove']} 昂贵 / <{thresholds['cheapBelow']} 实惠，"
          f"大份 ≥{thresholds['largeMinTotalIngredients']} 料，成餐上限 {thresholds['mealSlotCap']} 料")


if __name__ == "__main__":
    main()
