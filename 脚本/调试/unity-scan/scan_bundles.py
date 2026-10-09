# -*- coding: utf-8 -*-
"""扫描夜雀食堂 Addressables 全部 bundle，建立 Texture2D/Sprite 名称索引。"""
import UnityPy, glob, os, json, sys, time

base = r"F:\Games\GamePlats\Steam\steamapps\common\Touhou Mystia Izakaya\Touhou Mystia Izakaya_Data\StreamingAssets\aa\StandaloneWindows64"
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bundle_index.json")

files = sorted(glob.glob(os.path.join(base, "*.bundle")))
index = {}
t0 = time.time()
for i, f in enumerate(files):
    try:
        env = UnityPy.load(f)
        names = []
        for obj in env.objects:
            if obj.type.name in ("Texture2D", "Sprite"):
                try:
                    d = obj.read()
                    names.append(d.m_Name)
                except Exception:
                    pass
        if names:
            index[os.path.basename(f)] = names
    except Exception as e:
        print("ERR", os.path.basename(f), e, file=sys.stderr)
    if i % 500 == 0:
        print(f"{i}/{len(files)} elapsed {time.time()-t0:.0f}s", flush=True)

json.dump(index, open(out, "w", encoding="utf-8"), ensure_ascii=False)
print("DONE", len(index), "bundles with textures,", f"{time.time()-t0:.0f}s")
