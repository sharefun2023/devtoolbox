#!/usr/bin/env python3
"""Live check of the 6 priority-page titles (Googlebot UA) + meta description length band."""
import re, urllib.request, urllib.error

UA = {'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'}
SITE = 'https://23232322.xyz'

TARGETS = [
    ('/tools/json-formatter-online', 'online json formatter'),
    ('/base64-encode', 'base64 encoder'),
    ('/tools/minifier', 'html minifier online'),
    ('/online-regex-tester', 'regex tester online'),
    ('/tools/url-encoder-decoder', 'url encoder decoder'),
    ('/tools/jwt-debugger', 'jwt debugger'),
]

fails = 0
for path, word in TARGETS:
    url = SITE + path
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25)
        body = r.read().decode('utf-8', 'ignore')
        code = r.getcode()
    except urllib.error.HTTPError as e:
        print(f'FAIL {path}: HTTP {e.code}')
        fails += 1
        continue
    title = re.search(r'(?is)<title>(.*?)</title>', body)
    title = title.group(1).strip() if title else ''
    desc = re.search(r'(?is)<meta name="description" content="(.*?)"', body)
    desc = desc.group(1).strip() if desc else ''
    has = word.lower() in title.lower()
    ok_len = len(desc) <= 160
    if not has or not ok_len:
        fails += 1
    print(f'{"OK " if has and ok_len else "CHK"} {path:34} HTTP {code}  target={"Y" if has else "N"} '
          f'desc={len(desc):3d}{"" if ok_len else " >160!"}')
    print(f'      title: {title}')
print(f'\nFAILURES: {fails}')
