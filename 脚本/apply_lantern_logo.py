# -*- coding: utf-8 -*-
"""一次性脚本：品牌 logo 改为扁平化红灯笼图标（东方意象，小尺寸可读），favicon 同步。"""
import base64
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent

LANTERN_SVG = (
    '<svg viewBox="0 0 48 58" fill="none" aria-hidden="true">'
    '<path d="M24 1v4" stroke="#d9a53f" stroke-width="2" stroke-linecap="round"/>'
    '<rect x="16" y="4" width="16" height="5" rx="2.5" fill="#d9a53f"/>'
    '<path d="M24 9c10.5 0 17.5 7 17.5 16.5S34.5 42 24 42 6.5 35 6.5 25.5 13.5 9 24 9z" fill="#c9452f"/>'
    '<path d="M15.5 11.2C11.6 15.4 9.5 20.3 9.5 25.5s2.1 10.1 6 14.3M32.5 11.2c3.9 4.2 6 9.1 6 14.3s-2.1 10.1-6 14.3M24 9v33" '
    'stroke="#8f2a1d" stroke-width="1.4" opacity=".6"/>'
    '<text x="24" y="32.5" text-anchor="middle" font-size="19" font-weight="700" fill="#fff7ef" '
    'font-family="KaiTi,STKaiti,serif">东</text>'
    '<rect x="17" y="42" width="14" height="4" rx="2" fill="#d9a53f"/>'
    '<path d="M24 46v4.5" stroke="#d9a53f" stroke-width="2" stroke-linecap="round"/>'
    '<circle cx="24" cy="53.5" r="2.6" fill="#d9a53f"/>'
    '</svg>'
)

OLD_MARK_IMG = '<div class="brand-mark" aria-hidden="true"><img src="__BRAND_SEAL__" alt=""></div>'
NEW_MARK = '<div class="brand-mark" aria-hidden="true">' + LANTERN_SVG + '</div>'

for tpl in ("guide_template.html", "guide_template_wafu.html"):
    p = SCRIPTS / tpl
    text = p.read_text(encoding="utf-8")

    def rep(old, new, count=1):
        global text
        n = text.count(old)
        assert n == count, "%s: expect %d, got %d: %r" % (tpl, count, n, old[:60])
        text = text.replace(old, new)

    rep(OLD_MARK_IMG, NEW_MARK)
    rep(
        ".brand-mark{background:none;border:0;box-shadow:0 4px 14px rgba(0,0,0,.32);overflow:visible;width:40px;height:46px}\n"
        ".brand-mark img{height:100%;width:auto;display:block;filter:drop-shadow(0 3px 5px rgba(0,0,0,.35))}",
        ".brand-mark{background:none;border:0;box-shadow:0 4px 14px rgba(0,0,0,.28);overflow:visible;width:40px;height:48px}\n"
        ".brand-mark svg{height:100%;width:auto;display:block;filter:drop-shadow(0 3px 5px rgba(0,0,0,.35))}",
    )
    p.write_text(text, encoding="utf-8")
    print(tpl, "updated")

# favicon：红色圆角方 + 白色"东"
from PIL import Image, ImageDraw, ImageFont
fav = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
d = ImageDraw.Draw(fav)
d.rounded_rectangle([2, 2, 62, 62], radius=16, fill=(201, 69, 47, 255))
try:
    font = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 38)
    bbox = d.textbbox((0, 0), "东", font=font)
    d.text((32 - (bbox[2] - bbox[0]) / 2 - bbox[0], 30 - (bbox[3] - bbox[1]) / 2 - bbox[1]), "东", font=font, fill=(255, 247, 239, 255))
except OSError:
    pass
buf = SCRIPTS / "调试" / "logo-candidates" / "favicon-new-64.png"
fav.save(buf)
b64 = base64.b64encode(buf.read_bytes()).decode("ascii")

for tpl in ("guide_template.html", "guide_template_wafu.html"):
    p = SCRIPTS / tpl
    text = p.read_text(encoding="utf-8")
    start = text.index('rel="icon" href="') + len('rel="icon" href="')
    end = text.index('"', start)
    text = text[:start] + "data:image/png;base64," + b64 + text[end:]
    p.write_text(text, encoding="utf-8")
    print(tpl, "favicon updated")

# brand_seal.png 不再被模板引用，build_html.py 的占位替换保留但指向说明
bh = SCRIPTS / "build_html.py"
t = bh.read_text(encoding="utf-8")
old = 'html = html.replace("__BRAND_SEAL__", brand_seal_uri())'.replace("html = ", "            html = ")
assert t.count('html.replace("__BRAND_SEAL__"') == 1
print("build_html placeholder kept (unused but harmless)")
