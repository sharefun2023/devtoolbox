#!/usr/bin/env python3
"""Ship a complete, correctly-ordered Open Graph / Twitter card block site-wide.

Context (2026-09-24): 32 indexable pages declared no og:image, no page declared
og:site_name or twitter:image, every twitter:card said `summary` (a 1200x630
card rendered as a small square), and the single page that *did* declare an
og:image pointed at `/tools/ai-cover-og.png`, which was never generated -- live
404. Every inbound share link therefore rendered text-only or broken.

The cards themselves are produced by scripts/make-og-images.py (one 1200x630 PNG
per indexable page); this script wires them into the pages. It rewrites the whole
og/twitter group rather than appending tags, because the existing groups are
inconsistently ordered and somes pages put two tags on one physical line, which
makes line-anchored inserts unreliable. Values that the page already declares are
kept (og:title / og:description / og:url <- canonical); nothing is invented.

Pages with <meta name="robots" content="noindex"> are left alone on purpose --
a 404 has no business advertising a card.

Run: python3 scripts/add-og-image.py [--webroot public] [--dry-run]
"""
import importlib.util
import os
import re
import sys

WEBROOT = "public"
if "--webroot" in sys.argv:
    WEBROOT = sys.argv[sys.argv.index("--webroot") + 1]
DRY = "--dry-run" in sys.argv
BASE = "https://23232322.xyz"

_spec = importlib.util.spec_from_file_location(
    "make_og_images", os.path.join(os.path.dirname(os.path.abspath(__file__)), "make-og-images.py"))
_m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_m)
HEADLINES = {slug: hl for slug, (hl, _sub) in _m.CARDS.items()}

TAG_RE = re.compile(
    r'[ \t]*<meta\s+(?:property=["\']og:[^"\']*["\']|name=["\']twitter:[^"\']*["\'])[^>]*>[ \t]*',
    re.I)
KEY_RE = re.compile(r'(?:property|name)=["\']((?:og|twitter):[^"\']*)["\']', re.I)
CONTENT_RE = re.compile(r'content=["\'](.*?)["\']', re.I | re.S)


def attr(regex, html):
    m = re.search(regex, html, re.S | re.I)
    return m.group(1).strip() if m else None


def clip(text, limit=200):
    """Trim to a word boundary so a preview never shows half a word."""
    text = re.sub(r"\s+", " ", text or "").strip()
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0].rstrip(",;:-")
    cut = re.sub(r"&[a-zA-Z]*$", "", cut)
    return cut + "…"


def slug_for(path):
    rel = os.path.relpath(path, WEBROOT).replace(os.sep, "/")
    if rel.endswith("index.html"):
        return rel[: -len("index.html")].strip("/") or "home"
    return rel[:-5] if rel.endswith(".html") else rel


changed, skipped = [], []

for dirpath, _dirs, filenames in os.walk(WEBROOT):
    for fn in sorted(filenames):
        if not fn.endswith(".html"):
            continue
        path = os.path.join(dirpath, fn)
        html = open(path, encoding="utf-8").read()
        head = html[: html.find("</head>")]
        if re.search(r'name=["\']robots["\'][^>]*noindex', head, re.I):
            skipped.append((path, "noindex"))
            continue

        slug = slug_for(path)
        card_rel = f"og/{slug}.png"
        if not os.path.exists(os.path.join(WEBROOT, card_rel)):
            skipped.append((path, f"NO CARD {card_rel} -- run make-og-images.py"))
            continue
        if slug not in HEADLINES:
            skipped.append((path, f"NO HEADLINE for '{slug}' in make-og-images.py"))
            continue
        card_url = f"{BASE}/{card_rel}"

        # --- collect the existing og/twitter tags (values reused, order rebuilt)
        present = {}
        spans = []
        for m in TAG_RE.finditer(head):
            key_m = KEY_RE.search(m.group(0))
            if not key_m:
                continue
            key = key_m.group(1).lower()
            val = CONTENT_RE.search(m.group(0))
            spans.append((m.start(), m.end(), key))
            if key not in present:
                present[key] = val.group(1) if val else ""
        if not spans:
            skipped.append((path, "no og/twitter block to rewrite"))
            continue

        canonical = attr(r'<link\s+rel=["\']canonical["\'][^>]*href=["\']([^"\']+)["\']', head)
        title = present.get("og:title") or attr(r"<title>(.*?)</title>", head) or ""
        desc = present.get("og:description") or clip(
            attr(r'<meta\s+name=["\']description["\'][^>]*content=["\'](.*?)["\']', head)) or title

        block_lines = [
            f'<meta property="og:title" content="{title}">',
            f'<meta property="og:description" content="{desc}">',
            f'<meta property="og:url" content="{canonical}">',
            '<meta property="og:type" content="website">',
            f'<meta property="og:image" content="{card_url}">',
            '<meta property="og:image:width" content="1200">',
            '<meta property="og:image:height" content="630">',
            f'<meta property="og:image:alt" content="{HEADLINES[slug]}">',
            '<meta property="og:site_name" content="DevToolBox">',
            '<meta name="twitter:card" content="summary_large_image">',
            f'<meta name="twitter:title" content="{title}">',
            f'<meta name="twitter:description" content="{desc}">',
            f'<meta name="twitter:image" content="{card_url}">',
        ]

        # --- remove the old tags (descending so earlier offsets stay valid)
        insert_at = spans[0][0]
        line_start = head.rfind("\n", 0, insert_at) + 1
        indent = head[line_start:insert_at]
        indent = indent if indent.strip() == "" else "  "
        new_head = head
        for start, end, _key in sorted(spans, reverse=True):
            new_head = new_head[:start] + new_head[end:]
        block = "\n" + "\n".join(indent + ln for ln in block_lines)
        new_head = new_head[:insert_at] + block + new_head[insert_at:]
        new_head = re.sub(r"\n{3,}", "\n\n", new_head)
        new_html = new_head + html[len(head):]

        if new_html == html:
            skipped.append((path, "already up to date"))
            continue
        if not DRY:
            open(path, "w", encoding="utf-8").write(new_html)
        changed.append((path, len(block_lines), card_rel))

print(("DRY RUN -- " if DRY else "") + f"{len(changed)} page(s) rewritten:")
for p, n, card in changed:
    print(f"  {p:52s} og/tw block = {n} tags -> {card}")
if skipped:
    print(f"skipped {len(skipped)}:")
    for p, why in skipped:
        print(f"  {p:52s} {why}")
