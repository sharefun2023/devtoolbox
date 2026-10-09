#!/usr/bin/env python3
"""Expand /tools/cidr-calculator from 223 -> ~1100 visible words.

Adds a .seo-content block (h2 style matching other tool pages) between the
Key Features section and the FAQ, rewrites FAQ 2 -> 7 questions (visible +
schema kept in sync from the same source list), adds 5 related-links.

Idempotent: rerun prints '0 change(s)'.
"""
import json, re, sys

PAGE = "public/tools/cidr-calculator.html"
DATE = "2026-10-09"

FAQ = [
    ("Is the CIDR/IPv6 Subnet Calculator free to use?",
     "Yes. It is completely free, with no sign-up, no usage limits and no watermarks. Enter as many subnets as you like, right in your browser."),
    ("Does the subnet calculator require an internet connection?",
     "No. All subnet maths runs client-side in your browser — no input is sent to any server. Once the page has loaded it keeps working offline."),
    ("Does it support both IPv4 and IPv6 CIDR notation?",
     "Yes. One input handles both: type an IPv4 address and the tool auto-detects the 0–32 prefix range, type an IPv6 address and it switches to the 0–128 range. No separate mode to pick."),
    ("What is the difference between network address and usable IP range?",
     "The network address is the first address of the block and identifies the subnet itself. The usable IP range is the set of addresses that can be assigned to hosts — for IPv4 that excludes the network address and the broadcast address; for /31 and /32 point-to-point or single-host subnets the usable range is 'N/A'."),
    ("How many hosts does a /32 IPv4 address hold?",
     "Exactly one. A /32 subnet is a single host address with no network or broadcast part — commonly used for loopback-style documentation or specific point-to-point cases on some platforms."),
    ("Will it show the correct total IP count for huge IPv6 subnets?",
     "Yes. IPv6 totals go up to 2^128, far beyond what a 64-bit number can hold, so the tool uses arbitrary-precision (BigInt) arithmetic instead of shifting 1n by more than 127 bits — a bug that used to make every IPv6 /32 or /64 report 2 hosts instead of the real count. A /32 is 79,228,162,514,264,337,593,543,950,336 addresses (2^96)."),
    ("Does it keep my subnet inputs private?",
     "Yes. Nothing you type ever leaves the page. There is no telemetry, no server-side lookup, no analytics tied to your input values — the input box is read by JavaScript that runs entirely in your browser."),
]

CONTENT = """
<section class="seo-content">
  <h2>What a Subnet Calculator Actually Computes</h2>
  <p>Every field in the result cards is derived from the two things you type — the network address and the prefix length. Given <code>10.0.0.0/24</code>:</p>
  <ul>
    <li><strong>Network address</strong> — the input address with the host bits zeroed out. For /24 that is 10.0.0.0; the subnet mask 255.255.255.0 keeps the first 24 bits.</li>
    <li><strong>Broadcast address</strong> — the same address with all host bits set to 1 (10.0.0.255 for /24). IPv4 routers use it to reach every host in the block at once; for /31 and /32 it is defined but not routed.</li>
    <li><strong>Usable IP range</strong> — the assignable hosts, which is network + 1 through broadcast − 1. That makes /24 hold 254 usable addresses even though the block technically contains 256.</li>
    <li><strong>Subnet mask</strong> — the /prefix re-expressed in dotted quad form (255.255.255.0). For IPv6 the mask is a 128-bit pattern shown as <code>/32 (128-bit subnet mask)</code> alongside the CIDR notation.</li>
  </ul>

  <h2>IPv4 vs IPv6 — where the maths changes</h2>
  <p>IPv4 addresses are 32 bits, so <code>1.2.3.4/24</code> and <code>1.2.3.4/25</code> differ only in which of the 8 host bits are zeroed. IPv6 addresses are 128 bits, which means the two numbers that break ordinary 64-bit integer arithmetic — 2^96 and 2^128 — appear in real subnets. This tool uses arbitrary-precision integers for the IPv6 path, so <code>2001:db8::/32</code> correctly reports 79,228,162,514,264,337,593,543,950,336 total addresses instead of the 2 you would get from an overflow-truncated shift.</p>
  <p>IPv6 /31 and /127 subnets are special: RFC 7432 reserves them for point-to-point links, so the calculator marks them "N/A (point-to-point only)" rather than counting 2 hosts the way IPv4 /30 does. IPv6 /128 is a single host.</p>

  <h2>How to Read the Result Cards</h2>
  <ol>
    <li><strong>CIDR notation</strong> — the normalized form: network address + mask. Type <code>192.168.1.5/30</code> and it shows <code>192.168.1.4/30</code>, because the network of a /30 containing .5 is .4.</li>
    <li><strong>Usable IPs</strong> — how many hosts you can assign. The two most common numbers people look up: /24 → 254, /28 → 14, /30 → 2.</li>
    <li><strong>Total IPs</strong> — the full block size including network and broadcast. For /32 it reads "1 (single host)".</li>
  </ol>

  <h2>Common Prefix Sizes and What They Hold</h2>
  <ul>
    <li><strong>/24</strong> — 256 addresses, 254 usable. The classic "one LAN segment" size.</li>
    <li><strong>/28</strong> — 16 addresses, 14 usable. The default subnet size on Windows networks.</li>
    <li><strong>/30</strong> — 4 addresses, 2 usable. One of the two usable pairs goes on each side of a point-to-point link.</li>
    <li><strong>/31</strong> — 2 addresses, both usable (RFC 3021). Exactly one link, two ends.</li>
    <li><strong>/32</strong> — 1 address. Loopback, single-host routing, documentation.</li>
    <li><strong>IPv6 /32</strong> — 2^96 addresses. This is the size of each allocation to an ISP; your actual network will be /48, /56 or /64 carved out of it.</li>
    <li><strong>IPv6 /64</strong> — the standard on-link subnet size. Slashes smaller than this break EUI-64 address generation on most interfaces.</li>
  </ul>

  <h2>Related Tools</h2>
  <div class="related-links">
    <a href="/tools/json-formatter-online">JSON Formatter</a>
    <a href="/tools/url-encoder-decoder">URL Encoder/Decoder</a>
    <a href="/tools/timestamp-converter">Timestamp Converter</a>
    <a href="/online-regex-tester">Regex Tester</a>
    <a href="/categories/dev-tools">Dev Tools</a>
  </div>
</section>
"""

