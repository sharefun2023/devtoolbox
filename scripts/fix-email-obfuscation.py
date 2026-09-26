#!/usr/bin/env python3
"""Wrap email addresses in Cloudflare's <!--email_off--> markers so Scrape Shield leaves them alone.

WHY (verified against the live site, 2026-09-26)
Cloudflare Email Address Obfuscation rewrites two different things on the way out of the edge:

  1. a mailto: anchor  ->  <a href="/cdn-cgi/l/email-protection#<xor>">      (fragment form)
  2. a bare address in body text  ->  <a href="/cdn-cgi/l/email-protection"
        class="__cf_email__" data-cfemail="<xor>">[email protected]</a>     (class form)

Both forms are a problem on Cloudflare Pages:
  * /cdn-cgi/* is handled by Cloudflare *before* the Pages router, so the endpoint 404s. Crawlers
    (Bingbot, Googlebot, Ahrefs, Screaming Frog) follow the link and log a 404 — Bing reported
    Code4xx=2 on 2026-09-25, matching the two rewritten anchors on the homepage. A _redirects rule
    cannot fix it (tested: still 404 after deploy).
  * Form 2 also damages the *content*: `"email":"alice@example.com"` inside a JSON code sample
    renders as an anchor whose text is "[email protected]", and the regex-example table showed
    "[email protected]" instead of the address it was teaching the reader to match.

Cloudflare's documented opt-out is <!--email_off--> ... <!--/email_off--> around the address, which
makes the rewrite not happen at all: mailto: links keep working natively and code samples read
exactly as written.

Scope guards:
  * <script> content is skipped — Cloudflare does not rewrite addresses inside script blocks
    (verified: the regex page's JS sample string with support@23232322.xyz is served verbatim), and
    injecting a comment into a JS string literal would corrupt the sample.
  * already-wrapped addresses are skipped, so the script is idempotent.

Usage: python3 scripts/fix-email-obfuscation.py [--apply] [webroot]
"""
import os
import re
import sys

# Skip anything inside a <script> block.
SCRIPT = re.compile(r'<script\b.*?</script>', re.I | re.S)
# An address that Cloudflare's obfuscator would match (same shape as its own pattern).
EMAIL = re.compile(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}')
OFF_BLOCK = re.compile(r'<!--email_off-->.*?<!--/email_off-->', re.I | re.S)
ALREADY = re.compile(r'<!--email_off-->\s*')


def spans(regex, text):
    return [(m.start(), m.end()) for m in regex.finditer(text)]


def inside(pos, ss):
    return any(a <= pos < b for a, b in ss)


def in_tag(text, pos):
    """True if pos falls between '<' and its matching '>' — i.e. inside a tag, so the address is
    an attribute value, not text. Comment markers must never be inserted there (they would show
    up verbatim in e.g. a placeholder attribute). Cloudflare only rewrites text-node addresses,
    so attribute values are skipped anyway."""
    return text.rfind('<', 0, pos) > text.rfind('>', 0, pos)


def fix(text):
    """Return (new_text, n_wrapped, wrapped_addresses)."""
    script_spans = spans(SCRIPT, text)
    # Addresses already handled (mailto anchors wrapped earlier, or a previous run).
    handled = spans(OFF_BLOCK, text)

    edits = []
    for m in EMAIL.finditer(text):
        if inside(m.start(), script_spans):
            continue
        if inside(m.start(), handled):
            continue
        if in_tag(text, m.start()):
            continue
        edits.append(m)

    if not edits:
        return text, 0, []

    out = []
    last = 0
    for m in edits:
        out.append(text[last:m.start()])
        out.append('<!--email_off-->' + m.group(0) + '<!--/email_off-->')
        last = m.end()
    out.append(text[last:])
    return ''.join(out), len(edits), [m.group(0) for m in edits]


def wrap_mailto_anchors(text):
    """Wrap whole <a href="mailto:...">...</a> elements (a mailto href is not an EMAIL match
    because EMAIL scans raw text and the address sits inside an attribute)."""
    n = 0

    def repl(m):
        nonlocal n
        n += 1
        return f'<!--email_off-->{m.group(0)}<!--/email_off-->'

    anchor = re.compile(r'<a\s[^>]*href="mailto:[^"]*"[^>]*>[^<]*</a>', re.I)
    # stash already-wrapped anchors so they are not matched again
    stash = {}

    def hide(m):
        k = f'\x00{len(stash)}\x00'
        stash[k] = m.group(0)
        return k

    text = OFF_BLOCK.sub(hide, text)
    text = anchor.sub(repl, text)
    for k, v in stash.items():
        text = text.replace(k, v)
    return text, n


def main():
    apply = '--apply' in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    webroot = args[0] if args else 'public'

    tot_a = tot_b = 0
    pages = 0
    for root, dirs, files in os.walk(webroot):
        if '__pycache__' in root:
            continue
        for f in sorted(files):
            if not f.endswith('.html'):
                continue
            p = os.path.join(root, f)
            src = open(p, encoding='utf-8').read()
            if '@' not in src:
                continue
            out, na = wrap_mailto_anchors(src)
            out, nb, addrs = fix(out)
            if na or nb:
                pages += 1
                tot_a += na
                tot_b += nb
                detail = f'{na} mailto anchor(s)' if na else ''
                if nb:
                    detail += (' + ' if detail else '') + f'{nb} bare address(es) {sorted(set(addrs))}'
                print(f'{p}: {detail}')
                if apply:
                    open(p, 'w', encoding='utf-8').write(out)
    print(f'\n{tot_a} mailto anchor(s) + {tot_b} bare address(es) '
          f'{"wrapped" if apply else "to wrap"} across {pages} page(s)')
    if not apply and (tot_a or tot_b):
        print('(dry run - pass --apply to write)')


if __name__ == '__main__':
    main()
