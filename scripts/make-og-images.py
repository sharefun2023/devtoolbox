#!/usr/bin/env python3
"""Generate the 1200x630 Open Graph share cards (one per indexable page).

Why: 23 of 24 indexable pages shipped no og:image at all, and the one page that
did declare one (`/tools/ai-cover-generator` -> /tools/ai-cover-og.png) pointed
at a file that was never built (live 404). Every inbound share link therefore
rendered as a bare text card.

Design language is the site's own CSS variables: bg #0a0e14, card border
#1e2a3a, accent #39bae6, text #c8d6e5, bright #e8f0fe.

Text is drawn from hand-written short headlines (below), not scraped titles --
scraped <title>s run to 100+ chars and would overflow the card.

Run: python3 scripts/make-og-images.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

BG = (10, 14, 20)
GRID = (16, 22, 31)
BORDER = (30, 42, 58)
ACCENT = (57, 186, 230)
BRIGHT = (232, 240, 254)
TEXT = (200, 214, 229)
DIM = (107, 125, 149)

W, H = 1200, 630
FONT_DIR = "/usr/share/fonts/truetype/dejavu/"
BOLD = FONT_DIR + "DejaVuSans-Bold.ttf"
REG = FONT_DIR + "DejaVuSans.ttf"
MONO_B = FONT_DIR + "DejaVuSansMono-Bold.ttf"

# slug -> (headline, one-line subtitle)
CARDS = {
    "home": ("DevToolBox", "80+ free developer tools that run entirely in your browser"),
    "about": ("About DevToolBox", "A curated directory of free developer tools"),
    "privacy": ("Privacy Policy", "No accounts, no tracking, nothing uploaded"),
    "base64-decode": ("Base64 Decoder", "Decode Base64 to text, UTF-8 and data URIs"),
    "base64-encode": ("Base64 Encoder", "Encode text and files to Base64, URL-safe output"),
    "online-regex-tester": ("Regex Tester Online", "Test, debug and explain regular expressions"),
    "categories": ("Browse by Category", "Code & IDE, API, SQL, Frontend, DevOps, Security"),
    "categories/api-network": ("API & Network Tools", "HTTP clients, REST and WebSocket debugging"),
    "categories/code-ide": ("Code & IDE Tools", "Editors, formatters, diff checkers and regex"),
    "categories/database-sql": ("Database & SQL Tools", "SQL formatters, schema designers and GUIs"),
    "categories/dev-tools": ("Developer Utilities", "CIDR, timestamps, UUIDs, diff and more"),
    "categories/devops-cicd": ("DevOps & CI/CD Tools", "Pipelines, containers, infra as code, monitoring"),
    "categories/frontend-design": ("Frontend & Design Tools", "CSS generators, colour tools, icons and fonts"),
    "categories/security-testing": ("Security & Testing Tools", "JWT debugging, scanners and test frameworks"),
    "cron": ("Cron Expression Editor", "Human-readable cron with next-run preview"),
    "tools/json-formatter-online": ("JSON Formatter & Validator", "Format, validate and minify JSON with error positions"),
    "tools/sql-formatter-online": ("SQL Formatter Online", "One clause per line, every token preserved"),
    "tools/minifier": ("HTML Minifier Online", "Minify HTML, CSS and JavaScript in the browser"),
    "tools/jwt-debugger": ("JWT Debugger", "Decode and verify HS256 / RS256 / ES256 tokens"),
    "tools/url-encoder-decoder": ("URL Encoder Decoder", "Percent-encoding, RFC 3986 and form data"),
    "tools/html-entity-encoder-decoder": ("HTML Entity Encoder", "Escape and unescape named & numeric entities"),
    "tools/timestamp-converter": ("Timestamp Converter", "Epoch seconds, millis, micros and nanos to dates"),
    "tools/uuid-generator": ("UUID Generator", "v4, v7, v1, GUID, NanoID and ULID in bulk"),
    "tools/hash-generator": ("Hash Generator", "MD5, SHA-1, SHA-256, SHA-384 and SHA-512"),
    "tools/text-diff": ("Diff Checker", "Compare two texts line by line, side by side"),
    "tools/color-tools": ("Color Picker & Converter", "HEX, RGB, HSL and palette generation"),
    "tools/cidr-calculator": ("CIDR Subnet Calculator", "IPv4 and IPv6 network, mask and host ranges"),
    "tools/qrcode-tools": ("QR Code Generator", "Generate and read QR codes, download as PNG"),
    "tools/markdown-preview": ("Markdown Preview", "Live Markdown to HTML with GFM tables and code"),
    "tools/image-compressor": ("Image Compressor", "Shrink PNG, JPG and WebP without uploading"),
    "tools/workplace-test": ("Workplace Test", "Interactive developer skills check"),
    "tools/ai-cover-generator": ("AI Cover Generator", "Social covers, blog headers and thumbnails"),
}


def font(path, size):
    return ImageFont.truetype(path, size)


def text_w(draw, s, f):
    box = draw.textbbox((0, 0), s, font=f)
    return box[2] - box[0], box[3] - box[1]


def wrap(draw, text, f, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if text_w(draw, trial, f)[0] <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def draw_card(slug, headline, subtitle):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # faint technical grid, so the card reads as "developer tool" not "flyer"
    for x in range(0, W, 60):
        d.line([(x, 0), (x, H)], fill=GRID, width=1)
    for y in range(0, H, 60):
        d.line([(0, y), (W, y)], fill=GRID, width=1)

    # left accent spine
    d.rectangle([0, 0, 10, H], fill=ACCENT)

    # brand row
    mark = font(MONO_B, 34)
    d.text((62, 54), "</>", font=mark, fill=ACCENT)
    d.text((140, 60), "DevToolBox", font=font(BOLD, 32), fill=BRIGHT)

    # headline: shrink until it fits two lines inside the safe width.
    # The headline block is bottom-anchored at HEAD_BOTTOM so 1-line and 2-line
    # titles sit on the same optical line.
    safe_w = W - 124
    size = 86
    f = font(BOLD, size)
    lines = wrap(d, headline, f, safe_w)
    while size > 40:
        f = font(BOLD, size)
        lines = wrap(d, headline, f, safe_w)
        if len(lines) <= 2 and all(text_w(d, ln, f)[0] <= safe_w for ln in lines):
            break
        size -= 2
    line_h = int(size * 1.18)
    HEAD_BOTTOM = 330
    y = HEAD_BOTTOM - len(lines) * line_h
    for ln in lines:
        d.text((62, y), ln, font=f, fill=BRIGHT)
        y += line_h

    # subtitle, always below the headline block and above the footer rule
    fs = font(REG, 30)
    sub_lines = wrap(d, subtitle, fs, safe_w)[:2]
    sy = HEAD_BOTTOM + 26
    for ln in sub_lines:
        d.text((62, sy), ln, font=fs, fill=TEXT)
        sy += 42

    # footer
    d.line([(62, H - 108), (W - 62, H - 108)], fill=BORDER, width=2)
    d.text((62, H - 82), "23232322.xyz", font=font(BOLD, 28), fill=ACCENT)
    d.text((300, H - 82), "Free online tools  ·  nothing leaves your browser",
           font=font(REG, 26), fill=DIM)

    out = os.path.join(OUT, slug + ".png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out, "PNG", optimize=True)
    return out, lines


OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "og")
OUT = os.path.abspath(OUT)

if __name__ == "__main__":
    for slug, (headline, subtitle) in CARDS.items():
        path, lines = draw_card(slug, headline, subtitle)
        im = Image.open(path)
        print(f"{os.path.relpath(path):48s} {im.size[0]}x{im.size[1]} "
              f"{os.path.getsize(path)//1024:>3d}KB  lines={len(lines)}  {headline}")
