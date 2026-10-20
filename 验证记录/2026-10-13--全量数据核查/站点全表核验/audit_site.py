from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from datetime import datetime
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
HTML = ROOT / '成品/东方夜雀食堂攻略查询_2610112307.html'
BASELINE = ROOT / '中间数据/料亭版攻略数据基线.json'
WORKBOOK = ROOT / '成品/东方夜雀食堂_客人攻略查询表_v4.4.0_2026-10-04.xlsx'
MAPPING = ROOT / '验证记录/2026-10-13--全量数据核查/管线审计/上游与本地转换映射_01.json'


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def stamp(path):
    raw = path.read_bytes()
    return {'path': path.relative_to(ROOT).as_posix(), 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}


def save(name, data):
    with (OUT / name).open('x', encoding='utf-8') as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


mapping = load(MAPPING)
food_tags = {int(k): v for k, v in mapping['FOOD_TAG'].items()}
drink_tags = {int(k): v for k, v in mapping['BEVERAGE_TAG'].items()}
covers = [(row['coverer'], row['covered']) for row in mapping['TAG_COVERS']]
raw = {key: load(ROOT / f'中间数据/{key}.json') for key in ['FOOD_LIST', 'INGREDIENT_LIST', 'BEVERAGE_LIST', 'SPECIAL_GUEST_LIST', 'NORMAL_GUEST_LIST']}
html = HTML.read_text(encoding='utf-8')
match = re.search(r'<script id="app-data" type="application/json">(.*?)</script>', html, re.S)
if not match:
    raise ValueError('app-data not found')
app = json.loads(match.group(1).replace('<\\/', '</'))
baseline = load(BASELINE)
sheets = {key: [dict(zip(sheet['headers'], row)) for row in sheet['rows']] for key, sheet in app['sheets'].items()}
issues = []
checks = Counter()


def version(value):
    if value == 0:
        return '本篇'
    if value == 2.5:
        return 'DLC2.5'
    return f'DLC{value}'


def labels(values, table=food_tags, dynamic=False):
    return '、'.join(table[value] + ('（动态）' if dynamic and value in (-20, -21) else '') for value in sorted(set(values))) or '无'


def process(food, cooked=False):
    result = set(food['positiveTags'])
    if food['id'] != -1:
        if food['price'] > 60:
            result.add(-3)
        elif food['price'] < 20:
            result.add(-2)
    if cooked and len(food['recipes'][0]['ingredients']) >= 5:
        result.add(-1)
    for coverer, covered in covers:
        if coverer in result:
            result.discard(covered)
    return result


def check(table, row, field, expected):
    checks[table] += 1
    actual = row.get(field)
    if actual != str(expected):
        issues.append({'table': table, 'entry': row.get('菜品') or row.get('食材') or row.get('酒水') or row.get('客人名字') or row.get('普通客人'), 'field': field, 'actual': actual, 'expected': str(expected)})


def tokens(value):
    return set(re.split(r'[、,，/]', value)) - {'', '无', '未收录'}


def static_tokens(value):
    return {tag for tag in tokens(value) if '动态' not in tag and not tag.startswith('流行')}


raw_food = {row['id']: row for row in raw['FOOD_LIST'] if row.get('dlc', 0) != 9 and row['id'] != -1}
raw_ing = {row['id']: row for row in raw['INGREDIENT_LIST'] if row.get('dlc', 0) != 9}
raw_drink = {row['id']: row for row in raw['BEVERAGE_LIST'] if row.get('dlc', 0) != 9}
raw_guests = {row['name']: row for row in raw['SPECIAL_GUEST_LIST'] if row.get('dlc', 0) != 9}
raw_normal = {row['name']: row for row in raw['NORMAL_GUEST_LIST'] if row.get('dlc', 0) != 9}
indexes = {}
coverage = {}
for table, key, source in [('recipes', '菜品ID', raw_food), ('ingredients', '食材ID', raw_ing), ('beverages', '酒水ID', raw_drink), ('guests', '客人名字', raw_guests), ('normal', '普通客人', raw_normal)]:
    values = [int(row[key]) if key.endswith('ID') else row[key] for row in sheets[table]]
    indexes[table] = dict(zip(values, sheets[table]))
    coverage[table] = {'actualRows': len(values), 'sourceRows': len(source), 'missing': sorted(set(source) - set(values)), 'extra': sorted(set(values) - set(source)), 'duplicates': [value for value, n in Counter(values).items() if n > 1]}

