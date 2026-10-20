from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
SOURCE = ROOT / '验证记录/2026-10-13--全量数据核查/游戏原始核验/game_catalog_raw_normalized.json'
BASELINE = ROOT / '中间数据/料亭版攻略数据基线.json'
MAPPING = ROOT / '验证记录/2026-10-13--全量数据核查/管线审计/上游与本地转换映射_01.json'
game = json.loads(SOURCE.read_text(encoding='utf-8'))
app = json.loads(BASELINE.read_text(encoding='utf-8'))
mapping = json.loads(MAPPING.read_text(encoding='utf-8'))
raw = {key: json.loads((ROOT / f'中间数据/{key}.json').read_text(encoding='utf-8')) for key in ['FOOD_LIST', 'INGREDIENT_LIST', 'BEVERAGE_LIST', 'SPECIAL_GUEST_LIST', 'NORMAL_GUEST_LIST']}
sheets = {key: [dict(zip(sheet['headers'], row)) for row in sheet['rows']] for key, sheet in app['sheets'].items()}
entries = {kind: {entry['id']: entry for entry in game['entries'] if entry['type'] == kind} for kind in ['food', 'ingredient', 'beverage', 'normalGuest', 'specialGuest']}
checks = Counter()
differences = []
name_changes = []
coverage = {}
food_rules = [(rule['coverer'], rule['covered']) for rule in mapping['TAG_COVERS']]


def compare(kind, entry, field, actual, expected):
    checks[kind] += 1
    if field.endswith('Tags'):
        actual = sorted(set(actual))
        expected = sorted(set(expected))
    if actual != expected:
        differences.append({'kind': kind, 'id': entry['id'], 'gameName': entry['name'], 'field': field, 'siteOrSource': actual, 'game': expected})


def effective(tags, price, ingredient_count):
    result = set(tags)
    if price > 60:
        result.add(-3)
    elif price < 20:
        result.add(-2)
    if ingredient_count >= 5:
        result.add(-1)
    for coverer, covered in food_rules:
        if coverer in result:
            result.discard(covered)
    return result


for kind, key, sheet, id_column, name_column in [('food', 'FOOD_LIST', 'recipes', '菜品ID', '菜品'), ('ingredient', 'INGREDIENT_LIST', 'ingredients', '食材ID', '食材'), ('beverage', 'BEVERAGE_LIST', 'beverages', '酒水ID', '酒水'), ('normalGuest', 'NORMAL_GUEST_LIST', 'normal', None, '普通客人'), ('specialGuest', 'SPECIAL_GUEST_LIST', 'guests', None, '客人名字')]:
    raw_by_id = {entry['id']: entry for entry in raw[key] if entry.get('dlc', 0) != 9 and (kind != 'food' or entry['id'] != -1)}
    site_by_name = {row[name_column]: row for row in sheets[sheet]}
    site_by_id = {int(row[id_column]): row for row in sheets[sheet]} if id_column else {}
    matched = []
    for item_id, original in raw_by_id.items():
        entry = entries[kind].get(item_id)
        if entry is None:
            continue
        matched.append(item_id)
        row = site_by_id[item_id] if id_column else site_by_name[original['name']]
        if row[name_column] != entry['name']:
            name_changes.append({'kind': kind, 'id': item_id, 'site': row[name_column], 'game': entry['name'], 'reasonNotAssumed': True})
        if kind in ['food', 'ingredient', 'beverage']:
            compare(kind, entry, 'price', int(row['价格']), entry['price'])
            compare(kind, entry, 'level', int(row['等级']), entry['level'])
            compare(kind, entry, 'rawTags', original['positiveTags'] if kind == 'food' else original['tags'], entry['tags'])
            if kind == 'food':
                compare(kind, entry, 'banTags', original['negativeTags'], entry['banTags'])
                compare(kind, entry, 'ingredients', original['recipes'][0]['ingredients'], entry['ingredients'])
                compare(kind, entry, 'cookerType', original['recipes'][0]['cookerType'], entry['cookerType'])
                compare(kind, entry, 'cookTime', original['recipes'][0]['baseCookTime'], entry['cookTime'])
        elif kind == 'specialGuest':
            compare(kind, entry, 'staticLikeFoodTags', [value for value in original['positiveTags'] if value not in (-20, -21)], [value['id'] for value in entry['likeFoodTag']])
            compare(kind, entry, 'staticHateFoodTags', [value for value in original['negativeTags'] if value not in (-20, -21)], [value['id'] for value in entry['hateFoodTag']])
            compare(kind, entry, 'likeBeverageTags', original['beverageTags'], [value['id'] for value in entry['likeBevTag']])
            compare(kind, entry, 'money', original['price'], [entry['moneyMin'], entry['moneyMax']])
        else:
            if entry['isLikeAllFoodTag']:
                non_dynamic_game_ids = {int(value) for value in game['idNameMaps']['foodTag'] if int(value) not in (-20, -21, -4)}
                original_ids = {value for value in original['positiveTags'] if value not in (-20, -21, -4)}
                missing = sorted(non_dynamic_game_ids - original_ids)
                coverage.setdefault('wildcardFoodTags', []).append({'id': item_id, 'name': entry['name'], 'gameIsLikeAllFoodTag': True, 'sourceFixedTagListCount': len(original_ids), 'gameMappedStaticTagCount': len(non_dynamic_game_ids), 'missingInEnumeratedTags': missing, 'extraInEnumeratedTags': sorted(original_ids - non_dynamic_game_ids)})
            else:
                compare(kind, entry, 'staticLikeFoodTags', [value for value in original['positiveTags'] if value not in (-20, -21)], [value['id'] for value in entry['likeFoodTag']])
            if not entry['isLikeAllBevTag']:
                compare(kind, entry, 'likeBeverageTags', original['beverageTags'], [value['id'] for value in entry['likeBevTag']])
    excluded = []
    for item_id in entries[kind].keys() - raw_by_id.keys():
        entry = entries[kind][item_id]
        excluded.append({field: entry.get(field) for field in ['id', 'name', 'group', 'hideInAlbum', 'isParticular', 'hideInNX', 'doNotShowInNightByDefault', 'doNotShowInNotebook']})
    coverage[kind] = {'sourceRows': len(raw_by_id), 'matchedGameIds': len(matched), 'missingFromCurrentGame': sorted(raw_by_id.keys() - entries[kind].keys()), 'gameRows': len(entries[kind]), 'gameRowsOutsideGuideScope': sorted(excluded, key=lambda entry: entry['id'])}

