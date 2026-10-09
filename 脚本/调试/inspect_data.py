# -*- coding: utf-8 -*-
import json
from pathlib import Path
D = Path(__file__).resolve().parents[1] / '中间数据'
for name in ['SPECIAL_GUEST_LIST','FOOD_LIST','INGREDIENT_LIST','BEVERAGE_LIST','NORMAL_GUEST_LIST']:
    data = json.loads((D / f'{name}.json').read_text(encoding='utf-8'))
    print('='*20, name, len(data))
    for rec in data[:3]:
        print(json.dumps(rec, ensure_ascii=False)[:700])
    if name == 'SPECIAL_GUEST_LIST':
        for rec in data:
            if rec.get('name') == '秦心':
                print('--- 秦心 ---')
                print(json.dumps(rec, ensure_ascii=False, indent=2))