for fid, food in raw_food.items():
    row = indexes['recipes'][fid]
    for field, expected in [('菜品', food['name']), ('所属版本', version(food.get('dlc', 0))), ('等级', food['level']), ('价格', food['price']), ('描述', food['description']), ('菜品标签', labels(process(food))), ('冲突标签（加料会变黑暗物质）', labels(food['negativeTags']))]:
        check('recipes', row, field, expected)
    recipe = food['recipes'][0]
    check('recipes', row, '厨具', mapping['COOKER_TYPE_LABEL'][str(recipe['cookerType'])])
    check('recipes', row, '主料', '＋'.join(raw_ing[value]['name'] for value in recipe['ingredients']))

for iid, ingredient in raw_ing.items():
    row = indexes['ingredients'][iid]
    for field, expected in [('食材', ingredient['name']), ('所属版本', version(ingredient.get('dlc', 0))), ('等级', ingredient['level']), ('价格', ingredient['price']), ('描述', ingredient['description']), ('标签', labels(ingredient['tags'])), ('类型', mapping['ING_TYPE'][str(ingredient['type'])])]:
        check('ingredients', row, field, expected)

for bid, drink in raw_drink.items():
    row = indexes['beverages'][bid]
    for field, expected in [('酒水', drink['name']), ('所属版本', version(drink.get('dlc', 0))), ('等级', drink['level']), ('价格', drink['price']), ('描述', drink['description']), ('标签', labels(drink['tags'], drink_tags))]:
        check('beverages', row, field, expected)

for table, source in [('guests', raw_guests), ('normal', raw_normal)]:
    for name, guest in source.items():
        row = indexes[table][name]
        for field, expected in [('所属版本', version(guest.get('dlc', 0))), ('出没地点', '、'.join(mapping['MAP'][value]['label'] for value in guest['maps'])), ('喜好料理标签', labels(guest['positiveTags'], dynamic=True)), ('喜好酒水标签', labels(guest['beverageTags'], drink_tags))]:
            check(table, row, field, expected)
        if table == 'guests':
            low, high = guest['price']
            budget = f'{low}（固定）' if low == high else f'{low}-{high}'
            kind = '联动角色' if guest.get('collaboration') else '特殊顾客' if name in mapping['SPECIAL_TYPE_NAMES'] else '本篇稀客' if guest.get('dlc', 0) == 0 else version(guest['dlc']) + '稀客'
            for field, expected in [('厌恶料理标签', labels(guest['negativeTags'], dynamic=True)), ('持有金', budget), ('类型', kind), ('拿手菜/额外喜好标签', '；'.join(f'{food_tags[int(k)]}：{v}' for k, v in guest.get('positiveTagMapping', {}).items()) or '无')]:
                check(table, row, field, expected)

recipes_by_name = {row['菜品']: row for row in sheets['recipes']}
full_ingredients = Counter(value for food in raw_food.values() for recipe in food['recipes'] for value in recipe['ingredients'])
missing_references = [value for value in full_ingredients if value not in raw_ing]
detail_issues = []
default_tag_changes = []
for fid, food in raw_food.items():
    old = process(food)
    new = process(food, cooked=True)
    if old != new:
        default_tag_changes.append({'id': fid, 'name': food['name'], 'version': version(food.get('dlc', 0)), 'ingredientCount': len(food['recipes'][0]['ingredients']), 'ingredients': indexes['recipes'][fid]['主料'], 'addedTags': labels(new - old), 'removedTags': labels(old - new), 'actualTags': indexes['recipes'][fid]['菜品标签'], 'expectedDefaultCookedTags': labels(new)})
