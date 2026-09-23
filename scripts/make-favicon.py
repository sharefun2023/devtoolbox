#!/usr/bin/env python3
"""Generate the DevToolBox favicon set (SVG + ICO + apple-touch-icon) from one geometry.

Brand: bg #0a0e14 (site --bg), accent #39bae6 (site --accent), mark = a `</>` chevron glyph.
Pure geometry (no font dependency) so it renders identically everywhere and stays legible at 16px.
Run:  python3 scripts/make-favicon.py     (writes into public/)
"""
import os
from PIL import Image, ImageDraw

BG = (10, 14, 20, 255)       # --bg  #0a0e14
ACCENT = (57, 186, 230, 255)  # --accent #39bae6
S = 64                        # master canvas used by the SVG viewBox
STROKE = 5.5

# mark geometry on the 64px grid: left chevron, slash, right chevron
LEFT = [(21, 21), (12, 32), (21, 43)]
SLASH = [(35, 19), (29, 45)]
RIGHT = [(43, 21), (52, 32), (43, 43)]
MARK = [LEFT, SLASH, RIGHT]

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public")


def svg():
    def poly(pts):
        return " ".join(f"{x},{y}" for x, y in pts)

    paths = "\n".join(
        f'  <polyline points="{poly(p)}"/>' for p in MARK
    )
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}" role="img" aria-label="DevToolBox">
  <rect width="{S}" height="{S}" rx="14" ry="14" fill="#0a0e14"/>
  <g fill="none" stroke="#39bae6" stroke-width="{STROKE}" stroke-linecap="round" stroke-linejoin="round">
{paths}
  </g>
</svg>
'''


def render(size, scale_mark=1.0, pad_ratio=0.0):
    """Render the mark at `size` px. scale_mark shrinks the glyph for touch icons."""
    ss = 8  # supersample factor for smooth strokes
    W = size * ss
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    radius = int(0.22 * W)
    d.rounded_rectangle([0, 0, W - 1, W - 1], radius=radius, fill=BG)

    # centre the glyph; scale_mark<1 leaves breathing room (apple-touch icons have no mask)
    k = W / S * scale_mark
    off = (W - S * k) / 2

    def tx(p):
        return (off + p[0] * k, off + p[1] * k)

    w = max(2, int(round(STROKE * k)))
    for pts in MARK:
        d.line([tx(p) for p in pts], fill=ACCENT, width=w, joint="curve")
    for pts in MARK:  # round the caps/joins that ImageDraw.line leaves square
        for p in (pts[0], pts[-1]):
            x, y = tx(p)
            d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=ACCENT)
        if len(pts) == 3:  # chevron mid-point join
            x, y = tx(pts[1])
            d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=ACCENT)

    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)

    with open(os.path.join(OUT, "favicon.svg"), "w", encoding="utf-8") as f:
        f.write(svg())

    master = render(256)
    # multi-resolution .ico so the default /favicon.ico path stops 404ing
    master.save(
        os.path.join(OUT, "favicon.ico"),
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64)],
    )
    render(180, scale_mark=0.78).save(os.path.join(OUT, "apple-touch-icon.png"))

    for n in ("favicon.ico", "favicon.svg", "apple-touch-icon.png"):
        p = os.path.join(OUT, n)
        print(f"  {n:<24} {os.path.getsize(p):>7} bytes")


if __name__ == "__main__":
    main()
