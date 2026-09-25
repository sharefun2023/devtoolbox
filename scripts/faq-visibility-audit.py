#!/usr/bin/env python3
"""FAQPage schema vs 可见内容一致性审计（工具站）

判据：Google 要求结构化数据必须对应页面上可见的内容。
本脚本把每个 FAQPage 的 Question 文案拿去页面**可见文本**里找，找不到即 = 不可见。

用法:
    python3 scripts/faq-visibility-audit.py public
"""
import html as H
import json
import os
import re
import sys


def strip_scripts_styles(s):
    s = re.sub(r'<script\b.*?</script>', ' ', s, flags=re.S | re.I)
    s = re.sub(r'<style\b.*?</style>', ' ', s, flags=re.S | re.I)
    # 去掉 meta/link/title 等 head 级内容（schema 就在 head 里，必须排除否则自证）
    s = re.sub(r'<head\b.*?</head>', ' ', s, flags=re.S | re.I)
    return s


def visible_text(s):
    body = strip_scripts_styles(s)
    body = re.sub(r'<!--.*?-->', ' ', body, flags=re.S)
    body = re.sub(r'<[^>]+>', ' ', body)
    # 渲染后的文本 = HTML 实体解码一次（浏览器就是这么显示的）
    body = H.unescape(body)
    return re.sub(r'\s+', ' ', body).strip()


def norm(t, unescape=False):
    """规范化以便比较。

    判据必须是「JSON-LD 里的**字面文本**」 vs 「浏览器**渲染后**的页面文本」：
    JSON-LD 是 JSON，实体**不会**被解码（写 `&amp;notin;` 就真的会显示成 "&amp;notin;"），
    而 HTML 正文里的 `&amp;notin;` 浏览器显示为 "&notin;" → 所以两侧处理方式不同。
    """
    if unescape:
        t = H.unescape(t)
    t = t.lower()
    t = re.sub(r'[^a-z0-9]+', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()


def main(root):
    pages = []
    for dirpath, _dirs, files in os.walk(root):
        for f in sorted(files):
            if f.endswith('.html'):
                pages.append(os.path.join(dirpath, f))
    pages.sort()

    bad = 0
    for p in pages:
        s = open(p, encoding='utf-8', errors='replace').read()
        if 'noindex' in s.split('</head>')[0].lower():
            continue
        blocks = re.findall(
            r'<script type="application/ld\+json">(.*?)</script>', s, re.S)
        qs = []
        for b in blocks:
            try:
                d = json.loads(b)
            except Exception:
                continue
            if isinstance(d, dict) and d.get('@type') == 'FAQPage':
                for it in d.get('mainEntity', []):
                    q = it.get('name')
                    if q:
                        qs.append(q)
        if not qs:
            continue
        vis = norm(visible_text(s))
        missing = [q for q in qs if norm(q) not in vis]
        rel = os.path.relpath(p, root)
        if missing:
            bad += 1
            print(f'{rel}: {len(missing)}/{len(qs)} schema Question 在页面不可见')
            for q in missing:
                print(f'    ✗ {q}')
        else:
            print(f'{rel}: OK ({len(qs)} 条全部可见)')
    print(f'\npages with invisible FAQ schema: {bad}')
    return bad


if __name__ == '__main__':
    sys.exit(0 if main(sys.argv[1] if len(sys.argv) > 1 else 'public') == 0 else 1)
