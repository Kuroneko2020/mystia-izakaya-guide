# -*- coding: utf-8 -*-
import json
from pathlib import Path
D=Path(__file__).resolve().parents[1]/'中间数据'
out=[]
for name in ['SPECIAL_GUEST_LIST','FOOD_LIST','BEVERAGE_LIST','INGREDIENT_LIST','DECORATION_LIST']:
    data=json.loads((D/f'{name}.json').read_text(encoding='utf-8'))
    recs=[r for r in data if r.get('dlc')==9]
    out.append(f'===== {name} dlc9 count={len(recs)}')
    for r in recs:
        out.append(json.dumps(r,ensure_ascii=False))
(D/'dlc9_report.txt').write_text('\n'.join(out),encoding='utf-8')
print('done')
