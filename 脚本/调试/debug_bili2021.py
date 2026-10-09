# -*- coding: utf-8 -*-
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_excel as b
rows=b.parse_bili_2021()
out=[]
for r in rows[:8]:
    out.append(repr(r))
Path(r'待整理/2026-10-04--东方夜雀食堂攻略表/中间数据/debug_bili2021.txt').write_text('\n'.join(out),encoding='utf-8')
