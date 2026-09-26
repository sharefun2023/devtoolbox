#!/usr/bin/env python3
"""Wrap every mailto: anchor in Cloudflare's <!--email_off--> markers.

Why: Cloudflare's Email Address Obfuscation (Scrape Shield) rewrites every email address in the
HTML leaving the edge into <a href="/cdn-cgi/l/email-protection#<xor>"> plus an
email-decode.min.js script. /cdn-cgi/ is intercepted by Cloudflare *before* Pages routing, so
that path returns 404 for anything that does not run the decoder — including Bingbot and
Googlebot, which discover the link and fetch it. (A _redirects rule cannot help: /cdn-cgi/ never
reaches the Pages router.) Cloudflare's documented opt-out is to wrap the markup in
<!--email_off--> ... <!--/email_off--> so the address is left alone.

Effect: the address stays a normal, working mailto: link (better for users than the
"[email protected]" placeholder + JS decoder), and no /cdn-cgi/l/email-protection link exists
for crawlers to 404 on.

Idempotent: anchors already inside an email_off block are skipped.
Usage: python3 scripts/fix-email-obfuscation.py [--apply] [webroot]
"""
import os
import re
import sys

ANCHOR = re.compile(r'<a\s[^>]*href="mailto:[^"]*"[^>]*>[^<]*</a>', re.I)
WRAPPED = re.compile(r'<!--email_off-->\s*<a\s[^>]*href="mailto:', re.I)


def fix(text):
    """Return (new_text, n_wrapped)."""
    n = 0

    def repl(m):
        nonlocal n
        n += 1
        return f'<!--email_off-->{m.group(0)}<!--/email_off-->'

    # Protect already-wrapped anchors: temporarily blank them out so ANCHOR can't re-match.
    placeholders = {}

    def stash(m):
        key = f'\x00{len(placeholders)}\x00'
        placeholders[key] = m.group(0)
        return key

    text = WRAPPED.sub(stash, text)
    text = ANCHOR.sub(repl, text)
    for key, val in placeholders.items():
        text = text.replace(key, val)
    return text, n


def main():
    apply = '--apply' in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    webroot = args[0] if args else 'public'

    total = 0
    pages = 0
    for root, dirs, files in os.walk(webroot):
        if '__pycache__' in root:
            continue
        for f in sorted(files):
            if not f.endswith('.html'):
                continue
            p = os.path.join(root, f)
            src = open(p, encoding='utf-8').read()
            if 'mailto:' not in src:
                continue
            out, n = fix(src)
            if n:
                pages += 1
                total += n
                print(f'{p}: {n} anchor(s) wrapped')
                if apply:
                    open(p, 'w', encoding='utf-8').write(out)
    print(f'\n{total} anchor(s) {"wrapped" if apply else "to wrap"} across {pages} page(s)')
    if not apply and total:
        print('(dry run - pass --apply to write)')


if __name__ == '__main__':
    main()
