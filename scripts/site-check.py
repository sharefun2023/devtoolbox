#!/usr/bin/env python3
"""Static integrity check for the DevToolBox site.

Verifies, without a browser:
  1. every page that ships a tool script references it, and every element id the
     script's init() looks up actually exists in that page
  2. no "tool-cta" points back at the page it is on (the dead-end stub bug)
  3. every internal link resolves to a file in public/
  4. canonical + og:url use the custom domain (never *.pages.dev)
  5. every JSON-LD block parses as JSON
  6. no duplicate <title>, no missing <h1>
  7. tag balance (div/section/main/table/ul/ol/p) per page

Run: python3 scripts/site-check.py [--webroot public]
"""
import json
import os
import re
import sys
from collections import defaultdict

WEBROOT = "public"
if "--webroot" in sys.argv:
    WEBROOT = sys.argv[sys.argv.index("--webroot") + 1]

PAGES = []
for dirpath, _dirnames, filenames in os.walk(WEBROOT):
    for fn in filenames:
        if fn.endswith(".html"):
            PAGES.append(os.path.join(dirpath, fn))
PAGES.sort()

def url_of(path):
    rel = os.path.relpath(path, WEBROOT)
    rel = rel[:-5]  # drop .html
    if rel == "index":
        return "/"
    if rel.endswith("/index"):
        return "/" + rel[: -len("index")]
    return "/" + rel

errors = []
warnings = []

# ── collect site urls ────────────────────────────────────────────────────────
site_urls = set()
for p in PAGES:
    site_urls.add(url_of(p))
    site_urls.add(url_of(p).rstrip("/"))
site_urls.add("/")

# URLs served from a <dir>/index.html (CF Pages serves those with a trailing slash
# and 308-redirects the slash-less form), excluding the site root.
DIR_URLS = {u for u in site_urls if u != "/" and u.endswith("/")}

titles = defaultdict(list)
tool_pages = []

