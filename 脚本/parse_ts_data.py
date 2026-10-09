# -*- coding: utf-8 -*-
"""从夜雀助手（AnYiEE/touhou-mystia-izakaya-assistant）的 TS 数据文件中提取数组，
转为 JSON，便于制作离线 Excel 查询表。
仅做数据格式转换，不修改原始仓库文件。
"""
import json
import re
from pathlib import Path

import json5

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "原始资料" / "repos" / "touhou-mystia-izakaya-assistant" / "app" / "domain" / "data"
OUT = ROOT / "中间数据"
OUT.mkdir(parents=True, exist_ok=True)


def extract_array(text: str, name: str) -> str:
    """提取 export const NAME = [ ... ] 的数组字面量（含方括号）。"""
    m = re.search(r"export\s+const\s+" + re.escape(name) + r"\s*=\s*", text)
    if not m:
        raise ValueError(f"{name} not found")
    start = text.index("[", m.end())
    depth = 0
    i = start
    quote = None
    template = False
    escaped = False
    line_comment = False
    block_comment = False
    while i < len(text):
        c = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if line_comment:
            if c == "\n":
                line_comment = False
            i += 1
            continue
        if block_comment:
            if c == "*" and nxt == "/":
                block_comment = False
                i += 2
                continue
            i += 1
            continue
        if quote:
            if escaped:
                escaped = False
            elif c == "\\":
                escaped = True
            elif c == quote:
                quote = None
            i += 1
            continue
        if template:
            if escaped:
                escaped = False
            elif c == "\\":
                escaped = True
            elif c == "`":
                template = False
            i += 1
            continue
        if c == "/" and nxt == "/":
            line_comment = True
            i += 2
            continue
        if c == "/" and nxt == "*":
            block_comment = True
            i += 2
            continue
        if c in ("'", '"'):
            quote = c
            i += 1
            continue
        if c == "`":
            template = True
            i += 1
            continue
        if c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
        i += 1
    raise ValueError(f"{name} unmatched brackets")


def strip_function_calls(text: str, func_name: str) -> str:
    """把形如 createKourindouPurchase(...) 的调用替换为 {}，便于 JSON5 解析。"""
    needle = func_name + "("
    while True:
        idx = text.find(needle)
        if idx < 0:
            return text
        depth = 0
        i = idx + len(func_name)
        quote = None
        escaped = False
        while i < len(text):
            c = text[i]
            if quote:
                if escaped:
                    escaped = False
                elif c == "\\":
                    escaped = True
                elif c == quote:
                    quote = None
            else:
                if c in ("'", '"'):
                    quote = c
                elif c == "(":
                    depth += 1
                elif c == ")":
                    depth -= 1
                    if depth == 0:
                        break
            i += 1
        if i >= len(text):
            raise ValueError(f"unmatched call {func_name}")
        text = text[:idx] + "{}" + text[i + 1 :]


def replace_template(match: re.Match) -> str:
    """把 JS 模板字符串转为 JSON 字符串，替换已知/未知 ${...}。"""
    s = match.group(0)[1:-1]
    s = s.replace("${LABEL_MAP.br}", "{{br}}")
    s = re.sub(r"\$\{[^}]*\}", "", s)
    return json.dumps(s, ensure_ascii=False)


def parse_array(name: str, filename: str):
    text = (SRC / filename).read_text(encoding="utf-8")
    literal = extract_array(text, name)
    literal = strip_function_calls(literal, "createKourindouPurchase")
    # 处理数组字面量中引用的少量常量（仅黑暗物质配方使用）。
    literal = literal.replace("DARK_MATTER_META_MAP.name", json.dumps("黑暗物质", ensure_ascii=False))
    literal = literal.replace("DARK_MATTER_META_MAP.positiveTag", "-4")
    literal = literal.replace("DARK_MATTER_META_MAP.price", "1")
    # JSON5 不允许裸数字键（JS 允许），例如 positiveTagMapping: { 18: '生肉...' }。
    # 也处理计算属性键 [-2]、[-3] 等写法。
    literal = re.sub(r"\[\s*(-?\d+)\s*\]\s*:", r'"\1":', literal)
    literal = re.sub(r"(?<![\w\"'])(-?\d+)\s*:", r'"\1":', literal)
    literal = re.sub(r"`(?:[^`\\]|\\.)*`", replace_template, literal, flags=re.S)
    return json5.loads(literal)


TABLES = {
    "FOOD_LIST": "foods/records.ts",
    "INGREDIENT_LIST": "ingredients/records.ts",
    "BEVERAGE_LIST": "beverages/records.ts",
    "SPECIAL_GUEST_LIST": "guests/special/records.ts",
    "NORMAL_GUEST_LIST": "guests/normal/records.ts",
    "DECORATION_LIST": "decorations/records.ts",
    "CLOTHES_LIST": "clothes/records.ts",
    "COOKER_LIST": "cookers/records.ts",
    "COLLECTION_POINT_REFRESH_FACTS": "places/collectionFacts.ts",
}


def main() -> None:
    summary = []
    for name, filename in TABLES.items():
        data = parse_array(name, filename)
        (OUT / f"{name}.json").write_text(
            json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        summary.append(f"{name}: {len(data)} 条 <- {filename}")
    print("\n".join(summary))


if __name__ == "__main__":
    main()
