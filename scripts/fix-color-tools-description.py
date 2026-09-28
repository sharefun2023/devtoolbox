#!/usr/bin/env python3
"""Fix the two things live verification caught on /tools/color-tools:

1. the description I shipped was 173 chars -- over the ~160 SERP truncation line
   that the 2026-09-27 pass deliberately pulled all 32 pages under (138-156).
2. og:description / twitter:description were verbatim copies of the old meta
   description, so per the 09-27 rule they must be re-synced when it changes.

Idempotent; asserts the final length before writing.
"""
P = "public/tools/color-tools.html"
OLD = ("Free color picker and converter: convert HEX, RGB and HSL instantly, pick colors visually "
       "and build complementary, analogous, triadic or monochromatic palettes. Client-side.")
NEW = ("Free color picker and converter: convert HEX, RGB and HSL as you type, pick colors visually "
       "and build complementary, analogous or monochromatic palettes.")
OLD_OG = ("Free color tools online: convert between HEX, RGB and HSL, pick colors with a visual "
          "picker, and generate complementary and analogous palettes. Client-side.")

assert 138 <= len(NEW) <= 156, f"description length {len(NEW)} outside the 138-156 band"
assert NEW[:60].lower().count("color picker"), "head term must sit inside the first 60 chars"

src = open(P, encoding="utf-8").read()
n = src.count(OLD)
if n == 0:
    print("already applied")
else:
    assert n == 1, f"expected 1 meta description hit, found {n}"
    src = src.replace(OLD, NEW)
    assert src.count(OLD_OG) == 2, f"expected og+twitter copies, found {src.count(OLD_OG)}"
    src = src.replace(OLD_OG, NEW)
    open(P, "w", encoding="utf-8").write(src)
    print(f"ok  description {len(OLD)} -> {len(NEW)} chars; og/twitter re-synced")
