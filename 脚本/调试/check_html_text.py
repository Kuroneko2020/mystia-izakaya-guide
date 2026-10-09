# -*- coding: utf-8 -*-
from bs4 import BeautifulSoup
from pathlib import Path
p=Path(r"待整理/2026-10-04--东方夜雀食堂攻略表/成品/html_dump_qinxin2.html")
soup=BeautifulSoup(p.read_text(encoding='utf-8',errors='ignore'),'lxml')
out=[]
out.append('detail title: '+soup.select_one('#detail-title').get_text(strip=True))
out.append('detail sub: '+soup.select_one('#detail-sub').get_text(strip=True))
out.append('guest count: '+soup.select_one('#guest-count').get_text(strip=True))
out.append('detail count: '+soup.select_one('#detail-count').get_text(strip=True))
card=soup.select_one('#guest-grid .guest-card')
out.append('first card: '+card.get_text(' | ',strip=True)[:200])
out.append('detail body snippet:\n'+soup.select_one('#detail-body').get_text('\n',strip=True)[:1200])
Path(r"待整理/2026-10-04--东方夜雀食堂攻略表/成品/html_check.txt").write_text('\n'.join(out),encoding='utf-8')
print('ok')
