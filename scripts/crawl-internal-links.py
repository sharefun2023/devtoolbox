#!/usr/bin/env python3
"""Crawl live devtoolbox site: harvest every internal page link from every page and report non-200s.
Usage: python3 scripts/crawl-internal-links.py [--local-only]
"""
import re, sys, os, urllib.request, urllib.error, json
from concurrent.futures import ThreadPoolExecutor

UA = {'User-Agent': 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'}
SITE = 'https://23232322.xyz'
SKIP_EXT = ('.css', '.js', '.png', '.svg', '.ico', '.xml', '.txt', '.webp', '.jpg', '.jpeg', '.gif', '.woff', '.woff2')


def get(u):
    try:
        r = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=25)
        return r.getcode(), r.read().decode('utf-8', 'ignore'), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'ignore')[:300], dict(e.headers)
    except Exception as e:
        return 0, str(e), {}


def served_url(rel):
    """Map a file path in public/ onto the URL Cloudflare Pages actually serves.
    '/about.html' -> '/about', '/tools/x.html' -> '/tools/x', '/cron/index.html' -> '/cron/'.
    Using the .html form instead makes every fetch a 308 and the page body never arrives."""
    if rel.endswith('/index.html'):
        return rel[:-len('index.html')]
    if rel.endswith('.html'):
        return rel[:-len('.html')]
    return rel


def main():
    pages = []
    for root, dirs, files in os.walk('public'):
        if '__pycache__' in root:
            continue
        for f in files:
            if f.endswith('.html'):
                rel = '/' + os.path.relpath(os.path.join(root, f), 'public')
                pages.append(rel)
    print(f'{len(pages)} html files in public/')

    # live-fetch each page, harvest internal hrefs
    def fetch(rel):
        url = SITE + served_url(rel)
        code, body, _ = get(url)
        found = set()
        if code == 200:
            for m in re.finditer(r'(?:href|src)="([^"]+)"', body):
                v = m.group(1)
                if v.startswith(('http://23232322.xyz', 'https://23232322.xyz', '/')):
                    full = v if v.startswith('http') else SITE + v
                    full = full.split('#')[0]
                    if full.endswith(SKIP_EXT):
                        continue
                    found.add(full)
        return rel, url, code, found

    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(fetch, pages))

    bad_pages = [(u, c) for _, u, c, _ in results if c != 200]
    if bad_pages:
        print('\nPAGES NOT 200:')
        for u, c in bad_pages:
            print(f'  {c}  {u}')

    links = {}
    for rel, url, code, found in results:
        for l in found:
            links.setdefault(l, set()).add(rel)
    print(f'\n{len(links)} distinct internal page links harvested')

    def check(u):
        code, _, h = get(u)
        return u, code, h

    with ThreadPoolExecutor(max_workers=8) as ex:
        checks = list(ex.map(check, sorted(links)))

    bad = []
    for u, code, h in checks:
        if code != 200:
            bad.append((code, u, sorted(links[u])[:3]))
    print('\nNON-200 INTERNAL LINKS:')
    for c, u, src in bad:
        print(f'  {c}  {u}   <- from {src}')
    print(f'--> {len(bad)} non-200 internal link(s)')


if __name__ == '__main__':
    main()
