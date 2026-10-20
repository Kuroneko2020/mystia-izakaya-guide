# -*- coding: utf-8 -*-
"""Independent read-only audit of ALL official guests/foods.

Does not import any production generator/composition/matching function. Official
raw catalog + raw priority profile are the expected side; upstream JSON and the
site baseline are actual sides. Writes a new JSON only with exclusive creation.
Usage: py -X utf8 <this-script> --out <new-audit.json>
"""
import argparse
import collections
import hashlib
import json
from pathlib import Path


def load(p):
    return json.loads(p.read_text(encoding="utf-8"))


def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--project", type=Path)
    ap.add_argument("--rules", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    root = args.project or next(p for p in Path(__file__).resolve().parents if (p / "中间数据").is_dir() and (p / "脚本").is_dir())
    evidence = root / "验证记录/2026-10-13--全量数据核查/游戏原始核验"
    catalog_path = evidence / "game_catalog_raw_normalized.json"
    covers_path = evidence / "FoodTagRuleProfile_raw.json"
    baseline_path = root / "中间数据/料亭版攻略数据基线.json"
    rules_path = args.rules or Path(__file__).parent / "GAME_GUEST_FOOD_RULES_v2.json"
    catalog, baseline, rules = load(catalog_path), load(baseline_path), load(rules_path)
    covers = [r["rule"] for r in load(covers_path)["tree"]["rules"]]
    names = catalog["idNameMaps"]
    food_names = {int(k): v for k, v in names["foodTag"].items()}
    bev_names = {int(k): v for k, v in names["beverageTag"].items()}
    entries = {(e["type"], e["id"]): e for e in catalog["entries"]}
    inputs = [catalog_path, covers_path, baseline_path, rules_path]
    intermediate = {}
    for cat, filename in [("food", "FOOD_LIST"), ("ingredient", "INGREDIENT_LIST"), ("beverage", "BEVERAGE_LIST"), ("specialGuest", "SPECIAL_GUEST_LIST"), ("normalGuest", "NORMAL_GUEST_LIST")]:
        p = root / "中间数据" / (filename + ".json")
        inputs.append(p)
        intermediate[cat] = {e["id"]: e for e in load(p) if e.get("dlc") != 9 and (cat != "food" or e["id"] != -1)}
    comparisons = []
    def check(scope, key, field, expected, actual):
        comparisons.append({"scope": scope, "id": key, "field": field, "expected": expected, "actual": actual, "equal": expected == actual})
    def canonical_tags(xs):
        return sorted(set(xs))
    for cat, rows in intermediate.items():
        for id_, row in rows.items():
            game = entries[(cat, id_)]
            if cat in ("food", "ingredient", "beverage"):
                for field, a, z in [("price", game["price"], row["price"]), ("level", game["level"], row["level"]),
                                    ("rawTags", canonical_tags(game["rawTags"]), canonical_tags(row["positiveTags"] if cat == "food" else row["tags"]))]:
                    check("game-to-upstream:" + cat, id_, field, a, z)
                if cat == "food":
                    check("game-to-upstream:food", id_, "banTags", canonical_tags(game["banTags"]), canonical_tags(row["negativeTags"]))
                    expected = sorted((r["id"], tuple(r["ingredients"]), r["cookerType"]) for r in game["recipes"])
                    actual = sorted((r["id"], tuple(r["ingredients"]), r["cookerType"]) for r in row["recipes"])
                    check("game-to-upstream:food", id_, "recipes", expected, actual)
            else:
                raw = game["raw"]
                likes = [x["tagId"] if isinstance(x, dict) else x for x in raw["likeFoodTag"]]
                if raw.get("isLikeAllFoodTag"):
                    likes = [k for k in food_names if k >= -3 and k not in (5000,)]
                    # Full wildcard is a semantic flag, not an explicit finite game list.
                    check("game-to-upstream:normalGuest", id_, "wildcardCoversEveryOfficialRawFoodTag", True,
                          all(set(e["rawTags"]).issubset(set(row["positiveTags"])) for (typ, _), e in entries.items() if typ == "food" and e["id"] != -1))
                else:
                    check("game-to-upstream:"+cat, id_, "fixedFoodLikes", canonical_tags(likes), canonical_tags(t for t in row["positiveTags"] if t not in (-20, -21)))
                if cat == "specialGuest":
                    check("game-to-upstream:"+cat, id_, "fixedFoodHates", canonical_tags(raw["hateFoodTag"]), canonical_tags(t for t in row["negativeTags"] if t not in (-20, -21)))
                    check("game-to-upstream:"+cat, id_, "fundRange", [game["moneyMin"], game["moneyMax"]], row["price"])
    def cooked(game):
        tags = set(game["rawTags"])
        if -4 not in tags:
            if game["price"] < 20:
                tags.add(-2)
            elif game["price"] > 60:
                tags.add(-3)
        recipes = game["recipes"]
        assert len(recipes) == 1, "Do not silently merge different recipes"
        # Native MatchedCookCombo.GetResult uses ==5; valid meals have <=5 slots.
        assert len(recipes[0]["ingredients"]) <= 5
        if len(recipes[0]["ingredients"]) == 5:
            tags.add(-1)
        for strong, weak in covers:
            if strong in tags:
                tags.discard(weak)
        return tags
    baseline_food = {int(row[0]): row for row in baseline["sheets"]["recipes"]["rows"]}
    baseline_ing = {int(row[0]): row for row in baseline["sheets"]["ingredients"]["rows"]}
    foods = []
    for id_, row in baseline_food.items():
        game = entries[("food", id_)]
        tags = cooked(game)
        check("game-to-baseline:food", id_, "effectiveTags", sorted(food_names[t] for t in tags), sorted(row[7].split("、")))
        check("game-to-baseline:food", id_, "price", str(game["price"]), row[4])
        check("game-to-baseline:food", id_, "level", str(game["level"]), row[3])
        ing_ids = game["recipes"][0]["ingredients"]
        check("game-to-baseline:food", id_, "ingredients", "＋".join(baseline_ing[i][1] for i in ing_ids), row[6])
        foods.append({"id": id_, "name": row[1], "tags": tags, "ingredientIds": ing_ids, "recipeId": game["recipes"][0]["id"]})
    guests = []
    for table, cat in [("guests", "specialGuest"), ("normal", "normalGuest")]:
        by_name = {e["name"]: e for e in intermediate[cat].values()}
        for row in baseline["sheets"][table]["rows"]:
            up = by_name[row[0]]
            game = entries[(cat, up["id"])]
            likes = set(t for t in up["positiveTags"] if t not in (-20, -21))
            hates = set(t for t in up.get("negativeTags", []) if t not in (-20, -21))
            like_names = set(row[5 if cat == "specialGuest" else 3].split("、")) - {"无", "流行喜爱（动态）", "流行厌恶（动态）"}
            hate_names = set(row[6].split("、")) - {"无", "流行喜爱（动态）", "流行厌恶（动态）"} if cat == "specialGuest" else set()
            check("upstream-to-baseline:"+cat, up["id"], "fixedFoodLikes", sorted(food_names[t] for t in likes), sorted(like_names))
            check("upstream-to-baseline:"+cat, up["id"], "fixedFoodHates", sorted(food_names[t] for t in hates), sorted(hate_names))
            guests.append({"id": up["id"], "name": row[0], "type": cat, "likes": likes, "hates": hates,
                           "wildcard": game["raw"].get("isLikeAllFoodTag", 0) != 0})
    all_relations, rejected = [], []
    for guest in guests:
        for food in foods:
            hits, hates = guest["likes"] & food["tags"], guest["hates"] & food["tags"]
            if not hits or hates:
                continue
            rel = {"guestType": guest["type"], "guestId": guest["id"], "guestName": guest["name"],
                   "foodId": food["id"], "foodName": food["name"], "recipeId": food["recipeId"],
                   "hitTagIds": sorted(hits), "hits": [food_names[t] for t in sorted(hits)],
                   "missingFixedTagIds": sorted(guest["likes"]-food["tags"]),
                   "missingFixedTags": [food_names[t] for t in sorted(guest["likes"]-food["tags"])]}
            exceptions = [e for e in rules["foodExclusions"] if e["guestType"] == guest["type"] and e["guestId"] == guest["id"] and e["foodId"] == food["id"]]
            exceptions += [e for e in rules["ingredientExclusions"] if e["guestType"] == guest["type"] and e["guestId"] == guest["id"] and e["ingredientId"] in food["ingredientIds"]]
            rel["exceptions"] = exceptions
            all_relations.append(rel)
            if exceptions:
                rejected.append(rel)
    singles = [x for x in all_relations if len(x["hitTagIds"]) == 1]
    incomplete = [x for x in all_relations if x["guestType"] == "specialGuest" and x["missingFixedTagIds"]]
    kept = [x for x in all_relations if not x["exceptions"]]
    def metrics(rows):
        return {"relations": len(rows), "guests": len({(x["guestType"],x["guestId"]) for x in rows}),
                "foods": len({x["foodId"] for x in rows}),
                "byGuestType": dict(collections.Counter(x["guestType"] for x in rows))}
    # Reproduce existing additive input scope: only guest recommendations and stored details.
    addon_warnings = []
    addon_guest_rows = {row[0]: row for row in baseline["sheets"]["guests"]["rows"]}
    for rule in rules["ingredientExclusions"]:
        text_sources = [{"sheet":"guests", "column":"加料推荐", "text":addon_guest_rows.get(rule["guestName"],[""]*11)[10]}]
        text_sources += [{"sheet":"details", "food": row[3], "column":"加料建议", "text":row[13]} for row in baseline["sheets"]["details"]["rows"] if row[0] == rule["guestName"]]
        matches = [x for x in text_sources if rule["ingredientName"] in x["text"]]
        addon_warnings.append({"guestName":rule["guestName"], "ingredientName":rule["ingredientName"], "matchingStoredAddonTexts":matches})
    # Minimal rating model for regular non-duplicate tags, no trend/cooker/buff/easter eggs.
    def rating(food_count, bev_count, food_order, bev_order):
        total = food_count + bev_count
        if food_order and bev_order:
            return max(2, min(total, 4))
        if food_order or bev_order:
            return min(total, 3)
        return min(total, 1)
    rating_examples = [{"foodFixedHits": 1, "beverageFixedHits": b, "matchesFoodOrder": f, "matchesBeverageOrder": v,
                        "rating":rating(1,b,f,v)} for b,f,v in [(1,False,False),(1,True,True),(1,False,True),(3,True,True),(3,False,True)]]
    mismatch = [x for x in comparisons if not x["equal"]]
    payload = {"schemaVersion":1, "evidenceLevel":"independent static recomputation, not runtime game acceptance",
               "scope":{"guests":len(guests),"specialGuests":sum(x["type"]=="specialGuest" for x in guests),"normalGuests":sum(x["type"]=="normalGuest" for x in guests),"foods":len(foods),"cartesianPairs":len(guests)*len(foods)},
               "consistency":{"checks":len(comparisons),"mismatches":mismatch,"checkCountByScope":dict(collections.Counter(x["scope"] for x in comparisons))},
               "metrics":{"fixedCandidates":metrics(all_relations),"singleHit":metrics(singles),"homeOnlySingleHit":metrics([x for x in singles if x["hitTagIds"]==[3]]),
                          "incompleteFixedOrderCoverage":metrics(incomplete),"excludedNegativeEasterEggCandidates":metrics(rejected),"afterExclusions":metrics(kept),"singleHitAfterExclusions":metrics([x for x in kept if len(x["hitTagIds"])==1])},
               "singleHitByGuest":[{"guestType":g[0],"guestId":g[1],"guestName":g[2],"count":n} for g,n in collections.Counter((x["guestType"],x["guestId"],x["guestName"]) for x in singles).items()],
               "directExcludedCandidates":rejected,
               "aya":{"allCandidates":sum(x["guestName"]=="射命丸文" for x in all_relations),"singleHitCandidates":sum(x["guestName"]=="射命丸文" for x in singles),
                      "homeOnlySingleHit":[x for x in singles if x["guestName"]=="射命丸文" and x["hitTagIds"]==[3]],
                      "trueSoup":[x for x in all_relations if x["guestName"]=="射命丸文" and x["foodId"]==37]},
               "soups":[{"foodId":i,"foodName":baseline_food[i][1],"recipeId":entries[("food",i)]["recipes"][0]["id"],"rawTags":entries[("food",i)]["rawTags"],"effectiveTagNames":[food_names[t] for t in sorted(cooked(entries[("food",i)]))],"ingredients":baseline_food[i][6]} for i in (0,1,37)],
               "negativeIngredientStoredAddonCheck":addon_warnings,
               "ratingExamplesNoTrendCookerBuffEasterEgg":rating_examples,
               "allFixedCandidateRelations":all_relations,
               "sources":[{"path":p.relative_to(root).as_posix(),"sha256":digest(p)} for p in inputs],
               "limitations":["Single-hit and incomplete-order-coverage counts are potential misunderstanding scope, NOT data-error counts.",
                              "Original user game incident is not proven without food identity/addons/current order/beverage/trends/cooker/version evidence.",
                              "All fixed candidates remain the authorized >=1 known-like/no-known-hate policy except proven native special negatives.",
                              "No budget, unlock, spawn probability or live game state is inferred."]}
    with args.out.open("x",encoding="utf-8") as f:
        json.dump(payload,f,ensure_ascii=False,indent=2)
        f.write("\n")
    print(json.dumps({"output":str(args.out),"scope":payload["scope"],"consistency":payload["consistency"],"metrics":payload["metrics"],"directExcludedCandidates":rejected,"negativeIngredientStoredAddonCheck":addon_warnings},ensure_ascii=False,indent=2))


if __name__ == "__main__":
    main()
