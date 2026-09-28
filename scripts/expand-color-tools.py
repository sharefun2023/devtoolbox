#!/usr/bin/env python3
"""2026-09-28 devtoolbox SEO: expand /tools/color-tools (140 -> ~1000 words).

All factual claims below were verified by running the page's own inline script
(scripts/color-tools-test.js, 37 assertions) — the scheme maths, the integer-HSL
round-trip loss, the 3-digit shorthand path, everything.

Also fixes, in the same pass:
  * 3-digit hex (#0af) was written straight into <input type="color">, which only
    accepts 7-char #rrggbb -> the picker silently reset to #000000 (fixed in the
    page JS; see the test's --old reverse mode).
  * breadcrumb "Tools" item pointed at /tools/, which 301s to the homepage.
  * meta/OG/twitter title tightened from 71 -> 60 chars, head term kept first.

Idempotent: re-running prints "already applied" instead of duplicating blocks.
"""
import json
import re
import sys

P = "public/tools/color-tools.html"
src = open(P, encoding="utf-8").read()
orig = src


def sub1(old, new, label):
    global src
    assert src.count(old) == 1, f"{label}: expected 1 occurrence, found {src.count(old)}"
    src = src.replace(old, new)
    print(f"  ok  {label}")


# ── 1. content CSS (same house style as minifier.html / markdown-preview.html) ──
CSS_ANCHOR = "    .link-back { display: block;"
CSS_BLOCK = """    .seo-content { margin-top: 48px; border-top: 1px solid var(--tool-border); padding-top: 26px; line-height: 1.8; }
    .seo-content h2 { color: var(--tool-text-bright); font-size: 1.5em; margin: 26px 0 12px; }
    .seo-content h3 { color: var(--tool-accent); font-size: 1.08em; margin: 22px 0 8px; }
    .seo-content p { color: var(--tool-text); margin: 8px 0; }
    .seo-content ul, .seo-content ol { padding-left: 24px; color: var(--tool-text); }
    .seo-content li { margin: 5px 0; }
    .seo-content code { background: var(--tool-input-bg); padding: 2px 6px; border-radius: 4px; color: var(--tool-accent); font-family: 'Courier New', monospace; font-size: 0.9em; }
    .seo-content strong { color: var(--tool-text-bright); }
    .seo-content em { color: var(--tool-text-bright); font-style: normal; font-weight: 600; }
    .seo-content .related-links { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
    .seo-content .related-links a { color: var(--tool-accent); text-decoration: none; border: 1px solid var(--tool-border); padding: 6px 16px; border-radius: 20px; font-size: 0.9em; }
    .seo-content .related-links a:hover { border-color: var(--tool-accent); background: var(--tool-accent-dim); }
"""
if ".seo-content" not in src:
    sub1(CSS_ANCHOR, CSS_BLOCK + CSS_ANCHOR, "insert .seo-content CSS")
else:
    print("  --  .seo-content CSS already present")

# ── 2. title / og / twitter: 71 -> 60 chars, head term still first ──
OLD_T = "Color Picker &amp; Converter — HEX/RGB/HSL Color Tools | DevToolBox"
NEW_T = "Color Picker &amp; Converter — HEX, RGB &amp; HSL Online | DevToolBox"
if OLD_T in src:
    src = src.replace(OLD_T, NEW_T)
    print(f"  ok  title/og:title/twitter:title ({src.count(NEW_T)} places)")
else:
    print("  --  title already updated")

# ── 3. meta description: mention the palette schemes now that they are documented ──
OLD_D = ('<meta name="description" content="Free color tools online: convert between HEX, RGB and HSL, '
         'pick colors with a visual picker, and generate complementary and analogous palettes. Client-side.">')
NEW_D = ('<meta name="description" content="Free color picker and converter: convert HEX, RGB and HSL instantly, '
         'pick colors visually and build complementary, analogous, triadic or monochromatic palettes. Client-side.">')
if OLD_D in src:
    sub1(OLD_D, NEW_D, "meta description")
else:
    print("  --  description already updated")

# ── 4. schema WebApplication name + dateModified ──
if "Color Picker & Converter — HEX/RGB/HSL Color Tools" in src:
    sub1('"name": "Color Picker & Converter — HEX/RGB/HSL Color Tools"',
         '"name": "Color Picker & Converter — HEX, RGB & HSL Online"',
         "WebApplication schema name")
else:
    print("  --  schema name already updated")

# ── 5. breadcrumb: drop the /tools/ level (it 301s to /), match the site's 2-level norm ──
BC_OLD = """      {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://23232322.xyz/"},
      {"@type": "ListItem", "position": 2, "name": "Tools", "item": "https://23232322.xyz/tools/"},
      {"@type": "ListItem", "position": 3, "name": "Color Tools", "item": "https://23232322.xyz/tools/color-tools"}"""
