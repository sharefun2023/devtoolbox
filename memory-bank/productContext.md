# Product Context

This file provides a high-level overview of the project and the expected product that will be created. Initially based on projectBrief.md (if provided) and all other available project-related information in the working directory. This file is intended to be updated as the project evolves.

## Project Goal

DevToolBox — a free online developer toolkit site. All tools run client-side (no data sent to server). Target: rank on Google for long-tail developer tool keywords. Monetization intentionally deferred per user preference.

## Key Features

*   22 tools: JSON formatter, Base64 encoder/decoder, UUID generator, regex tester, JWT debugger, SQL formatter, timestamp converter, HTML minifier, URL encoder/decoder, QR code generator, markdown preview, hash generator, diff checker, CIDR calculator, color picker/converter, image compressor, AI cover generator, HTML entity encoder/decoder, text diff
*   Dark theme (GitHub-style: #0d1117 background, #58a6ff accent)
*   All processing in-browser — no backend, no data collection
*   SEO-optimized: each tool page has meta description, JSON-LD structured data, canonical URL
*   AI cover generator powered by Cloudflare Workers AI (flux-1-schnell)

## Overall Architecture

*   **Frontend**: Static HTML/CSS/JS, single-page per tool
*   **Hosting**: Cloudflare Pages (23232322.xyz + devtoolbox.pages.dev)
*   **Deployment**: git push to `sharefun2023/devtoolbox` → CF Pages auto-deploy
*   **SEO**: DataForSEO keyword research, GSC monitoring
*   **No backend/functions** (mostly static, API dir empty/placeholder)
*   **Scripts**: `add-jsonld.py` for structured data injection, `add_gemini.sh` for Gemini AI integration (abandoned?)
