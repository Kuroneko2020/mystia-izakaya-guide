from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
GAME = ROOT / '验证记录/2026-10-13--全量数据核查/游戏原始核验/game_catalog_raw_normalized.json'
GAME_RULES = ROOT / '验证记录/2026-10-13--全量数据核查/游戏原始核验/FoodTagRuleProfile_raw.json'
BASELINE = ROOT / '中间数据/料亭版攻略数据基线.json'
MAPPING = ROOT / '验证记录/2026-10-13--全量数据核查/管线审计/上游与本地转换映射_01.json'
FOODS = ROOT / '中间数据/FOOD_LIST.json'

game = json.loads(GAME.read_text(encoding='utf-8'))
rules_raw = json.loads(GAME_RULES.read_text(encoding='utf-8'))
app = json.loads(BASELINE.read_text(encoding='utf-8'))
mapping = json.loads(MAPPING.read_text(encoding='utf-8'))
foods = json.loads(FOODS.read_text(encoding='utf-8'))
sheets = {key: [dict(zip(sheet['headers'], row)) for row in sheet['rows']] for key, sheet in app['sheets'].items()}
food_tags = {int(k): v for k, v in mapping['FOOD_TAG'].items()}
local_covers = [(row['coverer'], row['covered']) for row in mapping['TAG_COVERS']]
game_covers = [tuple(rule['rule']) for rule in rules_raw['tree']['rules']]
missing_covers = [pair for pair in game_covers if pair not in local_covers]
extra_covers = [pair for pair in local_covers if pair not in game_covers]

raw_food = {row['id']: row for row in foods if row.get('dlc', 0) != 9 and row['id'] != -1}
game_food = {row['id']: row for row in game['entries'] if row['type'] == 'food'}
site_recipe = {int(row['菜品ID']): row for row in sheets['recipes']}


def compose(food, cooked=True, covers=None):
    covers = local_covers if covers is None else covers
    result = set(food['positiveTags'])
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


def names(ids):
    return [food_tags[value] for value in sorted(ids)]


def static_labels(row):
    return {tag for tag in row.split('、') if tag and tag != '无' and '动态' not in tag and not tag.startswith('流行')}


all_covers = local_covers + missing_covers
cover_differences = []
for fid, food in raw_food.items():
    with_local = compose(food, covers=local_covers)
    with_game = compose(food, covers=all_covers)
    if with_local != with_game:
        cover_differences.append({'id': fid, 'name': food['name'], 'gameRawTags': names(set(food['positiveTags'])), 'siteEffectiveIfFixedLarge': names(with_local), 'gameRuleEffective': names(with_game), 'lostByGameRule': names(with_local - with_game), 'siteRowTags': site_recipe[fid]['菜品标签']})

beverages = [row for row in game['entries'] if row['type'] == 'beverage']
bev_expensive = [{'id': row['id'], 'name': row['name'], 'price': row['price']} for row in beverages if row['price'] > 60]
bev_economical = [{'id': row['id'], 'name': row['name'], 'price': row['price']} for row in beverages if row['price'] < 20]
guests = []
for table, key in [('guests', '客人名字'), ('normal', '普通客人')]:
    for row in sheets[table]:
        guests.append({'name': row[key], 'table': table, 'likes': static_labels(row['喜好料理标签']), 'hates': static_labels(row.get('厌恶料理标签', '')), 'bevLikes': static_labels(row['喜好酒水标签']), 'bevHates': static_labels(row.get('厌恶酒水标签', ''))})

bev_tag_impact = [g['name'] for g in guests if g['bevLikes'] & {'昂贵', '便宜', '实惠'} or g['bevHates'] & {'昂贵', '便宜', '实惠'}]

rec_changes = []
for fixed in [False, True]:
    pairs = {}
    for g in guests:
        for fid, food in raw_food.items():
            covers = all_covers if fixed else local_covers
            tags = {food_tags[v] for v in compose(food, cooked=True, covers=covers)}
            hits = g['likes'] & tags
            hates = g['hates'] & tags
            if hits and not hates:
                pairs[(g['name'], fid)] = (sorted(hits), len(hits))
    rec_changes.append(pairs)
