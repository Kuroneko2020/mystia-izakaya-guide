# -*- coding: utf-8 -*-
import json
from pathlib import Path
from collections import Counter
D=Path(__file__).resolve().parents[1]/'中间数据'
out=[]
for name in ['FOOD_LIST','INGREDIENT_LIST','BEVERAGE_LIST','DECORATION_LIST']:
    data=json.loads((D/f'{name}.json').read_text(encoding='utf-8'))
    keys=Counter()
    subkeys=Counter()
    for r in data:
        f=r.get('from')
        if isinstance(f,dict):
            for k,v in f.items():
                keys[k]+=1
                if isinstance(v,dict):
                    for k2 in v: subkeys[f'{k}.{k2}']+=1
                elif isinstance(v,list) and v and isinstance(v[0],dict):
                    for k2 in v[0]: subkeys[f'{k}[].{k2}']+=1
    out.append(f'===== {name}')
    out.append('from keys: '+repr(keys))
    out.append('sub keys: '+repr(subkeys))
(D/'key_report.txt').write_text('\n'.join(out),encoding='utf-8')
print('done')
