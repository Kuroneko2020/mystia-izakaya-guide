# -*- coding: utf-8 -*-
"""Read-only machine export of the meal domain and the existing Python oracle.

No workbook, synthesized site baseline, game installation or save is read/written.
Default output is JSON on stdout. --out-dir creates one new file exclusively;
existing files are never replaced. --oracle uses meal_tags.MealTagRules, not
spreadsheet effective tags, for the 209 defaults and all single-addon boundaries.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path, PureWindowsPath

sys.dont_write_bytecode = True
from meal_tags import MealTagRules
from extract_game_tag_rules import parse_dynamic_tag_map

ROOT = Path(__file__).resolve().parents[1]
RAW_PATH = ROOT / "验证记录/2026-10-13--全量数据核查/游戏原始核验/game_catalog_raw_normalized.json"
MID = ROOT / "中间数据"
DOMAIN = ROOT / "原始资料/repos/touhou-mystia-izakaya-assistant/app/domain"
PLACE_PATH = DOMAIN / "data/places/placeFacts.ts"
TAG_PATH = DOMAIN / "data/tags/tagFacts.ts"


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source(path, role):
    return {"path": path.relative_to(ROOT).as_posix(), "sha256": digest(path), "role": role}


def profile_source(entry):
    src = entry["source"]
    return {"profile": src["profile"], "sha256": src["sha256"],
            "fileName": PureWindowsPath(src["file"]).name,
            # Unity path IDs exceed JavaScript's safe integer range.
            "pathId": str(src["path_id"]), "rawJson": src.get("rawJson")}


def mid_index(name):
    records = [x for x in load(MID / (name + ".json")) if x.get("dlc") != 9]
    out = {x["id"]: x for x in records}
    if len(out) != len(records):
        raise ValueError("Duplicate IDs in " + name)
    return out


def extract_places(text):
    block = re.search(r"export\s+const\s+MAP_FACTS\s*=\s*\{(.*?)\}\s*as const", text, re.S)
    if not block:
        raise ValueError("MAP_FACTS not found")
    maps = []
    for key, dlc, label, tier in re.findall(
        r"(\w+)\s*:\s*\{\s*dlc:\s*([\d.]+)\s*,\s*label:\s*'([^']+)'\s*,\s*unlockTier:\s*(\d+)\s*\}",
        block.group(1),
    ):
        maps.append({"id": key, "name": label, "dlc": float(dlc),
                     "unlockTier": int(tier), "isBusinessMap": True})
    # Extra reference locations are extracted from PLACE_LABEL_MAP, not hand named.
    place_block = re.search(r"export\s+const\s+PLACE_LABEL_MAP\s*=\s*\{(.*?)\}\s*as const", text, re.S)
    if not place_block or not maps:
        raise ValueError("PLACE_LABEL_MAP not found")
    known = {x["id"] for x in maps}
    for key, label in re.findall(r"(\w+)\s*:\s*'([^']+)'", place_block.group(1)):
        if key not in known:
            maps.append({"id": key, "name": label, "dlc": None,
                         "unlockTier": None, "isBusinessMap": False})
    return maps


def check_equal(a, b, description):
    if a != b:
        raise ValueError(f"Raw/intermediate mismatch: {description}: {a!r} != {b!r}")


def build_domain():
    raw = load(RAW_PATH)
    rules_path = MID / "GAME_TAG_RULES.json"
    rules = load(rules_path)
    original = {kind: mid_index(name) for kind, name in (
        ("food", "FOOD_LIST"), ("ingredient", "INGREDIENT_LIST"),
        ("beverage", "BEVERAGE_LIST"), ("normalGuest", "NORMAL_GUEST_LIST"),
        ("specialGuest", "SPECIAL_GUEST_LIST"))}
    indexes = {kind: {x["id"]: x for x in raw["entries"] if x["type"] == kind}
               for kind in original}
    for kind, entries in original.items():
        missing = entries.keys() - indexes[kind].keys()
        if missing:
            raise ValueError(f"Official raw catalog missing {kind} IDs: {sorted(missing)}")
    tag_text = TAG_PATH.read_text(encoding="utf-8")
    dynamic_ids = parse_dynamic_tag_map(tag_text)
    dark_block = re.search(r"export\s+const\s+DARK_MATTER_META_MAP\s*=\s*\{(.*?)\}\s*as const", tag_text, re.S)
    if not dark_block:
        raise ValueError("DARK_MATTER_META_MAP not found")
    dark_tag = int(re.search(r"positiveTag\s*:\s*(-?\d+)", dark_block.group(1)).group(1))
    dark_foods = [x for x in indexes["food"].values() if x["rawTags"] == [dark_tag]]
    if len(dark_foods) != 1:
        raise ValueError("Ambiguous dark-matter catalog identity")
    dark_food = dark_foods[0]
    tag_maps = {"food": raw["idNameMaps"]["foodTag"],
                "beverage": raw["idNameMaps"]["beverageTag"]}
    for kind in tag_maps:
        for key, label in rules["gameTagNames"][kind].items():
            check_equal(tag_maps[kind][key], label, f"{kind} rule tag {key}")
    # No locally maintained second rules table: preserve the existing export verbatim.
    for kind in ("food", "beverage"):
        check_equal(str(dynamic_ids["expensive"]) in rules["priceTag"][kind], True, "expensive identity")
        check_equal(str(dynamic_ids["economical"]) in rules["priceTag"][kind], True, "cheap identity")
    recipes = []
    seen = set()
    for x in raw["recipes"]:
        if x["id"] in seen:
            raise ValueError(f"Duplicate official recipe ID {x['id']}")
        seen.add(x["id"])
        if x["foodID"] not in indexes["food"]:
            raise ValueError(f"Recipe owner missing: {x['id']}")
        if any(i not in indexes["ingredient"] for i in x["ingredients"]):
            raise ValueError(f"Recipe ingredient missing: {x['id']}")
        recipes.append({"id": x["id"], "foodId": x["foodID"],
                        "baseIngredients": list(x["ingredients"]),
                        "cookerType": x["cookerType"],
                        "cooker": {"id": x["cookerType"],
                                   "name": raw["cookerTypeNames"][str(x["cookerType"])]},
                        "cookTime": x["cookTime"], "source": profile_source(x)})
    recipes.sort(key=lambda x: x["id"])
    foods, ingredients, beverages = [], [], []
    for kind, output in (("food", foods), ("ingredient", ingredients), ("beverage", beverages)):
        for x in sorted(indexes[kind].values(), key=lambda x: x["id"]):
            old = original[kind].get(x["id"])
            if old is None:
                raise ValueError(f"Official input scope missing {kind} {x['id']}")
            check_equal(x["price"], old["price"], f"{kind} {x['id']} price")
            check_equal(sorted(x["rawTags"]), sorted(old["positiveTags"] if kind == "food" else old["tags"]),
                        f"{kind} {x['id']} original tags")
            row = {"id": x["id"], "name": x["name"], "displayName": old["name"],
                   "rawTags": list(x["rawTags"]), "price": x["price"], "level": x["level"],
                   "dlc": old["dlc"], "description": old.get("description", ""),
                   "acquisition": old.get("from", {}), "source": profile_source(x)}
            if kind == "food":
                row["banTags"] = list(x["banTags"])
                check_equal(sorted(row["banTags"]), sorted(old["negativeTags"]), f"food {x['id']} bans")
                owned = [p for p in recipes if p["foodId"] == x["id"]]
                row["recipeIds"] = [p["id"] for p in owned]
                row["cookable"] = bool(owned)
                if x["id"] != dark_food["id"]:
                    check_equal(sorted(row["recipeIds"]), sorted(p["id"] for p in old["recipes"]),
                                f"food {x['id']} recipe IDs")
                else:
                    row["recipeNote"] = "No official recipe; intermediate failure placeholder is not exported as a recipe"
                for p in owned:
                    old_recipe = next(q for q in old["recipes"] if q["id"] == p["id"])
                    check_equal(p["baseIngredients"], old_recipe["ingredients"], f"recipe {p['id']} slots")
                    check_equal(p["cookerType"], old_recipe["cookerType"], f"recipe {p['id']} cooker")
            elif kind == "ingredient":
                row["type"] = old.get("type")
                row["isEasterEgg"] = x["id"] < 0
            else:
                row["banTags"] = list(x.get("banTags") or [])
            output.append(row)
    guests = []
    for kind, prefix in (("specialGuest", "s"), ("normalGuest", "n")):
        for idx, old in sorted(original[kind].items()):
            x = indexes[kind][idx]
            game = x["raw"]
            special = kind == "specialGuest"
            food_likes = [t["tagId"] for t in game["likeFoodTag"]] if special else list(game["likeFoodTag"])
            bev_likes = [t["tagId"] for t in game["likeBevTag"]] if special else list(game["likeBevTag"])
            food_hates = list(game.get("hateFoodTag") or [])
            # Serialized attitude is kept, but enum meanings are not guessed.
            old_dynamic = {"foodLikes": [t for t in old["positiveTags"]
                                         if t in (dynamic_ids["popularPositive"], dynamic_ids["popularNegative"])],
                           "foodHates": [t for t in old.get("negativeTags", [])
                                         if t in (dynamic_ids["popularPositive"], dynamic_ids["popularNegative"])]}
            fixed = lambda ts: sorted(t for t in ts if t not in (
                dynamic_ids["popularPositive"], dynamic_ids["popularNegative"]))
            if not game.get("isLikeAllFoodTag"):
                check_equal(fixed(food_likes), fixed(old["positiveTags"]), f"guest {prefix}:{idx} likes")
            check_equal(fixed(food_hates), fixed(old.get("negativeTags", [])), f"guest {prefix}:{idx} hates")
            if not game.get("isLikeAllBevTag"):
                check_equal(sorted(bev_likes), sorted(old["beverageTags"]), f"guest {prefix}:{idx} beverages")
            budget = [game["fundRange"]["x"], game["fundRange"]["y"]] if special else None
            if special:
                check_equal(budget, old["price"], f"guest {prefix}:{idx} budget")
            guests.append({"id": idx, "key": f"{prefix}:{idx}",
                           "kind": "special" if special else "normal", "name": x["name"],
                           "displayName": old["name"], "dlc": old["dlc"],
                           "mapIds": list(old.get("maps", [])),
                           "foodLikes": fixed(food_likes), "foodHates": fixed(food_hates),
                           "beverageLikes": sorted(bev_likes), "budgetRange": budget,
                           "foodHatesKnown": special, "beverageHatesKnown": False,
                           "isLikeAllFoodTags": bool(game.get("isLikeAllFoodTag", False)),
                           "isLikeAllBevTags": bool(game.get("isLikeAllBevTag", False)),
                           "foodWeights": list(game["likeFoodTag"]) if special else None,
                           "beverageWeights": list(game["likeBevTag"]) if special else None,
                           "fundMultiplier": game.get("fundMultiplier"),
                           "trendAttitude": {"rawReaction": game.get("reaction"),
                                             "intermediateDynamicTags": old_dynamic,
                                             "status": "unverified-runtime-attitude"},
                           "source": profile_source(x)})
    maps = extract_places(PLACE_PATH.read_text(encoding="utf-8"))
    map_ids = {x["id"] for x in maps}
    if any(m not in map_ids for g in guests for m in g["mapIds"]):
        raise ValueError("Unknown guest map identity")
    derivable = {dynamic_ids["expensive"], dynamic_ids["economical"], rules["largePortion"]["tag"], dark_tag}
    context_tags = {kind: sorted(int(t) for t in names if int(t) < 0 and int(t) not in derivable)
                    for kind, names in tag_maps.items()}
    # Negative categories are separate. A serialized beverage tag (e.g.
    # non-alcoholic) is ordinary, not the same-numbered food large-portion tag.
    beverage_raw_ids = {t for b in beverages for t in b["rawTags"]}
    context_tags["beverage"] = sorted(int(t) for t in tag_maps["beverage"] if int(t) < 0
                                       and str(t) not in rules["priceTag"]["beverage"]
                                       and int(t) not in beverage_raw_ids)
    paths = [(RAW_PATH, "official original catalog, recipes and complete category tag names"),
             (rules_path, "existing machine rules; copied without editing"),
             (PLACE_PATH, "machine-extracted place IDs/names"),
             (TAG_PATH, "machine dynamic/dark-matter identities"),
             (ROOT / "脚本/meal_tags.py", "Python synthesis oracle"),
             (Path(__file__).resolve(), "exporter")]
    paths += [(MID / (name + ".json"), "original parsed metadata and official guide-scope IDs")
              for name in ("FOOD_LIST", "INGREDIENT_LIST", "BEVERAGE_LIST", "NORMAL_GUEST_LIST", "SPECIAL_GUEST_LIST")]
    return {"schemaVersion": 1, "foods": foods, "recipes": recipes,
            "ingredients": ingredients, "beverages": beverages, "guests": guests, "maps": maps,
            "tagMaps": tag_maps, "rules": rules, "dynamicTagIds": dynamic_ids,
            "contextTagIds": context_tags,
            "specialIds": {"darkMatterFood": dark_food["id"], "darkMatterTag": dark_tag},
            "provenance": {"gameBuild": raw["gameBuild"],
                           "gameVersion": raw["gameVersionResourceLastLine"],
                           "sourceKind": raw["sourceKind"],
                           "scope": "original intermediate official guide scope; all official recipes and sellables retained",
                           "sources": [source(p, role) for p, role in paths],
                           "counts": {"foods": len(foods), "cookableFoods": sum(x["cookable"] for x in foods),
                                      "recipes": len(recipes), "ingredients": len(ingredients),
                                      "beverages": len(beverages), "guests": len(guests), "maps": len(maps)},
                           "limitations": ["no runtime rating, Endurance/mood or actual revenue simulation",
                                           "trend reaction enum is not verified; trends are not counted",
                                           "ordinary wallets unknown; map lists are not visit probabilities",
                                           "acquisition metadata is original parsed input and may be lossy"]}}


def canonical_digest(data):
    # Fingerprint the exact machine-export bytes. Python/JS numeric-key order and
    # integral float representations are not a shared JSON canonicalization.
    text = json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def oracle_payload(data):
    oracle = MealTagRules(data["rules"])
    foods = {x["id"]: x for x in data["foods"]}
    ingredients = {x["id"]: x for x in data["ingredients"]}
    beverages = {x["id"]: x for x in data["beverages"]}
    recipes = {x["id"]: x for x in data["recipes"]}

    def food_case(recipe, extras=(), price=None):
        food = foods[recipe["foodId"]]
        value = food["price"] if price is None else price
        extra_tags = [t for i in extras for t in ingredients[i]["rawTags"]]
        composed = oracle.compose_food_tags(food["rawTags"], value, len(recipe["baseIngredients"]),
                                           extra_tags, len(extras), food["id"])
        conflicts = sorted(set(extra_tags) & set(food["banTags"]))
        used = len(recipe["baseIngredients"]) + len(extras)
        final = foods[data["specialIds"]["darkMatterFood"]]["rawTags"] if conflicts else (
            [] if used > oracle.slot_cap else composed)
        return {"draft": {"recipeId": recipe["id"], "foodId": food["id"], "extras": list(extras),
                          "foodPrice": price},
                "expected": {"foodTags": final, "intendedFoodTags": composed,
                             "used": used, "free": max(0, oracle.slot_cap - used),
                             "conflictTags": conflicts, "isDarkMatter": bool(conflicts), "foodPrice": value}}

    defaults = [food_case(x) for x in data["recipes"]]
    defaults += [{"draft": {"beverageId": b["id"]},
                  "expected": {"beverageTags": oracle.compose_beverage_tags(b["rawTags"], b["price"]),
                               "beveragePrice": b["price"]}}
                 for b in data["beverages"]]
    # Every single-addon candidate, including full slots, dark conflicts and the
    # easter egg, is crossed against the same Python synthesis implementation.
    addon_cases = [food_case(r, [i]) for r in data["recipes"] for i in sorted(ingredients)]
    cap = data["rules"]["mealSlots"]["maxTotalIngredients"]
    repeated = []
    for r in data["recipes"]:
        free = cap - len(r["baseIngredients"])
        for i in sorted(ingredients):
            if free >= 2:
                repeated.append(food_case(r, [i] * free))
                repeated.append(food_case(r, [i] * (free + 1)))
    prices = []
    thresholds = [data["rules"]["priceTag"]["cheapBelow"], data["rules"]["priceTag"]["expensiveAbove"]]
    price_values = sorted({0, *(p + delta for p in thresholds for delta in (-1, 0, 1))})
    for r in data["recipes"]:
        prices += [food_case(r, price=value) for value in price_values]
    for b in data["beverages"]:
        prices += [{"draft": {"beverageId": b["id"], "beveragePrice": value},
                    "expected": {"beverageTags": oracle.compose_beverage_tags(b["rawTags"], value),
                                 "beveragePrice": value}} for value in price_values]
    if len(defaults) != len(recipes) + len(beverages):
        raise ValueError("Oracle default count mismatch")
    return {"schemaVersion": 1, "catalogFingerprint": canonical_digest(data),
            "oracleSource": source(ROOT / "脚本/meal_tags.py", "existing synthesis oracle"),
            "defaults": defaults, "addonCases": addon_cases,
            "repeatedAddonCases": repeated, "priceCases": prices,
            "counts": {"defaults": len(defaults), "addons": len(addon_cases),
                       "repeatedAddons": len(repeated), "prices": len(prices)}}


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, help="explicit output directory; refuses existing target")
    parser.add_argument("--oracle", action="store_true", help="emit Python oracle cases instead of domain data")
    args = parser.parse_args()
    data = build_domain()
    payload = oracle_payload(data) if args.oracle else data
    text = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if args.out_dir is None:
        sys.stdout.write(text)
    else:
        args.out_dir.mkdir(parents=True, exist_ok=True)
        path = args.out_dir / ("meal_domain_python_oracle.json" if args.oracle else "MEAL_DOMAIN_DATA.json")
        with path.open("x", encoding="utf-8", newline="\n") as output:
            output.write(text)
        print(json.dumps({"output": str(path), "sha256": digest(path),
                          "counts": payload.get("counts", payload.get("provenance", {}).get("counts"))},
                         ensure_ascii=False))


if __name__ == "__main__":
    main()