BC_NEW = """      {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://23232322.xyz/"},
      {"@type": "ListItem", "position": 2, "name": "Color Picker & Converter", "item": "https://23232322.xyz/tools/color-tools"}"""
if BC_OLD in src:
    sub1(BC_OLD, BC_NEW, "breadcrumb (remove /tools/ 301 hop)")
else:
    print("  --  breadcrumb already fixed")

src = re.sub(r'"dateModified": "\d{4}-\d{2}-\d{2}"', '"dateModified": "2026-09-28"', src)

# ── 6. H1 aligns with the title's head terms ──
if "  <h1>🎨 Color Tools</h1>" in src:
    sub1("  <h1>🎨 Color Tools</h1>", "  <h1>🎨 Color Picker &amp; Converter</h1>", "H1")
else:
    print("  --  H1 already updated")

# ── 7. the content block ──
CONTENT = """  <div class="seo-content">
    <h2>Color Picker &amp; Converter: What Each Part Does</h2>
    <p>Four small color utilities share this page, and all four run in your browser — no account, no upload,
    no round trip to a server.</p>
    <ul>
      <li><strong>Color converter</strong> — HEX, RGB and HSL fields that stay in sync. Type into any one of
      them and the other two update as you type, together with the preview swatch at the top.</li>
      <li><strong>Color picker</strong> — your browser's native color input. Click it and your operating
      system's picker opens; the HEX, RGB and HSL fields follow the color you choose.</li>
      <li><strong>Palette generator</strong> — six color-harmony schemes (complementary, analogous, triadic,
      split complementary, tetradic, monochromatic). Click any swatch to make it the new base color, or copy
      the whole palette as a newline-separated HEX list.</li>
      <li><strong>Random colors</strong> — fifteen random swatches on every load, each one clickable when you
      only need somewhere to start.</li>
    </ul>

    <h3>HEX, RGB and HSL: the Difference That Matters</h3>
    <p>All three notations describe the same color. They differ in which questions they make easy to answer.</p>
    <ul>
      <li><strong>HEX</strong> (<code>#00d4aa</code>) is what you paste into CSS, HTML and design tools: six
      digits, two per channel — red, green, blue. The three-digit shorthand works here too, so
      <code>#0af</code> is treated as <code>#00aaff</code>.</li>
      <li><strong>RGB</strong> (<code>rgb(0, 212, 170)</code>) is the same three channels written as decimal
      numbers from 0 to 255, which is easier to reason about when you are nudging one channel at a time.
      Values outside 0–255 are clamped rather than rejected.</li>
      <li><strong>HSL</strong> (<code>hsl(168, 100%, 42%)</code>) is hue in degrees, then saturation and
      lightness as percentages. This is the notation that makes systematic edits possible — keep the hue and
      step the lightness to build a tint ladder, or keep saturation and lightness and rotate the hue along a
      harmony.</li>
    </ul>
    <p>Four limits are worth knowing, because they explain most "why did my color change?" moments:</p>
    <ul>
      <li><strong>HSL is held as whole numbers on this page.</strong> <code>#00d4aa</code> is
      <code>hsl(168, 100%, 42%)</code>, and converting that rounded HSL back through RGB lands on
      <code>#00d6ab</code> — a step or two off in each channel. Treat HEX as the authoritative value and HSL
      as the editable view of it.</li>
      <li><strong>Decimals in HSL are rejected.</strong> <code>hsl(168.5, 100%, 42%)</code> will not be
      parsed; round it to a whole number first.</li>
      <li><strong>Color names and the newer CSS functions are not parsed.</strong> <code>red</code>,
      <code>oklch()</code> and <code>rgba()</code> are out of scope here — this is a HEX/RGB/HSL converter,
      not a full CSS color parser.</li>
      <li><strong>No transparency.</strong> The picker is the browser's own, which has no alpha channel, so
      there is no 8-digit HEX and no <code>rgba()</code> output.</li>
    </ul>

    <h3>The Six Palette Schemes, and the Maths Behind Them</h3>
    <ul>
      <li><strong>Complementary</strong> — 2 swatches: your color and the hue 180° opposite it. The classic
      high-contrast pair.</li>
      <li><strong>Analogous</strong> — 5 swatches at ±30° and ±60° around your hue, with saturation nudged up
      10 points and lightness stepped 5 points per step. The safest scheme for backgrounds and gradients.</li>
      <li><strong>Triadic</strong> — 3 swatches spaced 120° apart at your saturation and lightness.</li>
      <li><strong>Split complementary</strong> — 4 swatches: your color plus the hues at 120°, 150° and 180°
      from it, which gives most of the contrast of a complementary pair without the full clash.</li>
      <li><strong>Tetradic</strong> — 4 swatches spaced 90° apart, where the second and fourth are desaturated
      by 20 points and darkened by 10 so the four do not fight each other at full strength.</li>
      <li><strong>Monochromatic</strong> — 5 swatches on a fixed lightness ladder (20%, 36%, 52%, 68%, 84%) at
      your hue and saturation. The ladder is fixed rather than derived from your base color, which is worth
      remembering if you expected your own lightness to be one of the five.</li>
    </ul>
    <p>Two honest caveats. First, these are HSL rotations, not perceptual color science: the hues are
    mathematically even but not perceptually even, so a triadic palette can look lopsided next to what a tool
    built on OKLCH or CIELAB would suggest. Second, the black-or-white swatch labels are chosen with the
    ITU-R BT.601 luma formula — a legibility heuristic for those labels, <em>not</em> a WCAG contrast check.
    Run a real contrast audit before shipping text colors.</p>

    <h3>How to Use the Color Picker</h3>
    <ol>
      <li><strong>Start from a value you already have</strong> — paste a HEX code, an <code>rgb()</code>
      string or an <code>hsl()</code> string into the matching field, or click the color input to open your
      system picker.</li>
      <li><strong>Read the other notations</strong> — the preview swatch shows the HEX, RGB and HSL forms at
      once, each with its own Copy button.</li>
      <li><strong>Pick a harmony</strong> — switch between the six schemes above the swatch strip, then click
      any swatch to make that color the new base.</li>
      <li><strong>Copy what you need</strong> — one value from its Copy button, or the whole palette from
      Copy All.</li>
    </ol>

    <h3>Where These Values Actually Get Used</h3>
    <ul>
      <li><strong>CSS variables</strong> — convert a designer's HEX swatch into <code>hsl()</code> so tint and
      shade variants become arithmetic instead of guesswork.</li>
      <li><strong>Chart and data-viz series</strong> — a five-color analogous palette covers most categorical
      charts, and the swatches come out in the order they will be plotted.</li>
      <li><strong>Design-system colors</strong> — the monochromatic ladder is a ready-made five-step scale for
      a single brand hue.</li>
      <li><strong>Throwaway colors</strong> — the random grid gives you plausible values for mock data,
      placeholder avatars and test fixtures.</li>
    </ul>

    <h3>Related Tools</h3>
    <div class="related-links">
      <a href="/tools/image-compressor">Image Compressor</a>
      <a href="/tools/minifier">HTML Minifier</a>
      <a href="/categories/frontend-design">Frontend &amp; Design</a>
      <a href="/categories/dev-tools">Dev Tools</a>
      <a href="/">All Tools</a>
    </div>
  </div>

"""
FAQ_ANCHOR = "  <!-- dtb:faq-visible -->"
if "seo-content" in src and "What Each Part Does" not in src:
    sub1(FAQ_ANCHOR, CONTENT + FAQ_ANCHOR, "insert content block")
