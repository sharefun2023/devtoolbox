#!/usr/bin/env python3
"""Audit live devtoolbox pages: map each public/*.html to its real served URL and report
obfuscated-email links (which 404 on Cloudflare Pages) + any non-200 page.

Match the bare path, NOT "/email-protection#": Cloudflare emits two shapes and only the mailto
one carries the "#<xor>" fragment. Matching the fragment form only made this audit report 0
while 7 class-form links ("<a href=\"/cdn-cgi/l/email-protection\" class=\"__cf_email__\">")
were live."""
import os, re, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

UA = {'User-Agent': 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'}
SITE = 'https://23232322.xyz'


def served_url(rel):
    """rel is like '/index.html', '/about.html', '/tools/x.html', '/cron/index.html'."""
    if rel.endswith('/index.html'):
        return SITE + rel[:-len('index.html')]          # keeps trailing slash
    if rel.endswith('.html'):
        return SITE + rel[:-len('.html')]
    return SITE + rel


def main():
    pages = []
    for root, dirs, files in os.walk('public'):
        if '__pycache__' in root:
            continue
        for f in files:
            if f.endswith('.html'):
                rel = '/' + os.path.relpath(os.path.join(root, f), 'public')
                pages.append((rel, served_url(rel)))

    def fetch(t):
        rel, url = t
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25)
            body = r.read().decode('utf-8', 'ignore')
            return rel, url, r.getcode(), len(re.findall(r'cdn-cgi/l/email-protection', body))
        except urllib.error.HTTPError as e:
            return rel, url, e.code, -1
        except Exception as e:
            return rel, url, 0, -1

    with ThreadPoolExecutor(max_workers=8) as ex:
        res = list(ex.map(fetch, pages))

    print(f'{len(pages)} pages checked (each via its real served URL)')
    tot = 0
    for rel, url, code, n in sorted(res, key=lambda x: -x[3]):
        if code != 200:
            print(f'  NON-200 {code}  {url}   ({rel})')
        elif n:
            tot += n
            print(f'  {n} obfuscated-email link(s)  {url}')
    print(f'\nTOTAL obfuscated-email links live: {tot}')
    print(f'TOTAL non-200 pages: {sum(1 for r in res if r[2] != 200)}')


if __name__ == '__main__':
    main()
