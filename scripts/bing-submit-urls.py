#!/usr/bin/env python3
"""Resubmit the priority URLs to Bing (POST + JSON body — GET returns 405).

Only run this when GetCrawlStats shows Bing is actually crawling again: the 2026-09-13
rule is that SubmitUrl is a zero-effect action while the crawler is stalled, and it
hides the real bottleneck. On 2026-09-21/22 CrawledPages went 0 -> 1 on two consecutive
days (first movement since 09-07), so the crawler is live again and submission is back
to being worth doing. Quota: 100/day, 800/month.
"""
import json
import urllib.request

KEY = "2926ffb8762244ceb2ce6fd423986ca9"
ENDPOINT = "https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlBatch"
SITE = "https://23232322.xyz/"

PATHS = [
    "/tools/json-formatter-online",
    "/base64-encode",
    "/base64-decode",
    "/tools/minifier",
    "/online-regex-tester",
    "/tools/url-encoder-decoder",
    "/tools/jwt-debugger",
    "/tools/sql-formatter-online",
    "/tools/html-entity-encoder-decoder",
    "/tools/uuid-generator",
    "/tools/timestamp-converter",
    "/tools/text-diff",
    "/tools/cidr-calculator",
    "/tools/hash-generator",
    "/tools/qrcode-tools",
    "/tools/color-tools",
    "/tools/image-compressor",
    "/tools/markdown-preview",
    "/tools/ai-cover-generator",
    "/tools/workplace-test/",
    "/",
    "/categories/",
    "/categories/code-ide",
    "/categories/api-network",
    "/categories/database-sql",
    "/categories/frontend-design",
    "/categories/devops-cicd",
    "/categories/security-testing",
    "/categories/dev-tools",
]

urls = [SITE.rstrip("/") + p if p != "/" else SITE for p in PATHS]
body = json.dumps({"siteUrl": SITE, "urlList": urls}).encode()
req = urllib.request.Request(
    ENDPOINT + "?apikey=" + KEY,
    data=body,
    headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=90) as r:
        print(f"HTTP {r.status}  body={r.read().decode()[:200]}")
    print(f"submitted {len(urls)} urls")
    for u in urls:
        print("  " + u)
except Exception as e:
    print(f"ERROR: {e}")
