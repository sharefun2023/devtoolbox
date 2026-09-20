#!/usr/bin/env python3
"""Add the missing OG / Twitter social-card meta to pages that never had them.

House style (copied from /tools/minifier, the reference page):

    <meta property="og:title"       content="...">
    <meta property="og:description" content="...">
    <meta property="og:url"         content="<canonical>">
    <meta property="og:type"        content="website">
    <meta name="twitter:card"        content="summary">
    <meta name="twitter:title"       content="...">
    <meta name="twitter:description" content="...">

Values are derived from what the page already declares (its <title> and
<meta name="description">) so nothing is invented, and og:url always mirrors the
page's own canonical. Pages marked <meta name="robots" content="noindex"> are
skipped on purpose — a 404 has no business shipping a social card.

Run: python3 scripts/add-social-meta.py [--webroot public] [--dry-run]
"""
import os
import re
import sys

WEBROOT = "public"
if "--webroot" in sys.argv:
    WEBROOT = sys.argv[sys.argv.index("--webroot") + 1]
DRY = "--dry-run" in sys.argv

DESC_RE = re.compile(r"""<meta\s+name=["']description["']\s+content=["'](.*?)["']\s*>""", re.S)


def attr(regex, html):
    m = re.search(regex, html, re.S | re.I)
    return m.group(1).strip() if m else None


def clip(text, limit=200):
    """Trim to a word boundary so we never emit a half-word in a preview card."""
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0].rstrip(",;:-")
    cut = re.sub(r"&[a-zA-Z]*$", "", cut).rstrip()  # never cut an HTML entity in half
    return cut + "…"


def find_insert_anchor(html):
    """Insert after the last existing og: meta tag, else before <link rel="canonical">.

    Keeps the og:* group and the twitter:* group adjacent and in that order no
    matter where the page happened to put its og tags.
    """
    oges = list(re.finditer(r'^[ \t]*<meta\s+property=["\']og:[^>]*>[ \t]*$', html, re.M))
    if oges:
        return oges[-1].end()
    m = re.search(r'^[ \t]*<link\s+rel=["\']canonical["\']', html, re.M)
    if m:
        return m.start()
    m = re.search(r"</title>", html)
    return m.end() if m else None


changed = []
skipped = []

for dirpath, _dirs, filenames in os.walk(WEBROOT):
    for fn in sorted(filenames):
        if not fn.endswith(".html"):
            continue
        path = os.path.join(dirpath, fn)
        html = open(path, encoding="utf-8").read()
        head_end = html.find("</head>")
        head = html[:head_end]

        if re.search(r'name=["\']robots["\'][^>]*noindex', head, re.I):
            skipped.append((path, "noindex"))
            continue

        canonical = attr(r'<link\s+rel=["\']canonical["\'][^>]*href=["\']([^"\']+)["\']', head)
        title = attr(r"<title>(.*?)</title>", head)
        desc = attr(r"""<meta\s+name=["']description["']\s+content=["'](.*?)["']\s*>""", head)
        if not canonical or not title:
            skipped.append((path, "no canonical or title"))
            continue

        desc = clip(desc) if desc else title
        want_og = not re.search(r'property=["\']og:url["\']', head, re.I)
        want_tw = not re.search(r'name=["\']twitter:card["\']', head, re.I)
        if not want_og and not want_tw:
            continue

        block = []
        if want_og:
            block += [
                f'<meta property="og:title" content="{title}">',
                f'<meta property="og:description" content="{desc}">',
                f'<meta property="og:url" content="{canonical}">',
                '<meta property="og:type" content="website">',
            ]
        if want_tw:
            # when an og block already exists, reuse its (possibly trimmed) text
            ogt = attr(r'property=["\']og:title["\'][^>]*content=["\'](.*?)["\']', head) or title
            ogd = attr(r'property=["\']og:description["\'][^>]*content=["\'](.*?)["\']', head) or desc
            block += [
                '<meta name="twitter:card" content="summary">',
                f'<meta name="twitter:title" content="{ogt}">',
                f'<meta name="twitter:description" content="{ogd}">',
            ]

        anchor = find_insert_anchor(html)
        if anchor is None:
            skipped.append((path, "no anchor"))
            continue
        # match the indentation of the line we are anchoring on
        line_start = html.rfind("\n", 0, anchor) + 1
        indent = html[line_start:anchor]
        indent = indent if indent.strip() == "" else "  "
        block_text = "\n" + "\n".join(indent + b for b in block)
        new_html = html[:anchor] + block_text + html[anchor:]

        if not DRY:
            open(path, "w", encoding="utf-8").write(new_html)
        changed.append((path, len(block), "og+tw" if want_og and want_tw else ("og" if want_og else "tw")))

print(("DRY RUN — " if DRY else "") + f"{len(changed)} page(s) updated:")
for p, n, kind in changed:
    print(f"  {p}  (+{n} tags, {kind})")
if skipped:
    print(f"skipped {len(skipped)}:")
    for p, why in skipped:
        print(f"  {p}  ({why})")
