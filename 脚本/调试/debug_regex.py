# -*- coding: utf-8 -*-
import re
from pathlib import Path
text=(Path(r"待整理/2026-10-04--东方夜雀食堂攻略表/原始资料/bili_opus_579630987930616350.txt")).read_text(encoding='utf-8')
lines=[x.strip() for x in text.splitlines()]
out=[]
for i in range(60,70):
    raw=lines[i]
    out.append(f"{i}: {raw!r}")
    m=re.match(r"^[（(]持有金\s*[:：]?\s*([^）)]*)[）)]$", raw)
    out.append('  hold match: '+repr(m.groups() if m else None))
    m2=re.match(r"^(喜|厌)\s*[:：]\s*(.*)$", raw)
    out.append('  like match: '+repr(m2.groups() if m2 else None))
Path(r"待整理/2026-10-04--东方夜雀食堂攻略表/中间数据/debug_regex.txt").write_text('\n'.join(out),encoding='utf-8')