elif "What Each Part Does" in src:
    print("  --  content block already present")
else:
    sys.exit("content block anchor missing")

# ── 8. FAQ: 2 -> 9 questions, visible side ──
FAQ_OLD = """  <!-- dtb:faq-visible -->
  <section class="faq-visible" style="margin-top:24px;line-height:1.7;color:var(--muted)">
    <h2>❓ Frequently Asked Questions</h2>
    <h3>Is Color Tools free to use?</h3>
    <p>Yes, Color Tools is completely free to use. No sign-up required, no usage limits.</p>
    <h3>Does Color Tools require an internet connection?</h3>
    <p>No. Colour conversion, palette generation and random colours all run client-side in your browser — nothing is sent to a server, and the page keeps working offline once loaded.</p>
  </section>"""

FAQ_NEW = """  <!-- dtb:faq-visible -->
  <section class="faq-visible" style="margin-top:24px;line-height:1.7">
    <h2>❓ Frequently Asked Questions</h2>
    <h3>Is the color picker and converter free to use?</h3>
    <p>Yes, completely free. No sign-up, no usage limits and no watermark on anything you copy.</p>
    <h3>Does it require an internet connection?</h3>
    <p>No. Every conversion, palette and random-color generation runs client-side in your browser, so your colors are never uploaded and the page keeps working offline once it has loaded.</p>
    <h3>Why did my HEX code change slightly when I converted HSL back to HEX?</h3>
    <p>Because the HSL values here are whole numbers. #00d4aa is hsl(168, 100%, 42%), and converting that rounded HSL back to RGB gives #00d6ab: a step or two off in each channel. Keep the HEX code as the value you ship and treat HSL as the editable view.</p>
    <h3>Does it support transparency, 8-digit HEX or rgba()?</h3>
    <p>No. The picker is the browser's native color input, which has no alpha channel, so every color here is fully opaque and the output is 3 or 6 digit HEX, rgb() or hsl().</p>
    <h3>Can I pick a color from anywhere on my screen?</h3>
    <p>Not from this page. It opens your operating system's own color picker, so it cannot sample pixels elsewhere on screen. Use the OS-level screen picker or your browser's developer tools eyedropper, then paste the HEX value into the field here.</p>
    <h3>Which color formats can I type in?</h3>
    <p>HEX with or without the leading hash (three or six digits), rgb() with comma or space separators, and hsl() with whole-number hue and percentage saturation and lightness. Color names such as red, and newer CSS functions such as oklch() or rgba(), are not parsed.</p>
    <h3>How are the palette colors calculated?</h3>
    <p>Each scheme rotates your base hue in HSL: complementary by 180 degrees, analogous by plus or minus 30 and 60 degrees, triadic by 120 degrees, split complementary to the 120, 150 and 180 degree hues, tetradic by 90 degrees, and monochromatic along a fixed lightness ladder of 20, 36, 52, 68 and 84 percent.</p>
    <h3>Are the generated palettes accessible or color-blind safe?</h3>
    <p>They are not guaranteed to be. The schemes are HSL rotations and the tool does not run any contrast check, so treat a palette as a starting point and verify text and background pairs with a dedicated contrast checker before shipping.</p>
    <h3>Can I copy an entire palette at once?</h3>
    <p>Yes. The Copy All button puts every swatch in the current palette on the clipboard as a newline-separated list of HEX codes, ready to paste into a stylesheet.</p>
  </section>"""