changed_by_name = {row['name']: row for row in default_tag_changes}
legacy_affected = []
legacy_recommendation_errors = []
for i, detail in enumerate(sheets['details'], 2):
    name = detail['菜品']
    guest = indexes['guests'].get(detail['客人名字'])
    recipe = recipes_by_name.get(name)
    if not guest or not recipe:
        detail_issues.append({'row': i, 'guest': detail['客人名字'], 'name': name, 'problem': 'reference missing'})
        continue
    for field in ['价格', '所属版本', '厨具', '主料', '菜品标签', '解锁来源']:
        if detail[field] != recipe[field]:
            detail_issues.append({'row': i, 'guest': detail['客人名字'], 'name': name, 'field': field, 'actual': detail[field], 'recipe': recipe[field]})
    tags = static_tokens(detail['菜品标签'])
    hits = static_tokens(guest['喜好料理标签']) & tags
    hates = static_tokens(guest['厌恶料理标签']) & tags
    if tokens(detail['命中喜好']) != hits or int(detail['游戏积分']) != len(hits) - len(hates):
        detail_issues.append({'row': i, 'guest': detail['客人名字'], 'name': name, 'problem': 'old hit/score inconsistent', 'expectedHits': sorted(hits), 'actualHits': detail['命中喜好']})
    if name in changed_by_name:
        new_tags = static_tokens(changed_by_name[name]['expectedDefaultCookedTags'])
        new_hates = static_tokens(guest['厌恶料理标签']) & new_tags
        new_hits = static_tokens(guest['喜好料理标签']) & new_tags
        change = {'row': i, 'guest': detail['客人名字'], 'phase': detail['阶段'], 'recipe': name, 'oldHits': sorted(hits), 'newHits': sorted(new_hits), 'newHates': sorted(new_hates), 'oldScore': detail['游戏积分'], 'newTagScore': len(new_hits) - len(new_hates), 'extraIngredientSuggestion': detail['加料建议'], 'ingredientCount': changed_by_name[name]['ingredientCount']}
        legacy_affected.append(change)
        if new_hates:
            legacy_recommendation_errors.append(change)

relations = {}
for corrected in [False, True]:
    pairs = {}
    for table in ['guests', 'normal']:
        for guest in sheets[table]:
            name = guest.get('客人名字') or guest['普通客人']
            likes = static_tokens(guest['喜好料理标签'])
            hates = static_tokens(guest.get('厌恶料理标签', ''))
            for recipe in sheets['recipes']:
                fid = int(recipe['菜品ID'])
                tags = {food_tags[value] for value in process(raw_food[fid], cooked=corrected)}
                hits = likes & tags
                if not hits or hates & tags:
                    continue
                pairs[(name, fid)] = {'guest': name, 'guestType': table, 'id': fid, 'recipe': recipe['菜品'], 'hits': sorted(hits), 'matchCount': len(hits)}
    relations[corrected] = pairs
old, new = relations[False], relations[True]
removed = [dict(old[pair], newlyConflictingTags=['大份']) for pair in old.keys() - new.keys()]
added = [new[pair] for pair in new.keys() - old.keys()]
score_changed = [dict(new[pair], oldHits=old[pair]['hits'], oldMatchCount=old[pair]['matchCount']) for pair in old.keys() & new.keys() if old[pair]['hits'] != new[pair]['hits']]
relation_summary = {'oldTotal': len(old), 'newDefaultCookedTotal': len(new), 'removed': len(removed), 'added': len(added), 'retainedWithChangedMatchCount': len(score_changed), 'removedByGuest': dict(Counter(row['guest'] for row in removed)), 'removedByRecipe': dict(Counter(row['recipe'] for row in removed)), 'affectedGuests': sorted({row['guest'] for row in removed + added + score_changed})}

buddha = {'recipe': indexes['recipes'][1017], 'defaultCookingChange': changed_by_name['幻想佛跳墙'], 'incorrectRecommendations': [row for row in removed if row['id'] == 1017], 'changedMatchCounts': [row for row in score_changed if row['id'] == 1017], 'legacyRows': [row for row in legacy_affected if row['recipe'] == '幻想佛跳墙']}

