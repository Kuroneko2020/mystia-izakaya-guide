# -*- coding: utf-8 -*-
import json
from collections import Counter
from pathlib import Path
D=Path(__file__).resolve().parents[1]/'中间数据'
for name in ['SPECIAL_GUEST_LIST','NORMAL_GUEST_LIST','FOOD_LIST','BEVERAGE_LIST','INGREDIENT_LIST','DECORATION_LIST','CLOTHES_LIST']:
    data=json.loads((D/f'{name}.json').read_text(encoding='utf-8'))
    c=Counter(r.get('dlc',0) for r in data)
    print(name, 'total',len(data),'by_dlc',dict(sorted(c.items(), key=lambda x: str(x[0]))))
    if name=='SPECIAL_GUEST_LIST':
        for r in data:
            if r.get('dlc')==9:
                print('  dlc9:',r['id'],r['name'])
        print('  official names:', [r['name'] for r in data if r.get('dlc')!=9])
