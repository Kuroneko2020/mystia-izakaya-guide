"""Read-only public-source audit; only --save writes new evidence files (exclusive create)."""
from pathlib import Path
import argparse
import json
import re
from collections import Counter
from bs4 import BeautifulSoup

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]
URL_ROOT = "https://thbwiki.cc/东方夜雀食堂_-_Touhou_Mystia%27s_Izakaya/攻略/"
ALIASES = {
    "海鲜味增汤": "海鲜味噌汤", "真海鲜味噌汤": "真·海鲜味噌汤", "真•海鲜味增汤": "真·海鲜味噌汤",
    "真·海鲜味增汤": "真·海鲜味噌汤", "真・海鲜味噌汤": "真·海鲜味噌汤",
    "海带": "海苔", "银杏": "白果", "“大冰棍儿！”": "大冰棍儿", "大冰棍儿！": "大冰棍儿",
    "梅蒂欣": "梅蒂欣·梅兰可莉", "梅蒂欣": "梅蒂欣·梅兰可莉",
    "大冰棍儿!": "大冰棍儿", "薜茘": "薜荔", "噗噗哟果": "噗噗呦果",
    "山佬": "山姥", "谜之人形": "迷之人形", "村纱水密": "村纱水蜜",
}


def clean_name(value):
    value = re.sub(r"\(DLC\d+\)", "", value)
    value = re.sub(r"文件:.*", "", value).strip()
    return ALIASES.get(value, value)


def tags(value, drop_popularity=False):
    value = re.sub(r"（东方夜雀食堂食材）\.png", "", value)
    value = re.sub(r"流行[•·・]?喜爱", "流行·喜爱", value)
    value = re.sub(r"流行[•·・]?厌恶", "流行·厌恶", value)
    result = {x.strip() for x in re.split(r"[,，、]", value) if x.strip() not in {"", "无", "-", "—"}}
    if drop_popularity:
        result -= {"流行·喜爱", "流行·厌恶"}
    return sorted(result)


def parse_snapshot(file, kind):
    text = file.read_text(encoding="utf-8")
    result = []
    pattern = r'^      - row(?: "[^\n]*")?(?::)?$'
    markers = list(re.finditer(pattern, text, re.M))
    for index, m in enumerate(markers):
        block = text[m.end():markers[index + 1].start() if index + 1 < len(markers) else text.index("    - rowgroup", m.end())]
        cells = list(re.finditer(r'^        - cell(?: "(.*)")?(?::)?$', block, re.M))
        if not cells:
            continue
        fields = []
        for j, c in enumerate(cells):
            children = block[c.end():cells[j + 1].start() if j + 1 < len(cells) else len(block)]
            fields.append({"text": (c.group(1) or "").replace('\\"', '"'), "children": children,
                           "line": text[:m.end() + c.start()].count("\n") + 1})
        n = re.search(r'^          - (?:generic|text): (.*)$', fields[0]["children"], re.M)
        name = n.group(1) if n else fields[0]["text"].split(" ")[0]
        name = clean_name(name)
        base = {"name": name, "sourceFile": str(file), "sourceLine": text[:m.start()].count("\n") + 1,
                "rawCells": [f["text"] for f in fields]}
        if kind == "recipes":
            assert len(fields) == 9, (name, len(fields))
            ingredients = re.findall(r'^          - link "([^\n]*)":$', fields[3]["children"], re.M)
            base.update(price=fields[2]["text"], cooker=fields[1]["text"], ingredients=ingredients,
                        tags=tags(fields[4]["text"]), negativeTags=tags(fields[5]["text"]),
                        cookTime=fields[6]["text"], unlock=fields[7]["text"], description=fields[8]["text"])
        elif kind == "ingredients":
            assert len(fields) == 6, (name, len(fields))
            imageTags = re.findall(r'^          - link "([^\n]*)":$', fields[3]["children"], re.M)
            base.update(price=fields[1]["text"], type=fields[2]["text"],
                        tags=tags("、".join(imageTags) if imageTags else fields[3]["text"]),
                        recipes=fields[4]["text"], description=fields[5]["text"])
        result.append(base)
    return result


def parse_beverages():
    file = HERE / "thbwiki_酒水_20261013.table.txt"
    text = file.read_text(encoding="utf-8")
    table = text[text.index("\n绿茶\n"):text.index("\n此页面最后编辑")]
    result = []
    for chunk in table.split("\n\n"):
        if not chunk.strip():
            continue
        fields = chunk.strip("\n").split("\t")
        assert len(fields) == 5, fields
        name = clean_name(fields[0].split("\n")[0])
        result.append({"name": name, "price": fields[1], "tags": tags(fields[2]), "source": fields[3],
                       "description": fields[4], "sourceFile": str(file),
                       "sourceLine": text[:text.index(chunk)].count("\n") + 1, "rawCells": fields})
    return result


