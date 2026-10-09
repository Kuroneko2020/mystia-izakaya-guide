# -*- coding: utf-8 -*-
import json
from pathlib import Path
D=Path(__file__).resolve().parents[1]/'中间数据'
for name in ['DECORATION_LIST','CLOTHES_LIST']:
    data=json.loads((D/f'{name}.json').read_text(encoding='utf-8'))
    print('====',name)
    for r in data:
        s=json.dumps(r,ensure_ascii=False)
        if 'Kokoro' in s or 'THYG' in s or r.get('name') in ('妖精服',):
            print(s)
