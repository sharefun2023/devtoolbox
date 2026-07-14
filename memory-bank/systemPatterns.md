# System Patterns (Optional)

This file documents recurring patterns and standards used in the project.
It is optional, but recommended to be updated as the project evolves.
2026-07-13 23:15:00 - Memory Bank initialized.

## Coding Patterns

*   **Standalone HTML pages** — each tool is one self-contained `.html` file with inline CSS/JS
*   **CSS custom properties** — all colors defined as `:root` variables for easy theming
*   **No build step** — vanilla HTML/CSS/JS, no webpack/vite/bundler
*   **CDN dependencies** — external libs (e.g., CodeMirror, QRCode.js) loaded from CDN
*   **JSON-LD injection** — `add-jsonld.py` script appends structured data to HTML files

## Architectural Patterns

*   **SPA-like tool pages** — each tool page is a full HTML document, not a fragment
*   **Flat file structure** — `public/tools/tool-name.html`, no nested routing
*   **Git-push deployment** — no CI/CD beyond CF Pages auto-deploy
*   **SEO-first tool pages** — every page has unique `<title>`, `<meta description>`, and JSON-LD

## Testing Patterns

*   Manual browser testing only — no automated tests yet
*   GSC monitoring for indexing issues
*   Lighthouse audits run manually
