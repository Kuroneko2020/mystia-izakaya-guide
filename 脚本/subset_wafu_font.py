# -*- coding: utf-8 -*-
"""按和风版 HTML 实际用到的字符，把霞鹜文楷子集化为小体积 woff2。

用法：先跑过一次 build_html.py（成品里有东方夜雀食堂攻略查询_和风版.html），再运行本脚本：
    py 脚本/subset_wafu_font.py
输入：原始资料/字体/LXGWWenKai-Regular.ttf（v1.520，OFL 开源协议）
输出：脚本/wafu_font_subset.woff2（之后重跑 build_html.py 即完成内嵌）
依赖：pip install fonttools brotli
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC_TTF = ROOT / "原始资料" / "字体" / "LXGWWenKai-Regular.ttf"
HTML = ROOT / "成品" / "东方夜雀食堂攻略查询_和风版.html"
OUT_WOFF2 = Path(__file__).resolve().parent / "wafu_font_subset.woff2"


def collect_chars() -> str:
    text = HTML.read_text(encoding="utf-8")
    # 只取可见内容：去掉 base64/数据长串不会有（此时字体尚未嵌入），直接全文字符去重即可。
    chars = set(text) | set(chr(c) for c in range(0x20, 0x7F))
    chars |= set("·×—…“”‘’、。，；：？！（）《》◆★☆✦✧〇")
    return "".join(sorted(chars))


def main() -> None:
    from fontTools.subset import Subsetter, Options, load_font, save_font

    if not SRC_TTF.exists():
        raise FileNotFoundError(f"缺少字体源文件：{SRC_TTF}")
    if not HTML.exists():
        raise FileNotFoundError("请先运行 build_html.py 生成和风版 HTML")
    text = collect_chars()
    opts = Options()
    opts.flavor = "woff2"
    opts.desubroutinize = True
    opts.drop_tables += ["FFTM"]
    font = load_font(str(SRC_TTF), opts)
    subsetter = Subsetter(options=opts)
    subsetter.populate(text=text)
    subsetter.subset(font)
    save_font(font, str(OUT_WOFF2), opts)
    print(f"{OUT_WOFF2}  {OUT_WOFF2.stat().st_size / 1024:.1f} KB，字符数 {len(text)}")


if __name__ == "__main__":
    main()
