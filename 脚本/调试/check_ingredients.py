# -*- coding: utf-8 -*-
import json
from pathlib import Path
D=Path(__file__).resolve().parents[1]/'中间数据'
data=json.loads((D/'INGREDIENT_LIST.json').read_text(encoding='utf-8'))
out=[]
for r in data:
    if r.get('dlc')!=9:
        out.append(f"{r['id']}\t{r['name']}\tdlc{r.get('dlc')}\tlevel{r.get('level')}\tprice{r.get('price')}\ttags{r.get('tags')}")
(D/'ingredient_report.txt').write_text('\n'.join(out),encoding='utf-8')
# suspicious names
for r in data:
    if any(k in r['name'] for k in ['铃','仙','雪','舞','神','妖','魔']):
        print(r['id'],r['name'],r.get('dlc'),r.get('tags'))