FAQ_SECTION_OLD = """  <!-- dtb:faq-visible -->
  <section class=\"faq-visible\" style=\"margin-top:24px;line-height:1.7;color:var(--muted)\">
    <h2>❓ Frequently Asked Questions</h2>"""

def build_faq_html():
    out = ['  <!-- dtb:faq-visible -->',
           '  <section class="faq-visible" style="margin-top:24px;line-height:1.7;color:var(--muted)">',
           '    <h2>❓ Frequently Asked Questions</h2>']
    for q, a in FAQ:
        out.append(f'    <h3>{q}</h3>')
        out.append(f'    <p>{a}</p>')
    out.append('  </section>')
    return '\n'.join(out)

def build_faq_schema():
    entries = []
    for q, a in FAQ:
        entries.append('    {\n'
                       f'      "@type": "Question",\n'
                       f'      "name": {json.dumps(q)},\n'
                       '      "acceptedAnswer": {\n'
                       f'        "@type": "Answer",\n'
                       f'        "text": {json.dumps(a)}\n'
                       '      }\n'
                       '    }')
    body = ',\n'.join(entries)
    return ('  <script type="application/ld+json">\n{\n'
            '  "@context": "https://schema.org",\n'
            '  "@type": "FAQPage",\n'
            '  "mainEntity": [\n' + body + '\n  ]\n}\n  </script>')

def main():
    src = open(PAGE).read()
    orig = src
    n = 0

    # 1. Replace old 2-question FAQ section with 7-question one
    m = re.search(r'  <!-- dtb:faq-visible -->.*?</section>', src, re.S)
    if m:
        src = src[:m.start()] + build_faq_html() + src[m.end():]
        n += 1

    # 2. Replace old 2-question FAQ schema with 7-question one
    m = re.search(r'  <script type="application/ld\+json">\n\{\n  "@context": "https://schema.org",\n  "@type": "FAQPage",\n  "mainEntity": \[.*?\]\n\}\n  </script>', src, re.S)
    if m:
        src = src[:m.start()] + build_faq_schema() + src[m.end():]
        n += 1

    # 3. Insert content block before the FAQ section
    if 'id="cidr-seo-content"' not in src and '<section class="seo-content">' not in src:
        anchor = '  <!-- dtb:faq-visible -->'
        idx = src.index(anchor)
        block = CONTENT.replace('<section class="seo-content">', '<section class="seo-content" id="cidr-seo-content">')
        src = src[:idx] + block + '\n' + src[idx:]
        n += 1

    # 4. (removed) the self-referencing related link is already correct in the new CONTENT block

    # 5. Update dateModified
    src = re.sub(r'"dateModified": "\d{4}-\d{2}-\d{2}"', f'"dateModified": "{DATE}"', src)

    # 6. CSS: make .seo-content render like the other expanded tool pages
    if '.seo-content' not in src:
        css_anchor = '\n    .related-links {'
        if css_anchor in src:
            ins = '''
    .seo-content {
      max-width: 900px;
      margin-top: 32px;
      line-height: 1.7;
      color: var(--tool-text);
    }
    .seo-content h2 {
      font-size: 1.2rem;
      color: var(--tool-text-bright);
      margin: 24px 0 10px;
    }
    .seo-content h2:first-child { margin-top: 0; }
    .seo-content p { margin: 10px 0; }
    .seo-content ul, .seo-content ol { margin: 10px 0; padding-left: 24px; }
    .seo-content li { margin: 6px 0; }
    .seo-content code {
      background: var(--tool-accent-dim);
      padding: 1px 5px;
      border-radius: 4px;
      font-size: 0.9em;
      color: var(--tool-text-bright);
    }
    .seo-content .related-links {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 12px;
    }
    .seo-content .related-links a {
      color: var(--tool-accent);
      text-decoration: none;
      border: 1px solid var(--tool-border);
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 0.85rem;
    }
    .seo-content .related-links a:hover { opacity: 0.8; }
'''
            src = src.replace(css_anchor, ins + css_anchor)
            n += 1

    if src != orig:
        open(PAGE, 'w').write(src)
        print(f'{n} change(s) applied')
    else:
        print('0 change(s) — already up to date')

if __name__ == '__main__':
    main()
