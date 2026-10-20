# -*- coding: utf-8 -*-
"""合成零偏差审计：基线里每道菜/每款酒水的标签必须等于按 GAME_TAG_RULES 的机器合成结果。

独立重算（不复用 build_excel 的行构建），保证校验与生成器不共用实现。
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "脚本"))
from meal_tags import default_rules  # noqa: E402

RULES = default_rules()
BASELINE = ROOT / "中间数据" / "料亭版攻略数据基线.json"


def split_tags(value):
    return [t for t in str(value or "").split("、") if t and t != "无"]


def main():
    data = json.loads(BASELINE.read_text(encoding="utf-8"))
    foods = json.loads((ROOT / "中间数据" / "FOOD_LIST.json").read_text(encoding="utf-8"))
    beverages = json.loads((ROOT / "中间数据" / "BEVERAGE_LIST.json").read_text(encoding="utf-8"))

    def rows(key):
        s = data["sheets"][key]
        return [dict(zip(s["headers"], r)) for r in s["rows"]]

    food_name_to_id = {f["name"]: f["id"] for f in foods if f.get("dlc") != 9 and f.get("id") != -1}
    # 标签名映射取自工作簿用的展示名（build_excel 的 food_tag_name/drink_tag_name 口径）
    from build_excel import drink_tag_name, food_tag_name  # noqa: E402

    errors = []
    checked = 0
    for row in rows("recipes"):
        fid = food_name_to_id.get(row["菜品"])
        raw = next(f for f in foods if f["id"] == fid)
        recipes = raw.get("recipes") or []
        base_n = len(recipes[0].get("ingredients", [])) if recipes else 0
        expected = RULES.compose_food_tags(raw.get("positiveTags", []), raw.get("price", 0),
                                           base_n, food_id=raw.get("id"))
        expected_names = "、".join(food_tag_name(t) for t in expected)
        actual = row["菜品标签"]
        checked += 1
        if expected_names != actual:
            errors.append({"item": row["菜品"], "expected": expected_names, "actual": actual})

    for row in rows("beverages"):
        raw = next(b for b in beverages if b["name"] == row["酒水"])
        expected = RULES.compose_beverage_tags(raw.get("tags", []), raw.get("price", 0))
        expected_names = "、".join(drink_tag_name(t) for t in expected)
        actual = row["标签"]
        checked += 1
        if expected_names != actual:
            errors.append({"item": row["酒水"], "expected": expected_names, "actual": actual})

    report = {
        "checkedItems": checked,
        "mismatchCount": len(errors),
        "mismatches": errors[:20],
        "status": "PASS" if not errors else "FAIL",
    }
    out = Path(__file__).with_name("合成零偏差审计_01.json")
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