def parse_wiki_guests():
    file = HERE / "既有_thbwiki_客人.html"
    text = file.read_text(encoding="utf-8")
    soup = BeautifulSoup(text, "html.parser")
    result = []
    for tableIndex, table in enumerate(soup.select(".mw-parser-output table")):
        for tr in table.select("tr"):
            cells = tr.find_all("td", recursive=False)
            if not cells:
                continue
            values = [c.get_text(" ", strip=True) for c in cells]
            sourceLine = tr.sourceline
            name = re.sub(r"\s*\(DLC\d+\)", "", values[0]).strip()
            row = {"name": clean_name(name), "sourceFile": str(file), "sourceLine": sourceLine,
                   "rawCells": values, "kind": "normal" if tableIndex == 1 else "guests"}
            if tableIndex == 1:
                row.update(locations=values[1], tags=tags(values[2]), drinkTags=tags(values[3]))
            else:
                row.update(locations=values[1], money=values[2], tags=tags(values[3]), drinkTags=tags(values[4]),
                           negativeTags=tags(values[5]))
            result.append(row)
    return result


def parse_gitee(kind):
    jsname = {"recipes": "cook.js", "ingredients": "material.js", "beverages": "drinks.js", "guests": "npc.js"}[kind]
    file = HERE / ("gitee_" + jsname)
    text = file.read_text(encoding="utf-8")
    m = re.search(r"return\s*(\[.*\])\s*\}", text, re.S)
    records = json.loads(m.group(1))
    cookerMap = {"cook1": "煮锅", "cook2": "烤架", "cook3": "油锅", "cook4": "蒸锅", "cook5": "料理台"}
    result = []
    for record in records:
        needle = '"chinese": "' + record["chinese"] + '"'
        if needle not in text:
            needle = '"chinese":"' + record["chinese"] + '"'
        row = {"name": clean_name(record["chinese"]), "tags": tags(record.get("tag", "")),
               "sourceFile": str(file), "sourceLine": text[:text.index(needle)].count("\n") + 1,
               "raw": record}
        if kind == "guests":
            row.update(money=record.get("money", ""), locations=record.get("location", ""),
                       drinkTags=tags(record.get("drinks", "")), negativeTags=tags(record.get("noTag", "")))
        else:
            row.update(price=record["money"], level=record["level"])
            if kind == "recipes":
                row.update(cooker=cookerMap[record["cooker"]], ingredients=[clean_name(x.strip()) for x in record["material"].split(",")],
                           negativeTags=tags(record.get("withNo", "")))
        result.append(row)
    return result


def parse_baseline():
    file = PROJECT / "中间数据/料亭版攻略数据基线.json"
    data = json.loads(file.read_text(encoding="utf-8"))
    result = {}
    for kind in ["recipes", "ingredients", "beverages", "guests", "normal"]:
        rows = []
        sheet = data["sheets"][kind]
        for i, record in enumerate(sheet["rows"]):
            row = {"sourceFile": str(file), "sheet": kind, "row": i + 1, "raw": record}
            if kind == "recipes":
                row.update(id=record[0], name=record[1], version=record[2], level=record[3], price=record[4], cooker=record[5],
                           ingredients=[clean_name(x.strip()) for x in re.split(r"[＋+]", record[6])],
                           tags=tags(record[7]), negativeTags=tags(record[8]))
            elif kind == "ingredients":
                row.update(id=record[0], name=record[1], type=record[2], tags=tags(record[3]), version=record[4], level=record[5], price=record[6])
            elif kind == "beverages":
                row.update(id=record[0], name=record[1], version=record[2], level=record[3], price=record[4], tags=tags(record[5]))
            elif kind == "guests":
                row.update(name=record[0], version=record[2], locations=record[3], money=record[4], tags=tags(record[5]),
                           negativeTags=tags(record[6]), drinkTags=tags(record[7]))
            else:
                row.update(name=record[0], version=record[1], locations=record[2], tags=tags(record[3]), drinkTags=tags(record[4]))
            row["name"] = clean_name(row["name"])
            rows.append(row)
        result[kind] = rows
    return result


def comparable(value, field):
    if field == "ingredients":
        return sorted(clean_name(x) for x in value)
    if field in {"tags", "drinkTags", "negativeTags"}:
        return sorted(value)
    if field == "money":
        return re.sub(r"[\s,，]", "", value).replace("—", "-").replace("–", "-")
    return value