old, new = rec_changes
removed = [{'guest': k[0], 'id': k[1], 'name': raw_food[k[1]]['name'], 'oldHits': old[k][0]} for k in old.keys() - new.keys()]
added = [{'guest': k[0], 'id': k[1], 'name': raw_food[k[1]]['name'], 'newHits': new[k][0]} for k in new.keys() - old.keys()]
changed = [{'guest': k[0], 'id': k[1], 'name': raw_food[k[1]]['name'], 'oldMatchCount': old[k][1], 'newMatchCount': new[k][1]} for k in old.keys() & new.keys() if old[k][1] != new[k][1]]

addon_flip = []
for fid, food in raw_food.items():
    if len(food['recipes'][0]['ingredients']) != 4:
        continue
    base = compose(food, cooked=True)
    flipped = compose(food, cooked=True)
    flipped.add(-1)
    for coverer, covered in all_covers:
        if coverer in flipped:
            flipped.discard(covered)
    if base != flipped:
        row = site_recipe[fid]
        addon_flip.append({'id': fid, 'name': food['name'], 'before': names(base), 'afterOneExtra': names(flipped), 'changed': {'added': names(flipped - base), 'removed': names(base - flipped)}, 'ingredients': row['主料'], 'siteConflictTags': row['冲突标签（加料会变黑暗物质）']})

flip_hate_impact = []
for entry in addon_flip:
    after = set(entry['afterOneExtra'])
    before = set(entry['before'])
    for g in guests:
        newly_hated = (after & g['hates']) - (before & g['hates'])
        lost_like = (before & g['likes']) - (after & g['likes'])
        if newly_hated or lost_like:
            flip_hate_impact.append({'guest': g['name'], 'recipe': entry['name'], 'newlyHatedTags': sorted(newly_hated), 'lostLikeTags': sorted(lost_like)})

summary = {
    'gameCoverRules': [[food_tags.get(a, a), food_tags.get(b, b)] for a, b in game_covers],
    'localCoverRules': [[food_tags.get(a, a), food_tags.get(b, b)] for a, b in local_covers],
    'missingCoverRulesInSite': [[food_tags.get(a, a), food_tags.get(b, b)] for a, b in missing_covers],
    'extraCoverRulesInSite': [[food_tags.get(a, a), food_tags.get(b, b)] for a, b in extra_covers],
    'coverRuleDifferenceCount': len(cover_differences),
    'coverRuleDifferences': cover_differences,
    'recommendationImpactOfCoverRule': {'removed': removed, 'added': added, 'changedMatchCount': changed},
    'beveragePriceTagRule': {
        'gameNative': 'GameAssembly.dll Sellable.get_PriceTag: price < 20 adds -2, price > 60 adds -3 (strict; 20/60 do not trigger); Sellable is shared base of Food and Beverage',
        'foodImplementedLocally': True,
        'beverageImplementedLocally': False,
        'beverageTagNameNote': 'game beverage tag -2 is named 便宜, food tag -2 is named 实惠',
        'expensiveBeverages': bev_expensive,
        'economicalBeverages': bev_economical,
        'guestPreferenceImpact': bev_tag_impact,
        'impact': 'no guest references these tags in beverage preferences, so recommendation sets unchanged; beverage catalog display may lack these tags if the game derives them',
    },
    'fourIngredientOneExtraFlip': {
        'rule': 'total ingredient count (base + extra) >= 5 adds 大份 (-1), which covers 小巧 (28)',
        'affectedDishCount': len(addon_flip),
        'dishes': addon_flip,
        'guestImpact': flip_hate_impact,
    },
    'contextOnlyTagsNotInStaticCatalog': {
        'tags': [[-30, food_tags.get(-30, '厨具「夜雀」')], [-9, '煮锅'], [-8, '烧烤架'], [-7, '油锅'], [-6, '蒸锅'], [-5, '料理台'], [-4, '黑暗物质'], [-20, '流行·喜爱'], [-21, '流行·厌恶']],
        'note': 'cooker-derived / popular-trend / dark-matter tags depend on cooking context or daily state; no guest profile likes or hates the cooker tags -30..-5, so static omission has no recommendation impact',
    },
}
with (OUT / '覆盖规则与其他漏标_01.json').open('x', encoding='utf-8') as stream:
    json.dump(summary, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
print(json.dumps({k: v for k, v in summary.items() if k not in ['fourIngredientOneExtraFlip', 'beveragePriceTagRule']}, ensure_ascii=False, indent=2))
print('BEV', len(bev_expensive), 'expensive /', len(bev_economical), 'economical; guest refs:', bev_tag_impact)
print('FLIP DISHES', len(addon_flip), 'GUEST IMPACT ROWS', len(flip_hate_impact))
