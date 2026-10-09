# -*- coding: utf-8 -*-
"""输出客人清单摘要，用于人工核对数据。"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "中间数据"


def parse_tag_map(filename: str, block: str):
    text = (ROOT / "原始资料" / "repos" / "touhou-mystia-izakaya-assistant" / "app" / "domain" / "data" / filename).read_text(
        encoding="utf-8"
    )
    m = re.search(r"export\s+const\s+" + re.escape(block) + r"\s*=\s*\{(.*?)\}\s*as const", text, re.S)
    if not m:
        raise ValueError(block)
    return {int(k): v for k, v in re.findall(r"\[?(-?\d+)\]?\s*:\s*'([^']*)'", m.group(1))}


FOOD_TAG = parse_tag_map("tags/tagFacts.ts", "FOOD_TAG_MAP")
BEVERAGE_TAG = parse_tag_map("tags/tagFacts.ts", "BEVERAGE_TAG_MAP")


def tags(ids, mapping):
    return "/".join(mapping.get(i, f"<{i}>") for i in ids) or "无"


def main():
    lines = []
    special = json.loads((DATA / "SPECIAL_GUEST_LIST.json").read_text(encoding="utf-8"))
    normal = json.loads((DATA / "NORMAL_GUEST_LIST.json").read_text(encoding="utf-8"))
    lines.append(f"特殊/稀客：{len(special)} 名")
    for g in special:
        lines.append(
            f"[{g['id']}] {g['name']} | DLC{g['dlc']}"
            + (f" | 联动:{g.get('collaboration')}" if g.get("collaboration") else "")
            + f" | 钱:{g['price'][0]}-{g['price'][1]}"
            + f" | 出没:{','.join(g['maps'])}"
            + f" | 喜:{tags(g['positiveTags'], FOOD_TAG)}"
            + f" | 厌:{tags(g['negativeTags'], FOOD_TAG)}"
            + f" | 酒:{tags(g['beverageTags'], BEVERAGE_TAG)}"
            + f" | 拿手:{ {FOOD_TAG.get(int(k), k): v for k, v in g.get('positiveTagMapping', {}).items()} }"
        )
    lines.append("")
    lines.append(f"普通客人：{len(normal)} 名")
    for g in normal:
        lines.append(
            f"[{g['id']}] {g['name']} | DLC{g['dlc']}"
            + f" | 出没:{','.join(g['maps'])}"
            + f" | 喜:{tags(g['positiveTags'], FOOD_TAG)}"
            + f" | 酒:{tags(g['beverageTags'], BEVERAGE_TAG)}"
        )
    out = DATA / "guest_summary.txt"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()
