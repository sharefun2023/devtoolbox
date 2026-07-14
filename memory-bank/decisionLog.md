# Decision Log

This file records architectural and implementation decisions using a list format.
2026-07-13 23:15:00 - Memory Bank initialized.

## Decision

*   **Static HTML only, no framework** (2026-06)
*   **Cloudflare Pages for hosting** (2026-06)
*   **Dark theme (GitHub-inspired)** (2026-06)
*   **Client-side only processing** (2026-06)
*   **23232322.xyz as primary domain** (2026-06)
*   **Deferred monetization** (2026-06)
*   **SEO-driven content strategy** (2026-07)
*   **Adopt RooFlow Memory Bank for project context** (2026-07-13)

## Rationale 

*   Static HTML: zero maintenance, instant load, no build step, free hosting on CF Pages
*   CF Pages: free tier, auto-deploy from git, global CDN, SSL included
*   Dark theme: developer audience preference, low eye strain, looks premium
*   Client-side: no server cost, no data privacy concerns, works offline-capable
*   23232322.xyz: cheap ($1/year), memorable pattern for dev tools
*   Deferred monetization: user explicitly said "现在都不要做" — focus on traffic first
*   SEO: DataForSEO showed massive untapped keywords (UUID gen 22K/mo @ 0 competition)
*   Memory Bank: five structured Markdown files in project root, cross-session persistence, UMB command for forced sync. Hermes `memory` stays for personal/global facts; Memory Bank is project-scoped.

## Implementation Details

*   Each tool is a standalone HTML file in `public/tools/`
*   SEO metadata injected via `add-jsonld.py` script (structured data + meta tags)
*   Sitemap auto-generated for CF Pages
*   `_headers` file for CF Pages CORS/security headers
*   Git push → CF Pages auto-deploy (no manual deployment step)