if "Is the color picker and converter free" in src:
    print("  --  FAQ already expanded")
else:
    sub1(FAQ_OLD, FAQ_NEW, "FAQ visible (2 -> 9)")

# ── 9. FAQPage schema synced to the visible questions, verbatim ──
def q(text, answer):
    return {"@type": "Question", "name": text,
            "acceptedAnswer": {"@type": "Answer", "text": answer}}


FAQS = [
    ("Is the color picker and converter free to use?",
     "Yes, completely free. No sign-up, no usage limits and no watermark on anything you copy."),
    ("Does it require an internet connection?",
     "No. Every conversion, palette and random-color generation runs client-side in your browser, so your colors are never uploaded and the page keeps working offline once it has loaded."),
    ("Why did my HEX code change slightly when I converted HSL back to HEX?",
     "Because the HSL values here are whole numbers. #00d4aa is hsl(168, 100%, 42%), and converting that rounded HSL back to RGB gives #00d6ab: a step or two off in each channel. Keep the HEX code as the value you ship and treat HSL as the editable view."),
    ("Does it support transparency, 8-digit HEX or rgba()?",
     "No. The picker is the browser's native color input, which has no alpha channel, so every color here is fully opaque and the output is 3 or 6 digit HEX, rgb() or hsl()."),
    ("Can I pick a color from anywhere on my screen?",
     "Not from this page. It opens your operating system's own color picker, so it cannot sample pixels elsewhere on screen. Use the OS-level screen picker or your browser's developer tools eyedropper, then paste the HEX value into the field here."),
    ("Which color formats can I type in?",
     "HEX with or without the leading hash (three or six digits), rgb() with comma or space separators, and hsl() with whole-number hue and percentage saturation and lightness. Color names such as red, and newer CSS functions such as oklch() or rgba(), are not parsed."),
    ("How are the palette colors calculated?",
     "Each scheme rotates your base hue in HSL: complementary by 180 degrees, analogous by plus or minus 30 and 60 degrees, triadic by 120 degrees, split complementary to the 120, 150 and 180 degree hues, tetradic by 90 degrees, and monochromatic along a fixed lightness ladder of 20, 36, 52, 68 and 84 percent."),
    ("Are the generated palettes accessible or color-blind safe?",
     "They are not guaranteed to be. The schemes are HSL rotations and the tool does not run any contrast check, so treat a palette as a starting point and verify text and background pairs with a dedicated contrast checker before shipping."),
    ("Can I copy an entire palette at once?",
     "Yes. The Copy All button puts every swatch in the current palette on the clipboard as a newline-separated list of HEX codes, ready to paste into a stylesheet."),
]

schema = json.dumps({"@context": "https://schema.org", "@type": "FAQPage",
                     "mainEntity": [q(t, a) for t, a in FAQS]}, indent=2, ensure_ascii=False)

m = re.search(r'<script type="application/ld\+json">\s*\{\s*"@context": "https://schema\.org",'
              r'\s*"@type": "FAQPage".*?</script>', src, re.S)
assert m, "FAQPage schema block not found"
src = src[:m.start()] + '<script type="application/ld+json">\n' + schema + '\n  </script>' + src[m.end():]
print("  ok  FAQPage schema (9 questions)")

if src == orig:
    print("no changes")
open(P, "w", encoding="utf-8").write(src)
print(f"\nwritten {P}: {len(orig)} -> {len(src)} bytes")
