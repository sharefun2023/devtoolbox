#!/usr/bin/env python3
"""
Normalize <meta name="description"> across the site to fit Google's ~160-char
SERP snippet limit.

Why: 17 of 32 indexable pages declared descriptions of 165-331 characters.
Google truncates the snippet at roughly 155-160 characters on desktop, so the
tail of every one of those descriptions — including the entire feature list and
the "100% client-side" differentiator — was never shown. Six of the six priority
keyword pages were affected.

Rule used when rewriting: keep the primary keyword inside the first 60 chars
(so a truncation can never drop it), keep the sentence complete, and land in
120-160 characters.

The same text is mirrored onto og:description / twitter:description, but only
where those tags currently duplicate the old meta description verbatim — a tag
that deliberately says something else is left alone.

Idempotent: a page whose description already equals the target is skipped.
"""
import html
import os
import re
import sys

WEBROOT = sys.argv[1] if len(sys.argv) > 1 else "public"

# page path -> new description (plain text; escaped on write)
DESC = {
    "/base64-decode.html":
        "Free online Base64 decoder \u2014 decode Base64 to text instantly. Handles UTF-8, "
        "image data URIs and URL-safe Base64. 100% browser-based, nothing uploaded.",
    "/base64-encode.html":
        "Free online Base64 encoder \u2014 encode text and files to Base64 in one click. "
        "UTF-8 safe, URL-safe output, file to Base64. 100% browser-based.",
    "/categories/dev-tools.html":
        "Best free online developer utilities \u2014 CIDR calculator, timestamp converter, "
        "UUID generator, regex tester and more. Browser-based, no install needed.",
    "/online-regex-tester.html":
        "Regex tester online \u2014 test and debug regular expressions with live match "
        "highlighting, capture groups and replace mode. 100% browser-based.",
    "/tools/ai-cover-generator.html":
        "Free AI cover generator \u2014 create social media covers, blog headers and "
        "thumbnails in Modern, Minimal, Tech, Nature or Abstract styles. No sign-up.",
    "/tools/cidr-calculator.html":
        "Free online CIDR and IPv6 subnet calculator \u2014 network address, broadcast "
        "address, subnet mask and usable IP range for IPv4 and IPv6. Client-side.",
    "/tools/color-tools.html":
        "Free color tools online: convert between HEX, RGB and HSL, pick colors with a "
        "visual picker, and generate complementary and analogous palettes. Client-side.",
    "/tools/html-entity-encoder-decoder.html":
        "Free HTML entity encoder and decoder \u2014 escape HTML special characters to "
        "entities and decode named or numeric entities back to text. 100% client-side.",
    "/tools/json-formatter-online.html":
        "Free online JSON formatter and validator \u2014 format, beautify, validate and "
        "minify JSON instantly, with error position, tree view and diff. Client-side.",
    "/tools/jwt-debugger.html":
        "Decode any JWT's header, payload and claims online, verify HS256/RS256/ES256 "
        "signatures with your secret or public key, and check expiry. Client-side.",
    "/tools/markdown-preview.html":
        "Free online Markdown editor with live preview \u2014 GFM tables, task lists and "
        "fenced code blocks, plus one-click HTML export. 100% client-side.",
    "/tools/qrcode-tools.html":
        "Free online QR code generator and reader \u2014 generate QR codes from text or "
        "URLs, download as PNG, or upload an image to decode. 100% client-side.",
    "/tools/sql-formatter-online.html":
        "Free online SQL formatter and beautifier \u2014 one clause per line, indented "
        "subqueries and CASE blocks, every token preserved. Minify or check structure.",
    "/tools/text-diff.html":
        "Free online diff checker \u2014 compare two texts, code snippets or JSON side by "
        "side with line-by-line highlighting of additions and deletions.",
    "/tools/timestamp-converter.html":
        "Free online Unix timestamp converter \u2014 epoch seconds, milliseconds or "
        "nanoseconds to readable dates and back. Auto-detects 10/13/16/19 digits.",
    "/tools/url-encoder-decoder.html":
        "Free URL encoder decoder online \u2014 percent-encode or decode a URL, query "
        "string or single value, with a lenient decoder for invalid escapes.",
    "/tools/uuid-generator.html":
        "Free online UUID generator \u2014 create random UUID v4, v1 and v7 instantly, up "
        "to 500 in bulk, and download as CSV or JSON. 100% client-side.",
}

META_RE = re.compile(r'(<meta\s+name="description"\s+content=")(.*?)(")', re.S | re.I)
OG_RE = re.compile(r'(<meta\s+property="og:description"\s+content=")(.*?)(")', re.S | re.I)
TW_RE = re.compile(r'(<meta\s+name="twitter:description"\s+content=")(.*?)(")', re.S | re.I)


def esc(s):
    """Escape for an HTML attribute value."""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def main():
    apply = "--apply" in sys.argv
    changed = 0
    problems = []

    for path, new in DESC.items():
        full = os.path.join(WEBROOT, path.lstrip("/"))
        if not os.path.exists(full):
            problems.append(f"missing file: {path}")
            continue
        src = open(full, encoding="utf-8").read()

        m = META_RE.search(src)
        if not m:
            problems.append(f"no meta description: {path}")
            continue
        old_raw = m.group(2)
        old_text = html.unescape(old_raw)
        n = len(new)
        if not (120 <= n <= 160):
            problems.append(f"out of range ({n}): {path}")
            continue

        if old_text.strip() == new.strip():
            continue

        out = src[:m.start()] + m.group(1) + esc(new) + m.group(3) + src[m.end():]
        # mirror only tags that duplicated the old meta description
        for rx in (OG_RE, TW_RE):
            mm = rx.search(out)
            if mm and html.unescape(mm.group(2)).strip() == old_text.strip():
                out = out[:mm.start()] + mm.group(1) + esc(new) + mm.group(3) + out[mm.end():]

        if apply:
            open(full, "w", encoding="utf-8").write(out)
        changed += 1
        print(f"  {path}: {len(old_text)} -> {len(new)}")

    print(f"\n{changed} page(s) {'rewritten' if apply else 'need rewriting'}")
    if problems:
        print("\nPROBLEMS:")
        for p in problems:
            print("  " + p)
        return 1
    if not apply:
        print("(dry run - pass --apply to write)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