for path in PAGES:
    html = open(path, encoding="utf-8").read()
    url = url_of(path)
    label = url
    noindex = bool(re.search(r'<meta[^>]+name=["\']robots["\'][^>]*noindex', html, re.I))

    # 1. tool scripts ↔ ids
    scripts = re.findall(r'<script src="(/js/[^"]+)"', html)
    if scripts:
        tool_pages.append((url, scripts))
    ids_in_html = set(re.findall(r'\bid="([^"]+)"', html))
    for s in scripts:
        js_path = os.path.join(WEBROOT, s.lstrip("/"))
        if not os.path.exists(js_path):
            errors.append(f"{label}: script {s} does not exist")
            continue
        js = open(js_path, encoding="utf-8").read()
        wanted = set(re.findall(r"getElementById\(\s*'([^']+)'", js)) | set(re.findall(r'getElementById\(\s*"([^"]+)"', js))
        missing = sorted(wanted - ids_in_html)
        # the first getElementById is the guard that decides whether init runs at all
        guard = re.search(r"function init\(\)\s*\{\s*var \w+ = document\.getElementById\('([^']+)'\);\s*if \(!\w+\) return;", js)
        if guard and guard.group(1) not in ids_in_html:
            errors.append(f"{label}: tool guard id #{guard.group(1)} missing — the tool would never boot")
            missing = [m for m in missing if m != guard.group(1)]
        if missing:
            warnings.append(f"{label}: {s} expects ids not present: {', '.join(missing)}")
        if '<link rel="stylesheet" href="/css/tool.css">' not in html:
            errors.append(f"{label}: ships {s} but does not load /css/tool.css")

    # 2. self-referencing CTA
    for cta in re.findall(r'<a[^>]+class="tool-cta"[^>]*>', html):
        m = re.search(r'href="([^"]+)"', cta)
        if m:
            href = m.group(1)
            if href != url and href != url.rstrip("/"):
                continue
            errors.append(f"{label}: tool-cta points at the page itself ({href}) — dead end")

    # 3. internal links
    for href in re.findall(r'href="(/[^"#?]*)"', html):
        h = href
        # a link to a slash-less directory URL costs a 308 hop (CF Pages serves /cron/)
        if not h.endswith("/") and h.rstrip("/") + "/" in DIR_URLS:
            errors.append(f"{label}: internal link {h} points at a directory page without the "
                          f"trailing slash (CF Pages 308-redirects it)")
        if h in site_urls:
            continue
        cands = [
            os.path.join(WEBROOT, h.lstrip("/")),
            os.path.join(WEBROOT, h.lstrip("/") + ".html"),
            os.path.join(WEBROOT, h.lstrip("/"), "index.html"),
        ]
        if not any(os.path.exists(c) for c in cands):
            if not re.search(r"\.(css|js|xml|txt|png|jpg|svg|ico|webmanifest)$", h):
                errors.append(f"{label}: dead internal link {h}")

    # 4. canonical / og:url
    can = re.search(r'<link rel="canonical" href="([^"]+)"', html)
    if not can:
        if not noindex:
            errors.append(f"{label}: missing canonical")
    else:
        if "pages.dev" in can.group(1):
            errors.append(f"{label}: canonical still points at pages.dev ({can.group(1)})")
        # compare with the trailing slash normalised away (/categories/ == /categories)
        if can.group(1).rstrip("/") != f"https://23232322.xyz{url}".rstrip("/") and url != "/":
            warnings.append(f"{label}: canonical {can.group(1)} does not match {url}")
        # but a directory page must declare the trailing slash: the slash-less form
        # 308-redirects, so a slash-less canonical points at a redirect
        if url in DIR_URLS and not can.group(1).endswith("/"):
            errors.append(f"{label}: canonical {can.group(1)} omits the trailing slash, "
                          f"which 308-redirects back to {url}")
    for prop in ("og:url",):
        m = re.search(r'<meta property="%s" content="([^"]+)"' % prop, html)
        if not m:
            if not noindex:
                errors.append(f"{label}: missing {prop}")
        elif "pages.dev" in m.group(1):
            errors.append(f"{label}: {prop} points at pages.dev")
        elif m.group(1).rstrip("/") != f"https://23232322.xyz{url}".rstrip("/") and url != "/":
            warnings.append(f"{label}: {prop} {m.group(1)} does not match {url}")
    if not noindex:
        for tag in ("og:title", "og:description", "og:type"):
            if not re.search(r'<meta property="%s" content="[^"]+"' % tag, html):
                errors.append(f"{label}: missing {tag}")
        if not re.search(r'<meta name="twitter:card" content="[^"]+"', html):
            errors.append(f"{label}: missing twitter:card")

    # 5. JSON-LD parses
    for i, block in enumerate(re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)):
        try:
            json.loads(block)
        except Exception as exc:
            errors.append(f"{label}: JSON-LD block {i + 1} is invalid: {exc}")

    # 6. titles and h1
    t = re.search(r"<title>(.*?)</title>", html, re.S)
    if not t:
        errors.append(f"{label}: missing <title>")
    else:
        titles[t.group(1).strip()].append(url)
    if "<h1" not in html:
        errors.append(f"{label}: missing <h1>")
    h1s = re.findall(r"<h1[^>]*>(.*?)</h1>", html, re.S)
    if len(h1s) > 1:
        warnings.append(f"{label}: {len(h1s)} <h1> elements")

    # 7. crude tag balance for the containers that break layout
    for tag in ("div", "section", "main", "table", "tr", "ul", "ol", "nav", "table", "textarea"):
        opens = len(re.findall(r"<%s[\s>]" % tag, html))
        closes = len(re.findall(r"</%s>" % tag, html))
        if opens != closes:
            errors.append(f"{label}: <{tag}> unbalanced ({opens} open / {closes} close)")

    # sitemap membership note
    sitemap = open(os.path.join(WEBROOT, "sitemap.xml"), encoding="utf-8").read()
    locs = set(re.findall(r"<loc>([^<]+)</loc>", sitemap))
    bare = url.rstrip("/") or "/"
    if url != "/" and not noindex:
        if f"https://23232322.xyz{bare}" not in locs and f"https://23232322.xyz{bare}/" not in locs:
            warnings.append(f"{label}: not in sitemap.xml")

for title, urls in titles.items():
    if len(urls) > 1:
        errors.append(f"duplicate <title> across {urls}: {title[:80]}")

# every sitemap <loc> must resolve to a page we actually ship
pages_known = {u.rstrip("/") or "/" for u in site_urls}
for loc in sorted(re.findall(r"<loc>([^<]+)</loc>", open(os.path.join(WEBROOT, "sitemap.xml"), encoding="utf-8").read())):
    rel = loc.replace("https://23232322.xyz", "").rstrip("/") or "/"
    if rel in pages_known:
        continue
    errors.append(f"sitemap.xml lists {loc} but no page exists for it")

print(f"pages checked: {len(PAGES)}")
print(f"pages with tool scripts: {len(tool_pages)}")
for u, s in tool_pages:
    print(f"  {u}  →  {', '.join(s)}")
print()
if warnings:
    print(f"⚠️  {len(warnings)} warning(s):")
    for w in warnings:
        print("   - " + w)
if errors:
    print(f"\n❌ {len(errors)} error(s):")
    for e in errors:
        print("   - " + e)
    sys.exit(1)
print("\n✅ no errors")
