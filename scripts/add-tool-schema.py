#!/usr/bin/env python3
"""给工具页补 WebApplication + BreadcrumbList 结构化数据（幂等）

背景：站上 17 个「有真工具」的页面里，16 个是 WebApplication + BreadcrumbList + FAQPage 三件套，
只有 /base64-encode 与 /base64-decode 两页**只有 FAQPage** —— 它们既没被声明成一个应用
（所以拿不到 WebApplication 那条软性信号），也没有面包屑（搜索结果里没有层级路径）。
本脚本按站内既有房子的写法（取值全部来自页面自己已声明的 title/description/canonical，不编造新文案）补齐。

用法:
    python3 scripts/add-tool-schema.py            # dry-run
    python3 scripts/add-tool-schema.py --apply
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TODAY = '2026-10-03'

# 页面 → (schema name, 页面 URL, 面包屑末级名)
PAGES = {
    'public/base64-decode.html': (
        'Base64 Decoder',
        'https://23232322.xyz/base64-decode',
        'Base64 Decoder',
    ),
    'public/base64-encode.html': (
        'Base64 Encoder',
        'https://23232322.xyz/base64-encode',
        'Base64 Encoder',
    ),
}


def webapp(name, url, desc):
    return {'@context': 'https://schema.org', '@type': 'WebApplication',
            'name': name,
            'description': desc,
            'applicationCategory': 'DeveloperApplication',
            'operatingSystem': 'Any',
            'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD'},
            'url': url,
            'dateModified': TODAY}


def breadcrumb(name, url):
    return {'@context': 'https://schema.org', '@type': 'BreadcrumbList',
            'itemListElement': [
                {'@type': 'ListItem', 'position': 1, 'name': 'Home',
                 'item': 'https://23232322.xyz/'},
                {'@type': 'ListItem', 'position': 2, 'name': name, 'item': url}]}


def main(apply):
    changed = 0
    for rel, (name, url, crumb) in PAGES.items():
        p = ROOT / rel
        s = p.read_text(encoding='utf-8')
        if '"WebApplication"' in s and '"BreadcrumbList"' in s:
            print(f'{rel}: 已有 WebApplication + BreadcrumbList，跳过')
            continue
        # 描述复用页面自己的 meta description（不编新文案）
        m = re.search(r'<meta name="description" content="([^"]*)"', s)
        if not m:
            print(f'✗ {rel}: 找不到 meta description')
            continue
        desc = m.group(1)
        new = (f'<script type="application/ld+json">\n'
               f'{json.dumps(webapp(name, url, desc), ensure_ascii=False, indent=2)}\n</script>\n'
               f'<script type="application/ld+json">\n'
               f'{json.dumps(breadcrumb(crumb, url), ensure_ascii=False, indent=2)}\n</script>\n')
        # 插在第一个 JSON-LD 区块之前（与站内其它页一致：应用 → 面包屑 → FAQ）
        m2 = re.search(r'<script type="application/ld\+json">', s)
        if not m2:
            print(f'✗ {rel}: 没有可参照的 JSON-LD 锚点')
            continue
        s = s[:m2.start()] + new + s[m2.start():]
        print(f'{rel}: 补 WebApplication + BreadcrumbList（description 复用 meta，{len(desc)} 字）')
        if apply:
            p.write_text(s, encoding='utf-8')
        changed += 1
    print(f'\n{changed} page(s) changed' + ('' if apply else '  (dry-run)'))
    return 0


if __name__ == '__main__':
    sys.exit(main('--apply' in sys.argv))
