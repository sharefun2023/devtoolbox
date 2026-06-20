#!/usr/bin/env python3
"""Batch add JSON-LD (BreadcrumbList + FAQPage) to all devtoolbox tool pages."""
import re
import json
from pathlib import Path

TOOLS_DIR = Path("/home/sharefun/devtoolbox/public/tools")

def tool_name_from_file(filepath):
    """Extract tool name from HTML title."""
    html = filepath.read_text()
    m = re.search(r'<title>(.*?)(?: —.*)?\|?\s*DevToolBox</title>', html)
    if m:
        return m.group(1).strip()
    return filepath.stem.replace("-", " ").title()

def canonical_url(filepath):
    """Extract canonical URL."""
    html = filepath.read_text()
    m = re.search(r'canonical" href="([^"]+)"', html)
    if m:
        return m.group(1).strip()
    # fallback
    name = filepath.stem
    return f"https://23232322.xyz/tools/{name}"

def has_json_ld(html, schema_type):
    """Check if a specific schema type exists."""
    return schema_type in html

def add_breadcrumb(html, name, url):
    """Add BreadcrumbList JSON-LD after existing WebApplication or at top of head."""
    bc = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {
                "@type": "ListItem",
                "position": 1,
                "name": "DevToolBox",
                "item": "https://23232322.xyz"
            },
            {
                "@type": "ListItem",
                "position": 2,
                "name": name,
                "item": url
            }
        ]
    }
    bc_json = json.dumps(bc, ensure_ascii=False, indent=2)
    bc_block = f'  <script type="application/ld+json">\n{bc_json}\n  </script>\n'
    
    # Insert after existing </script> block for WebApplication
    # Or before </head>
    if not has_json_ld(html, "BreadcrumbList"):
        # Find the WebApplication script block and insert after it
        pattern = r'(</script>\s*\n\s*<!-- Google tag)'
        repl = bc_block + r'<!-- Google tag'
        if re.search(pattern, html):
            html = re.sub(pattern, repl, html, count=1)
        else:
            # Insert before </head>
            html = html.replace("</head>", f"{bc_block}</head>", 1)
    return html

def add_faq_if_missing(html, name, url):
    """Add minimal FAQPage JSON-LD if none exists."""
    if has_json_ld(html, "FAQPage"):
        return html
    
    # Add a generic FAQ based on tool name
    tool_lower = name.lower()
    faq_qs = [
        {
            "@type": "Question",
            "name": f"Is {name} free to use?",
            "acceptedAnswer": {
                "@type": "Answer",
                "text": f"Yes, {name} is completely free to use. No sign-up required, no usage limits."
            }
        },
        {
            "@type": "Question",
            "name": f"Does {name} require an internet connection?",
            "acceptedAnswer": {
                "@type": "Answer",
                "text": "Most tools run 100% client-side in your browser. No data is sent to any server."
            }
        }
    ]
    
    faq = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": faq_qs
    }
    faq_json = json.dumps(faq, ensure_ascii=False, indent=2)
    faq_block = f'  <script type="application/ld+json">\n{faq_json}\n  </script>\n'
    html = html.replace("</head>", f"{faq_block}</head>", 1)
    return html

def add_web_application_if_missing(html, name, url, desc=""):
    """Add WebApplication schema if none exists."""
    if has_json_ld(html, "WebApplication") or has_json_ld(html, "SoftwareApplication"):
        return html
    
    if not desc:
        d = re.search(r'<meta name="description" content="([^"]+)"', html)
        desc = d.group(1) if d else f"Free online {name} tool"
    
    app = {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        "name": name,
        "description": desc,
        "applicationCategory": "DeveloperApplication",
        "operatingSystem": "Any",
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
        "url": url
    }
    app_json = json.dumps(app, ensure_ascii=False, indent=2)
    app_block = f'  <script type="application/ld+json">\n{app_json}\n  </script>\n'
    html = html.replace("</head>", f"{app_block}</head>", 1)
    return html

def main():
    total = 0
    modified = 0
    issues = []
    
    for fpath in sorted(TOOLS_DIR.glob("*.html")):
        total += 1
        html = fpath.read_text()
        original = html
        name = tool_name_from_file(fpath)
        url = canonical_url(fpath)
        
        # 1. Ensure WebApplication exists
        html = add_web_application_if_missing(html, name, url)
        
        # 2. Add BreadcrumbList
        html = add_breadcrumb(html, name, url)
        
        # 3. Add FAQPage
        html = add_faq_if_missing(html, name, url)
        
        if html != original:
            fpath.write_text(html)
            modified += 1
            counts_before = original.count('ld+json')
            counts_after = html.count('ld+json')
            print(f"✅ {fpath.name}: {counts_before}→{counts_after} JSON-LD blocks")
        else:
            print(f"⏭️ {fpath.name}: no change")
    
    print(f"\n📊 Total: {total} files, {modified} modified")

if __name__ == "__main__":
    main()