workbook_sheets = {'guests': '客人总表', 'details': '推荐菜谱明细', 'recipes': '菜谱速查', 'ingredients': '食材速查', 'beverages': '酒水速查', 'normal': '普通客人', 'new440': '4.4.0新增内容', 'guide2024': 'B站2024攻略对照', 'guide2021': 'B站2021攻略对照', 'sources': '版本与数据来源'}
workbook = openpyxl.load_workbook(WORKBOOK, read_only=True, data_only=False)
workbook_checks = {}
workbook_differences = []
formula_count = 0
error_cells = []
for key, name in workbook_sheets.items():
    ws = workbook[name]
    source = list(ws.iter_rows(values_only=True))
    source = [[str(value).strip() if value is not None else '' for value in row] for row in source]
    target = [app['sheets'][key]['headers']] + app['sheets'][key]['rows']
    workbook_checks[key] = {'workbookRowsIncludingHeader': len(source), 'htmlRowsIncludingHeader': len(target), 'same': source == target}
    for i, (a, b) in enumerate(zip(source, target), 1):
        for j, (x, y) in enumerate(zip(a, b), 1):
            if x != y:
                workbook_differences.append({'sheet': name, 'row': i, 'column': j, 'workbook': x, 'html': y})
for ws in workbook.worksheets:
    for row in ws:
        for cell in row:
            if cell.data_type == 'f':
                formula_count += 1
            if cell.data_type == 'e':
                error_cells.append({'sheet': ws.title, 'cell': cell.coordinate, 'value': cell.value})
workbook.close()

summary = {'observedAt': datetime.now().astimezone().isoformat(), 'scope': 'read-only original live 2610112307; source consistency and default cooking large-partition simulation; no game files changed; no live data corrected', 'inputs': [stamp(path) for path in [HTML, BASELINE, WORKBOOK, MAPPING] + [ROOT / f'中间数据/{key}.json' for key in raw]], 'appDataEqualsBaseline': app == baseline, 'coverage': coverage, 'sourceFieldsChecked': dict(checks), 'sourceFieldDifferences': len(issues), 'brokenIngredientReferences': missing_references, 'multipleOfficialRecipes': [food['id'] for food in raw_food.values() if len(food['recipes']) != 1], 'defaultFiveIngredientRecipeCount': sum(len(food['recipes'][0]['ingredients']) >= 5 for food in raw_food.values()), 'defaultCookedTagDifferences': len(default_tag_changes), 'legacyDetails': {'rows': len(sheets['details']), 'internalDifferences': len(detail_issues), 'affectedByDefaultCookedTagChange': len(legacy_affected), 'nowConflictingWithGuestHates': len(legacy_recommendation_errors)}, 'recommendations': relation_summary, 'workbook': {'comparisons': workbook_checks, 'cellDifferences': len(workbook_differences), 'formulaCount': formula_count, 'errorCells': error_cells}, 'limitations': ['Raw JSON and HTML are not independent sources; source consistency does not prove in-game correctness.', 'Only no-extra-ingredient static default cooked tags simulated. Popular trends, title effects, spell cards, total meal affordability and user cooking outcomes not verified here.', 'Source/acquisition text semantics checked separately in pipeline audit.', 'Historical guide2024 and guide2021 texts are archived evidence, not current authoritative catalogs.']}
save('站点全表核查摘要_01.json', summary)
save('源字段与关联一致性差异_01.json', {'sourceFields': issues, 'details': detail_issues, 'workbook': workbook_differences})
save('全部默认成餐漏标_01.json', default_tag_changes)
save('全量推荐影响_01.json', {'summary': relation_summary, 'removed': sorted(removed, key=lambda row: (row['guest'], row['id'])), 'added': sorted(added, key=lambda row: (row['guest'], row['id'])), 'retainedWithChangedMatchCount': sorted(score_changed, key=lambda row: (row['guest'], row['id']))})
save('历史推荐明细受影响项_01.json', {'affected': legacy_affected, 'conflicting': legacy_recommendation_errors})
save('佛跳墙端到端核查_01.json', buddha)
print(json.dumps(summary, ensure_ascii=False, indent=2))
print('BUDDHA', json.dumps(buddha, ensure_ascii=False, indent=2))
