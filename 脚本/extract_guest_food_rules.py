# -*- coding: utf-8 -*-
"""Extract guest-specific food exclusions from verified official profile assets.

Read-only inputs. No game execution, imports of game code, or production writes.
The IDs/names/pairs are NEVER handwritten. They come from official profile
references and their resolved MonoScript types. Native behavior templates are
fail-closed and assert the actual disassembly branches before emitting rules.
Usage: py -X utf8 <this-script> --out <new-rules.json>
"""
import argparse
import hashlib
import json
import re
from pathlib import Path


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--project", type=Path)
    ap.add_argument("--evidence-dir", type=Path)
    ap.add_argument("--catalog", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    root = args.project or next(p for p in Path(__file__).resolve().parents if (p / "中间数据").is_dir() and (p / "脚本").is_dir())
    evidence = args.evidence_dir or root / "验证记录/2026-10-17--家常误荐与标签回车/game_semantics_native"
    catalog_path = args.catalog or root / "验证记录/2026-10-13--全量数据核查/游戏原始核验/game_catalog_raw_normalized.json"
    assets_path = evidence / "easter_profile_assets_with_types.json"
    catalog = read_json(catalog_path)
    assets = read_json(assets_path)
    names = catalog["idNameMaps"]
    entries = catalog["entries"]
    native_methods = {
        "KoishiFoodEasterEggData": (15094, "set", "foodId", 0, "r15"),
        "LunarPersonFoodEasterEggData": (15106, "set", "foodId", 0, "r14"),
        "MomiziFoodEasterEggData": (15113, "cap", "chocolateId", 1, "rsi"),
        "NitoriFoodEasterEggData": (15115, "floor", "cucumberId", 3, "rdi"),
        "MedicineFoodEasterEggData": (15111, "floor", "foodId", 3, "rsi"),
        "RemiliaFoodEasterEggData": (15122, "set", "foodId", 4, "rsi"),
        "MarisaFoodEasterEggData": (15108, "set", "foodId", 4, "r14"),
        "YuumaFoodEasterEggData": (15124, "set", "foodId", 3, "rsi"),
    }
    idle_classes = {"Reisen2IdleDialogEasterEggData", "LuizeIdleDialogEasterEggData", "KokoroIdleDialogEasterEggData"}
    baseline_path = root / "中间数据/料亭版攻略数据基线.json"
    baseline = read_json(baseline_path)
    display_names = {
        "food": {int(row[0]): row[1] for row in baseline["sheets"]["recipes"]["rows"]},
        "ingredient": {int(row[0]): row[1] for row in baseline["sheets"]["ingredients"]["rows"]},
    }
    source_paths = {catalog_path, assets_path, baseline_path}
    expected_refs = set()
    for entry in entries:
        if entry["type"] not in ("specialGuest", "normalGuest"):
            continue
        ref = entry["raw"].get("guestFoodEasterEggData") or entry["raw"].get("m_GuestFoodEasterEggData")
        if ref and ref.get("m_PathID"):
            assert ref["m_FileID"] == 0, "External reference requires an explicit resolver"
            expected_refs.add((entry["type"], entry["id"], ref["m_PathID"]))
    observed_refs = set()
    food_exclusions = []
    ingredient_exclusions = []
    guest_rules = []
    for asset in assets:
        tree = asset["tree"]
        cls = asset["script"]["class"]
        assert cls in native_methods or cls in idle_classes, f"Unreviewed native behavior: {cls}"
        for guest in asset["guests"]:
            observed_refs.add((guest["type"], guest["id"], asset["pathId"]))
            entry = next(e for e in entries if e["type"] == guest["type"] and e["id"] == guest["id"])
            assert entry["name"] == guest["name"]
            profile_path = catalog_path.parent / entry["source"]["rawJson"]
            source_paths.add(profile_path)
            base = {"guestType": guest["type"], "guestName": guest["name"], "guestId": guest["id"],
                    "profile": tree["m_Name"], "profilePathId": asset["pathId"], "nativeClass": cls,
                    "badFood": [], "badTags": [], "badIngredients": []}
            if cls in idle_classes:
                base["behavior"] = "idle-dialog-only; inherited foodId=0 is NOT a food condition"
                guest_rules.append(base)
                continue
            mi, behavior, field, score, final_register = native_methods[cls]
            native_path = evidence / f"native_{mi}_{cls}_CheckEasterEgg_complete.txt"
            native = native_path.read_text(encoding="utf-8")
            source_paths.add(native_path)
            score_pattern = rf"mov\s+dword ptr \[{final_register}\],0*{score}(?:\s|$)"
            assert re.search(score_pattern, native), (cls, "unverified finalResult write")
            if field == "foodId":
                assert re.search(r"cmp\s+ebx,dword ptr \[r(?:14|15)\+18h\]|cmp\s+dword ptr \[rcx\+10h\],eax", native), (cls, "unverified food ID comparison")
            else:
                assert "DataBaseCore::MatchRecipe" in native and re.search(r"\+20h\]", native), (cls, "unverified base/extra ingredient branch")
            if cls == "MomiziFoodEasterEggData":
                assert re.search(r"cmp\s+ebp,1", native) and "GuestGroupController::SetGuestCannotOrder" in native
            target_id = tree[field]
            target_kind = "food" if field == "foodId" else "ingredient"
            game_target_name = names[target_kind][str(target_id)]
            target_name = display_names[target_kind].get(target_id, game_target_name)
            base.update({"condition": {"kind": target_kind, "id": target_id, "name": target_name, "gameName": game_target_name,
                                       "scope": "servedFoodId" if target_kind == "food" else "baseRecipeOrExtraIngredients"},
                         "rating": {"behavior": behavior, "value": score},
                         "nativeEvidence": {"path": native_path.relative_to(root).as_posix(), "methodIndex": mi}})
            if behavior == "set" and score == 0:
                base["badFood"] = [{"foodId": target_id, "foodName": target_name}]
                food_exclusions.append({"guestName": guest["name"], "foodName": target_name,
                                        "guestId": guest["id"], "foodId": target_id,
                                        "guestType": guest["type"], "reason": "菜品彩蛋直接判最低评价",
                                        "profile": tree["m_Name"], "nativeClass": cls})
            elif behavior == "cap" and score <= 1:
                assert target_kind == "ingredient"
                base["badIngredients"] = [{"ingredientId": target_id, "ingredientName": target_name}]
                base["stopFurtherOrders"] = True
                ingredient_exclusions.append({"guestName": guest["name"], "ingredientName": target_name,
                                              "guestId": guest["id"], "ingredientId": target_id, "gameIngredientName": game_target_name,
                                              "guestType": guest["type"], "reason": f"{target_name}彩蛋压低评价，避免给椛使用",
                                              "profile": tree["m_Name"], "nativeClass": cls})
            guest_rules.append(base)
    assert observed_refs == expected_refs, {"missing": list(expected_refs-observed_refs), "extra": list(observed_refs-expected_refs)}
    official_foods = {e["id"]: e for e in entries if e["type"] == "food" and e["id"] != -1}
    resolved = [{**rule, "condition": "servedFoodId"} for rule in food_exclusions]
    for rule in ingredient_exclusions:
        for food in official_foods.values():
            if any(rule["ingredientId"] in recipe["ingredients"] for recipe in food.get("recipes", [])):
                resolved.append({**rule, "foodId": food["id"], "foodName": food["name"],
                                 "condition": "baseRecipeContainsIngredient"})
    source_list = [{"path": p.relative_to(root).as_posix(), "sha256": sha256(p)} for p in sorted(source_paths)]
    result = {"schemaVersion": 1,
              "scope": "Official extracted RELEASE 4.4.0e / build 23158340; no save/config/game modification",
              "semantics": "Fixed tag matching stays separate from order/rating. Only proven negative food/ingredient easter eggs are excluded; positive overrides do not invent fixed likes.",
              "referenceCoverage": {"guestReferences": len(expected_refs), "uniqueAssets": len(assets),
                                    "behaviorGuests": sum("condition" in x for x in guest_rules),
                                    "idleDialogOnlyGuests": sum("condition" not in x for x in guest_rules)},
              "foodExclusions": sorted(food_exclusions, key=lambda x: (x["guestType"], x["guestId"], x["foodId"])),
              "ingredientExclusions": ingredient_exclusions,
              "resolvedFoodExclusions": sorted(resolved, key=lambda x: (x["guestType"], x["guestId"], x["foodId"])),
              "guestRules": guest_rules,
              "sources": source_list,
              "limitations": ["Native templates were statically reviewed, not executed in the game.",
                              "Current order, beverage, trends, added ingredients, cooker, buffs and overrides affect live rating.",
                              "Idle-only assets' inherited foodId=0 must not exclude seaweed miso soup.",
                              "Normal/special guest ID spaces overlap; use guestType or the unique baseline guestName."]}
    with args.out.open("x", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(json.dumps({"output": str(args.out), "coverage": result["referenceCoverage"],
                      "foodExclusions": result["foodExclusions"], "ingredientExclusions": ingredient_exclusions,
                      "resolvedCount": len(resolved)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