site_recipe_ids = {int(row['菜品ID']) for row in sheets['recipes']}
site_by_id = {int(row['菜品ID']): row for row in sheets['recipes']}
reverse_tags = {value: int(key) for key, value in mapping['FOOD_TAG'].items()}
default_differences = []
for item_id in site_recipe_ids & entries['food'].keys():
    entry = entries['food'][item_id]
    row = site_by_id[item_id]
    site_tags = {reverse_tags[tag] for tag in row['菜品标签'].split('、') if tag != '无'}
    cooked = effective(entry['tags'], entry['price'], entry['ingredientCount'])
    if site_tags != cooked:
        default_differences.append({'id': item_id, 'name': entry['name'], 'ingredientCount': entry['ingredientCount'], 'added': [mapping['FOOD_TAG'][str(tag)] for tag in sorted(cooked - site_tags)], 'removed': [mapping['FOOD_TAG'][str(tag)] for tag in sorted(site_tags - cooked)], 'gameSource': entry['source']})

summary = {'sourceKind': game['sourceKind'], 'gameBuild': game['gameBuild'], 'resourceVersion': game['gameVersionResourceLastLine'], 'sourceFile': SOURCE.relative_to(ROOT).as_posix(), 'sourceSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(), 'fieldsCompared': dict(checks), 'fieldDifferenceCount': len(differences), 'differences': differences, 'displayNameDifferenceCount': len(name_changes), 'displayNameDifferences': name_changes, 'coverage': coverage, 'defaultCookedTagDifferenceCount': len(default_differences), 'defaultCookedTagDifferences': sorted(default_differences, key=lambda entry: entry['id']), 'defaultTagRuleEvidence': 'Official profile tags, ingredients, price and tag names verified here; ingredient-count threshold comes from separate native/upstream/independent-source rule evidence, not from raw tags.', 'limitations': ['Profiles are parsed from installed original resource files without running game; run-time outcome not asserted.', 'Maps, unlock/acquisition, spell cards and dynamic reactions not all compared in this script.', 'Name differences can be abbreviations or normalized typography; do not automatically treat them as mismatched records.', 'isParticular/hideInAlbum are raw flags; extra profiles are story/variant/content scope questions, not automatically missing regular guests.']}
with (OUT / '当前游戏全量对照_01.json').open('x', encoding='utf-8') as stream:
    json.dump(summary, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
print(json.dumps({key: value for key, value in summary.items() if key not in ['defaultCookedTagDifferences', 'coverage']}, ensure_ascii=False, indent=2))
print('COVERAGE SUMMARY', json.dumps({key: {field: value for field, value in entry.items() if field != 'gameRowsOutsideGuideScope'} if isinstance(entry, dict) else entry for key, entry in coverage.items()}, ensure_ascii=False, indent=2))
