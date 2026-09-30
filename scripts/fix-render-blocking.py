#!/usr/bin/env python3
"""Move the two tool pages' CDN libraries onto the non-blocking path.

Problem: both pages load a third-party CDN library with a plain <script src>
placed mid/late body, and the inline tool script right after it consumes the
global it defines. A classic blocking script halts the HTML parser, so the rest
of the document (for /tools/qrcode-tools that is *half* the page) cannot render
until jsdelivr answers.

Fix, in two parts (both required - doing only one is a regression):
  1. move the library to the end of <head> and mark it `defer`, so the fetch
     starts during head parsing and runs in parallel with the HTML download
     instead of serially after the parser reaches it;
  2. wrap the consuming inline script in a DOMContentLoaded listener.

Part 2 is load-bearing: a `defer`red script executes only after the document is
parsed, i.e. AFTER any inline script it sits next to. Left alone, the inline
script would run first and throw `ReferenceError: marked is not defined`.

DOMContentLoaded is still safe when the CDN is unreachable: a failed deferred
script does not prevent DOMContentLoaded from firing, and both pages already
branch on `typeof marked === 'undefined'` / try-catch around the QR globals.

Idempotent: re-running makes no change.
"""
import sys
import pathlib

PAGES = {
    "tools/markdown-preview.html": {
        "cdns": ["https://cdn.jsdelivr.net/npm/marked/marked.min.js"],
        "marker": "function updatePreview()",
        "anchor": '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    },
    "tools/qrcode-tools.html": {
        "cdns": [
            "https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js",
            "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js",
        ],
        "marker": "window.generateQR = function",
        "anchor": '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    },
}

# Handshake for the CDN that hosts those two libraries. Hoisting the tag into
# <head> makes the *transfer* start early, but DNS+TCP+TLS still costs 2-3 RTT
# before the first byte; preconnect at the top of <head> overlaps that with the
# HTML download. Measured effect on a warm-connection test rig is within noise
# (the harness reuses the socket, which hides the handshake), so it is kept as
# the standard complement rather than on the strength of a number.
PRECONNECT = '<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>'

WRAP_OPEN = "document.addEventListener('DOMContentLoaded', function(){"


def fix_page(path: pathlib.Path, spec, apply):
    text = path.read_text(encoding="utf-8")
    original = text
    notes = []

    # --- part 0: preconnect to the CDN, right after the viewport meta
    if PRECONNECT in text:
        notes.append("preconnect already present")
    else:
        anchor = spec["anchor"]
        at = text.find(anchor)
        if at < 0:
            return original, notes + ["!! anchor meta not found, preconnect NOT added"]
        at_end = text.index(">", at) + 1
        text = text[:at_end] + "\n" + PRECONNECT + text[at_end:]
        notes.append("added preconnect to cdn.jsdelivr.net")

    # --- part 1: pull the CDN tags out of the body, re-add them deferred in <head>
    head_end = text.find("</head>")
    if head_end < 0:
        return original, ["no </head> - skipped"]
    for cdn in spec["cdns"]:
        tag = '<script src="%s"></script>' % cdn
        if tag in text:
            text = text.replace(tag, "")
            notes.append("removed blocking tag %s" % cdn.rsplit("/", 1)[-1])
        elif cdns_already_deferred(text, cdn):
            notes.append("%s already deferred" % cdn.rsplit("/", 1)[-1])
        else:
            return original, ["!! could not find <script src> for %s" % cdn]
    head_end = text.find("</head>")
    for cdn in spec["cdns"]:  # insert in original order, each before </head>
        if not cdns_already_deferred(text, cdn):
            text = text[:head_end] + '<script defer src="%s"></script>\n' % cdn + text[head_end:]
            head_end = text.find("</head>")
            notes.append("added deferred tag in <head> for %s" % cdn.rsplit("/", 1)[-1])

    # --- part 2: defer the consuming inline script to DOMContentLoaded
    marker = spec["marker"]
    if marker not in text:
        return original, notes + ["!! inline marker not found, NOT wrapped"]
    open_at = text.rfind("<script", 0, text.index(marker))
    if open_at < 0:
        return original, notes + ["!! inline <script> not found"]
    open_end = text.index(">", open_at) + 1
    tag_text = text[open_at:open_end]
    if "src=" in tag_text or "ld+json" in tag_text:
        return original, notes + ["!! inline tag looks wrong: %r" % tag_text]
    close_at = text.index("</script>", open_end)
    inner = text[open_end:close_at]
    if WRAP_OPEN in inner:
        notes.append("inline script already wrapped in DOMContentLoaded")
    else:
        text = (text[:open_end] + "\n" + WRAP_OPEN + inner + "});\n" + text[close_at:])
        notes.append("wrapped inline script in DOMContentLoaded")

    if text == original:
        return original, notes + ["no change"]
    return text, notes


def cdns_already_deferred(text, cdn):
    return '<script defer src="%s"></script>' % cdn in text


def main():
    apply = "--apply" in sys.argv
    webroot = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("-") else "public")
    changed = 0
    for rel, spec in PAGES.items():
        path = webroot / rel
        if not path.exists():
            print("MISSING %s" % path)
            continue
        new, notes = fix_page(path, spec, apply)
        status = "would change" if new != path.read_text(encoding="utf-8") else "no change"
        print("%-34s %s" % (rel, status))
        for n in notes:
            print("    - %s" % n)
        if new != path.read_text(encoding="utf-8"):
            changed += 1
            if apply:
                path.write_text(new, encoding="utf-8")
    print("%d page(s) %s" % (changed, "rewritten" if apply else "would be rewritten"))


if __name__ == "__main__":
    main()