def compare(sourceName, kind, source, baseline, fields, drop_popularity=False):
    lookup = {r["name"]: r for r in baseline}
    differences, unmatched = [], []
    seen = set()
    for s in source:
        name = s["name"]
        if name not in lookup:
            unmatched.append(name)
            continue
        b = lookup[name]
        seen.add(name)
        for field in fields:
            sv, bv = s[field], b[field]
            if drop_popularity and field in {"tags", "negativeTags"}:
                sv = sorted(set(sv) - {"流行·喜爱", "流行·厌恶"})
                bv = sorted(set(bv) - {"流行·喜爱", "流行·厌恶"})
            if comparable(sv, field) != comparable(bv, field):
                d = {"source": sourceName, "kind": kind, "name": name, "field": field, "baseline": bv, "public": sv,
                     "sourceFile": s["sourceFile"], "sourceLine": s["sourceLine"], "baselineRow": b["row"]}
                if field in {"tags", "negativeTags", "drinkTags"}:
                    d.update(missingFromBaseline=sorted(set(sv) - set(bv)), extraInBaseline=sorted(set(bv) - set(sv)))
                if field == "tags" and kind == "recipes" and set(sv) - set(bv) == {"大份"} and not set(bv) - set(sv):
                    d["classification"] = "default-cooking-derived-large-portion" if len(b["ingredients"]) >= 5 else "large-portion-source-disagreement"
                else:
                    d["classification"] = "public-source-disagreement-not-automatically-game-error"
                differences.append(d)
    return {"source": sourceName, "kind": kind, "sourceCount": len(source), "baselineCount": len(baseline),
            "comparedCount": len(seen), "unmatchedSource": unmatched, "notCoveredBaseline": sorted(set(lookup) - seen),
            "fields": fields, "differences": differences}


def run(save=False):
    baseline = parse_baseline()
    wiki = {"recipes": parse_snapshot(HERE / "thbwiki_料理_20261013.snapshot.txt", "recipes"),
            "ingredients": parse_snapshot(HERE / "thbwiki_食材_20261013.snapshot.txt", "ingredients"),
            "beverages": parse_beverages()}
    guests = parse_wiki_guests()
    wiki.update({k: [r for r in guests if r["kind"] == k] for k in ["guests", "normal"]})
    gitee = {k: parse_gitee(k) for k in ["recipes", "ingredients", "beverages", "guests"]}
    comparisons = []
    fields = {"recipes": ["price", "cooker", "ingredients", "tags", "negativeTags"],
              "ingredients": ["price", "type", "tags"], "beverages": ["price", "tags"],
              "guests": ["money", "tags", "negativeTags", "drinkTags", "locations"],
              "normal": ["tags", "drinkTags", "locations"]}
    for kind, rows in wiki.items():
        comparisons.append(compare("THBWiki", kind, rows, baseline[kind], fields[kind]))
    for kind, rows in gitee.items():
        fs = {"recipes": ["price", "level", "cooker", "ingredients", "tags", "negativeTags"],
              "ingredients": ["price", "level", "tags"], "beverages": ["price", "level", "tags"],
              "guests": ["money", "tags", "negativeTags", "drinkTags", "locations"]}[kind]
        comparisons.append(compare("Gitee旧助手", kind, rows, baseline[kind], fs, drop_popularity=True))
    summary = [{k: v for k, v in c.items() if k != "differences"} | {"differenceFields": len(c["differences"]),
                "differenceEntries": len({d["name"] for d in c["differences"]}),
                "fieldsCount": dict(Counter(d["field"] for d in c["differences"]))} for c in comparisons]
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    differences = [d for c in comparisons for d in c["differences"]]
    print("ALL DIFFERENCES")
    for d in differences:
        print(json.dumps(d, ensure_ascii=False))
    if save:
        def dump(name, data):
            with (HERE / name).open("x", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                f.write("\n")
        dump("public_structured_full.json", {"THBWiki": wiki, "Gitee旧助手": gitee})
        dump("public_comparisons_full.json", comparisons)
        dump("public_comparison_summary.json", summary)
        with (HERE / "public_differences_all.jsonl").open("x", encoding="utf-8") as f:
            for d in differences:
                f.write(json.dumps(d, ensure_ascii=False) + "\n")
        with (HERE / "baseline_compared.jsonl").open("x", encoding="utf-8") as f:
            for kind, rows in baseline.items():
                for row in rows:
                    f.write(json.dumps(row, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--save", action="store_true")
    run(parser.parse_args().save)
