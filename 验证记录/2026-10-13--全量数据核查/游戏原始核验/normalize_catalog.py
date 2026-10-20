"""Normalize only directly extracted installed-game profiles and Chinese tables.
No assistant/wiki/mod data is used. Outputs exclusive-create, no overwrite.
"""
import argparse, collections, json
from pathlib import Path


def read(path): return json.loads(path.read_text(encoding='utf-8'))


def emit(path, data):
    with path.open('x',encoding='utf-8') as f: json.dump(data,f,ensure_ascii=False,indent=2)


def normalize(root):
    langs=read(root/'game_chinese_language_texts.json')
    maps={k:{} for k in ['food','ingredient','beverage','foodTag','beverageTag','normalGuest','specialGuest','cooker']}
    language_sources={k:[] for k in maps}
    for row in langs:
        for t in row['texts']:
            name=t['name']
            category=next((k for suffix,k in [('FoodsLang','food'),('IngredientsLang','ingredient'),('IngredientsLang_2','ingredient'),('BeveragesLang','beverage'),('BeveragesLang_2','beverage'),('FoodTagsLang','foodTag'),('BeverageTagsLang','beverageTag'),('NormGuestLang','normalGuest'),('SpecGuestLang','specialGuest'),('CookersLang','cooker')] if name.endswith(suffix)),None)
            if category is None: continue
            language_sources[category].append({'source':row['source'],'sha256':row['sha256'],'textName':name,'path_id':t['path_id']})
            for line in t['text'].lstrip('\ufeff').splitlines()[1:]:
                parts=line.split('\t')
                if len(parts)<2: continue
                try: id_=int(parts[0])
                except ValueError: continue
                maps[category][id_]={'name':parts[1],'textColumns':parts[2:],'textAsset':name}
    profiles=[]
    for p in root.glob('*_raw.json'):
        if '_Core_raw' in p.name: continue
        d=read(p)
        if 'tree' in d and 'source' in d: profiles.append((p.name,d))
    recipes=[]
    cooker_types={}
    for filename,d in profiles:
        tree=d['tree']
        for r in tree.get('recipes',[]):
            recipes.append({'id':r['id'],'foodID':r['foodID'],'ingredients':r['ingredients'],'cookerType':r['cookerType'],'cookTime':r['cookTime'], 'source':{'profile':tree['m_Name'],'file':d['source'],'sha256':d['sha256'],'path_id':d['path_id']},'raw':r})
        for c in tree.get('cookers',[]):
            if 0<=c['id']<=4:
                lang=maps['cooker'].get(c['id'])
                if lang: cooker_types[c['type']]=lang['name']
    recipe_map=collections.defaultdict(list)
    for r in recipes: recipe_map[r['foodID']].append(r)
    entries=[]
    for filename,d in profiles:
        tree=d['tree']; name=tree['m_Name']
        source={'profile':name,'file':d['source'],'sha256':d['sha256'],'cab':d['cab'],'path_id':d['path_id'],'rawJson':filename}
        group='Core' if not name.startswith('DLC') else name.split('_')[0]
        lists=[]
        if 'sellables' in tree:
            typ='food' if 'FoodProfile' in name else 'beverage' if 'BeverageProfile' in name else None
            if typ: lists.append((typ,tree['sellables']))
        for typ,key in [('ingredient','ingredients'),('normalGuest','normalGuests'),('specialGuest','specialGuests')]:
            if key in tree: lists.append((typ,tree[key]))
        for typ,items in lists:
            for item in items:
                i=item['id']; lang=maps[typ].get(i,{})
                x={'id':i,'name':lang.get('name'), 'type':typ,'group':group,'source':source,'raw':item,'nameTextAsset':lang.get('textAsset')}
                if typ in ('food','ingredient','beverage'):
                    tagtype='beverageTag' if typ=='beverage' else 'foodTag'
                    tags=item['tags']; x.update({'price':item['baseValue'],'level':item['level'],'tags':tags,'tagNames':[maps[tagtype].get(t,{}).get('name') for t in tags],'rawTags':tags,'rawTagNames':[maps[tagtype].get(t,{}).get('name') for t in tags],'tagSemantics':'raw catalog tags; NOT cooked/effective tags','isCollab':item.get('isCollab'),'banTags':item.get('banTags'),'banTagNames':[maps[tagtype].get(t,{}).get('name') for t in item.get('banTags',[])]})
                    if typ=='food':
                        rs=recipe_map.get(i,[]); x['recipes']=rs
                        if len(rs)==1:
                            r=rs[0]; x.update({'ingredients':r['ingredients'],'ingredientNames':[maps['ingredient'].get(t,{}).get('name') for t in r['ingredients']],'ingredientCount':len(r['ingredients']),'cookerType':r['cookerType'],'cookerName':cooker_types.get(r['cookerType']),'cookTime':r['cookTime']})
                else:
                    for field,cat in [('likeFoodTag','foodTag'),('hateFoodTag','foodTag'),('likeBevTag','beverageTag')]:
                        vals=item.get(field)
                        if vals is None: x[field]=None; continue
                        x[field]=[{'id':v['tagId'],'name':maps[cat].get(v['tagId'],{}).get('name'),'weight':v['weight']} if isinstance(v,dict) else {'id':v,'name':maps[cat].get(v,{}).get('name')} for v in vals]
                    if typ=='normalGuest':
                        x.update({'fundMultiplier':item['fundMultiplier'],'money':None,'moneySemantics':'fundMultiplier is actual profile value; no fixed wallet amount inferred','doNotShowInNotebook':bool(item['doNotShowInNotebook']),'isChild':bool(item['isChild']),'isLikeAllFoodTag':bool(item['isLikeAllFoodTag']),'isLikeAllBevTag':bool(item['isLikeAllBevTag'])})
                    else:
                        x.update({'stringId':item['stringId'],'moneyMin':item['fundRange']['x'],'moneyMax':item['fundRange']['y'],'money':{'min':item['fundRange']['x'],'max':item['fundRange']['y']},'hideInAlbum':bool(item['hideInAlbum']),'isParticular':bool(item['isParticular']),'isCollabCharacter':bool(item['isCollabCharacter']),'hideInNX':bool(item['hideInNX']),'destination':item['destination'],'spawnType':item['spawnType'],'unifiedSpawnProb':item['unifiedSpawnProb'],'doNotShowInNightByDefault':bool(item['doNotShowInNightByDefault']),'doNotShowInChallenge':bool(item['doNotShowInChallenge'])})
                entries.append(x)
    counts=dict(collections.Counter(x['type'] for x in entries))
    unique={k:len({x['id'] for x in entries if x['type']==k}) for k in counts}
    visible={k:[x for x in entries if x['type']==k and ((x['id']!=-1) if k=='food' else (not x['doNotShowInNotebook']) if k=='normalGuest' else (not x['hideInAlbum']) if k=='specialGuest' else True)] for k in counts}
    payload={'schemaVersion':1,'sourceKind':'directly extracted official installed Unity game data, no assistant/wiki/mod catalog','gameBuild':'23158340','gameVersionResourceLastLine':'RELEASE 4.4.0e','tagSemantics':'entries.tags/rawTags are original serialized catalog tags; no dynamic cooked tags inferred','counts':counts,'uniqueIdCounts':unique,'visibleFlagCounts':{k:len(v) for k,v in visible.items()},'recipes':recipes,'entries':entries,'idNameMaps':{k:{str(i):v['name'] for i,v in values.items()} for k,values in maps.items()},'cookerTypeNames':cooker_types,'languageSources':language_sources,'limitations':['Current version is resource history endpoint and Steam installed build, not run-time launch validation or online latest-version check.','Hidden guest variants and special easter-egg ingredient are retained with raw flags and source; visible lists are literal profile visibility filtering, not user guide scope.','Dynamic price/cooking/ingredient-count/priority/popular-trend tags require additional native-method evidence; raw tags must not be presented as final cooked tags.','Normal guest profile has fundMultiplier but no fixed wallet range; none inferred.','Guest spawn profiles are raw configuration, not measured night visit probabilities.']}
    emit(root/'game_catalog_raw_normalized.json',payload)
    for typ,subset in visible.items():
        emit(root/('game_'+typ+'_visible_raw.json'),{'schemaVersion':1,'tagSemantics':payload['tagSemantics'],'entries':subset,'count':len(subset)})
    emit(root/'game_id_name_maps.json',{'idNameMaps':payload['idNameMaps'],'cookerTypeNames':cooker_types,'languageSources':language_sources})
    print('COUNTS',counts,'UNIQUE',unique,'VISIBLE',payload['visibleFlagCounts'])
    print('MISSING_NAMES',[(x['type'],x['id'],x.get('stringId')) for x in entries if x['name'] is None])
    print('BUDDHA',json.dumps([x for x in entries if x['type']=='food' and x['id']==1017],ensure_ascii=False))

if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('--input',type=Path,required=True)
    normalize(ap.parse_args().input)
