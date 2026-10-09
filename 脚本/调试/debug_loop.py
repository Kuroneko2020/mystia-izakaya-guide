# -*- coding: utf-8 -*-
import re
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_excel as b
text=(Path(r"待整理/2026-10-04--东方夜雀食堂攻略表/原始资料/bili_opus_579630987930616350.txt")).read_text(encoding='utf-8')
lines=[x.strip() for x in text.splitlines()]
known={g["name"] for g in b.special} | {"魔理沙","霖之助","妖梦","幽幽子","三妖精"}
out=[]
cur=None; field=None; started=False
for i,raw in enumerate(lines):
    if "【羁绊稀客】" in raw or "【非羁绊稀客】" in raw:
        started=True; out.append(f"{i}: START"); continue
    if not started: continue
    nm=b.normalize_name(raw)
    if nm in known:
        cur={"客人":nm}; out.append(f"{i}: NEW {nm}"); field=None; continue
    if cur is None: continue
    m=re.match(r"^[（(]持有金\s*[:：]?\s*([^）)]*)[）)]$", raw)
    if m:
        cur["持有金(攻略)"]=m.group(1); out.append(f"{i}: HOLD {m.group(1)} {raw!r}"); continue
    m=re.match(r"^(喜|厌)\s*[:：]\s*(.*)$", raw)
    if m:
        field=m.group(1); out.append(f"{i}: FIELD {field} {m.group(2)}"); continue
    out.append(f"{i}: OTHER cur={cur.get('客人')} field={field} raw={raw!r}")
    if i>75: break
Path(r"待整理/2026-10-04--东方夜雀食堂攻略表/中间数据/debug_loop.txt").write_text('\n'.join(out),encoding='utf-8')
