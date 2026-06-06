# CLAUDE.md — bilalmeccai.com Project Context

> This file is the single source of truth for Claude Code.
> Read this fully before touching any file.

---

## 1. WHO THIS IS FOR

**Mohammed Bilal Meccai**
- Senior DevOps Engineer, 4+ years at Raasoft Infotech (Mangalore, India)
- Core client: Markaaz (US-based global business intelligence / fintech platform)
- Brand: Mecfinity AI (separate — do NOT connect to this site yet)
- Personal brand site: bilalmeccai.com
- Email: bilalmeccai@gmail.com | mohammed.bilal@mecfinityai.com

**Bilal's working style:** Direct. Execution-first. No fluff. Always provide ready-to-use output.

---

## 2. SITE GOAL

bilalmeccai.com is a **personal brand site** — NOT a Mecfinity AI site.

**Sequence:**
1. Build Bilal's personal brand and audience first (bilalmeccai.com + X/Twitter)
2. Map Mecfinity AI to Bilal's brand later — once trust is established
3. Do NOT reference Mecfinity AI anywhere on this site yet

**Three audiences this site serves (in order):**
1. Layman / business owner — must understand immediately what Bilal does and why they need him
2. Technical buyer / CTO — needs proof of outcomes, not just skills
3. Remote employer / recruiter — needs credibility signal fast

**Core value proposition (headline):**
> "I turn complex infrastructure chaos into clean, working systems"

**Bilal's signature differentiator** (must be prominent):
> Pattern recognition — he maps unfamiliar systems, tools, and platforms in hours where most engineers take days. This is called out explicitly as "Rapid System & Platform Pattern Recognition" in the resume and "What Makes Me Different" on the site.

---

## 3. TECH STACK

| Layer | Choice | Reason |
|---|---|---|
| Static site generator | **Eleventy (11ty) v3** | Zero config, Markdown-native, fast build |
| Templating | **Nunjucks (.njk)** | Eleventy default, simple, powerful |
| Blog posts | **Markdown (.md)** | Write fast, ship fast |
| Styling | **Vanilla CSS** (no framework) | Full control, zero bloat |
| JS | **Vanilla JS** | No React, no build step needed |
| Deployment | **Vercel** | Auto-deploy on git push, free tier |
| Email (contact form) | **EmailJS v4** | No backend, browser-direct |
| Fonts | Google Fonts — Playfair Display + DM Sans + DM Mono | |

---

## 4. DESIGN SYSTEM

### Colors
```css
--ink:        #0F0F0F;   /* primary text */
--ink-soft:   #4A4A4A;   /* body copy */
--ink-muted:  #8A8A8A;   /* labels, captions */
--paper:      #FAFAF7;   /* page background */
--paper-2:    #F2F1EC;   /* card / section background */
--accent:     #1A3C5E;   /* primary — deep navy */
--accent-2:   #C8873A;   /* secondary — warm amber */
--rule:       #E0DDD5;   /* borders and dividers */
--green:      #2a7a4a;   /* success states */
--red:        #c0392b;   /* error states */
```

### Typography
```css
--serif: 'Playfair Display', Georgia, serif;   /* headlines, pull quotes */
--sans:  'DM Sans', system-ui, sans-serif;     /* body copy, UI text */
--mono:  'DM Mono', 'Courier New', monospace;  /* labels, tags, code, nav links */
```

### Design Vibe
- **Light & Editorial** — clean, minimal, writing-forward, modern professional
- Think: newspaper meets engineering blog
- NO generic AI aesthetics (no purple gradients, no Inter font, no card grid spam)
- Generous whitespace, strong typographic hierarchy
- Noise texture overlay on body (subtle grain)

### Key UI Patterns
- Section labels: `font-family: mono, font-size: 0.65rem, letter-spacing: 0.2em, UPPERCASE`
- Buttons: sharp rectangles, no border-radius
- Borders: `1px solid var(--rule)` — no box shadows on structural elements
- Hover states: `translateY(-2px)` on CTAs, `translateX(4px)` on list items
- Custom cursor on desktop (dot + ring, `mix-blend-mode: multiply`)
- Scroll reveal on all `.reveal` elements via IntersectionObserver

---

## 5. DIRECTORY STRUCTURE

```
bilalmeccai-v2/
├── .claude/
│   └── CLAUDE.md              ← YOU ARE HERE
├── .eleventy.js               ← Eleventy config, filters, shortcodes
├── .gitignore
├── package.json               ← scripts: dev, build, clean
├── vercel.json                ← build command + security headers
└── src/
    ├── index.njk              ← HOMEPAGE (TODO: migrate from index.html)
    ├── robots.txt
    ├── assets/
    │   ├── css/
    │   │   ├── base.css       ← design tokens, reset, nav, footer, utils
    │   │   └── blog.css       ← blog listing + post page styles
    │   └── js/
    │       └── main.js        ← shared JS: nav, hamburger, reveal, cursor, copy
    ├── _includes/
    │   └── layouts/
    │       ├── base.njk       ← HTML shell: head, nav, footer (every page extends this)
    │       ├── post.njk       ← blog post layout (extends base)
    │       └── blog.njk       ← blog listing layout (extends base)
    └── blog/
        ├── index.njk          ← /blog/ listing page
        └── emailjs-template-variables-fix.md   ← first post (LIVE)
```

### Output (Eleventy builds to `_site/`)
```
_site/
├── index.html
├── blog/
│   ├── index.html
│   └── emailjs-template-variables-fix/
│       └── index.html
└── assets/
    ├── css/
    └── js/
```

---

## 6. HOMEPAGE STATUS

**The homepage (`src/index.njk`) is NOT yet migrated.**

There is a standalone `index.html` built previously (single-file, no Eleventy).
**Priority task: migrate this into `src/index.njk` using the base layout.**

### Homepage sections (in order):
1. **Hero** — split layout, left: headline + sub + CTAs, right: 4 stat blocks
2. **Marquee strip** — scrolling tech stack ticker (navy background)
3. **About** — 2-col: left: narrative + pull quote, right: 4 differentiators (01–04)
4. **How I Work** — 4-step process grid
5. **Proof / Work** — featured card (Markaaz pipeline) + 2 smaller cards
6. **Stack** — sticky sidebar + tag cloud by category
7. **Contact / CTA** — left: copy, right: option selector + EmailJS form
8. **Footer**

### Homepage hero headline:
```
I turn complex infrastructure chaos into clean, working systems
```

### Hero stats:
- 4+ Years in Production
- 2TB+ Data Automated Daily
- 15+ Tools Mastered Rapidly
- SOC 2 Compliance Maintained

---

## 7. ELEVENTY CONFIG REFERENCE

**File:** `.eleventy.js`

### Filters available in templates:
| Filter | Usage | Output |
|---|---|---|
| `dateDisplay` | `{{ date \| dateDisplay }}` | "6 June 2026" |
| `dateISO` | `{{ date \| dateISO }}` | "2026-06-06" |
| `readingTime` | `{{ content \| readingTime }}` | "4" (minutes) |
| `excerpt` | `{{ content \| excerpt }}` | First 160 chars, stripped of HTML |

### Shortcodes available in Markdown:
```njk
{% callout "warn" %}Warning message here{% endcallout %}
{% callout "info" %}Info message here{% endcallout %}
{% callout "ok" %}Success message here{% endcallout %}
{% callout "tip" %}Tip message here{% endcallout %}

{% tldr %}TL;DR content here{% endtldr %}

{% year %}  → current year
```

### Collections:
- `collections.posts` — all `.md` files in `src/blog/` with tag `posts`, sorted by date descending

---

## 8. BLOG POST FRONTMATTER SPEC

Every blog post must have this frontmatter:

```yaml
---
layout: post
title: "Post Title Here"
subtitle: "One-line hook for the reader (shown below title)"
description: "SEO meta description — 150 chars max"
date: 2026-06-06
tags:
  - posts          # REQUIRED — adds to collections.posts
  - EmailJS        # topic tags shown as badges
  - JavaScript
category: "Web Engineering"   # shown in schema markup
tldr: "HTML-safe TL;DR shown in navy box at top. Use <strong> and <code>."
faq:                           # OPTIONAL — generates FAQPage schema for AEO
  - q: "Question?"
    a: "Answer."
---
```

---

## 9. EMAILJS INTEGRATION

**SDK:** `@emailjs/browser@4` loaded via CDN in base.njk head

**Credentials location:** `src/index.njk` (homepage) — three constants at top of inline script:
```js
const EMAILJS_PUBLIC_KEY  = 'YOUR_PUBLIC_KEY';
const EMAILJS_SERVICE_ID  = 'YOUR_SERVICE_ID';
const EMAILJS_TEMPLATE_ID = 'YOUR_TEMPLATE_ID';
```

**Template variables — JS payload must match template EXACTLY:**
| Template `{{placeholder}}` | JS key | Value sent |
|---|---|---|
| `{{name}}` | `name` | Visitor's email address |
| `{{email}}` | `email` | Visitor's email (used in Reply To) |
| `{{topic}}` | `topic` | Selected option title |
| `{{message}}` | `message` | Textarea content |
| `{{time}}` | `time` | IST timestamp via `toLocaleString('en-IN', ...)` |

**Receiving email:** `mohammed.bilal@mecfinityai.com`
**Reply To in template:** `{{email}}` — so replying goes directly to visitor

**Critical rule:** EmailJS returns 200 even on variable mismatch. It fails silently.
Always use **Test It** in dashboard before going live.

---

## 10. AEO (ANSWER ENGINE OPTIMIZATION) APPROACH

Every blog post targets AI answer engines (Perplexity, ChatGPT, Google SGE) in addition to Google.

**AEO checklist for each post:**
- [ ] `FAQPage` schema in frontmatter `faq:` array → auto-injected by `post.njk`
- [ ] `TechArticle` schema auto-injected by `post.njk`
- [ ] TL;DR box at top — direct answer above the fold
- [ ] `<details>/<summary>` FAQ section at bottom of post body
- [ ] Tables with reference data (AI loves citing structured data)
- [ ] Blockquotes for pull quotes (signals quotable authority)
- [ ] Canonical URL set automatically from `page.url`

---

## 11. VERCEL DEPLOYMENT

**`vercel.json` config:**
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "_site",
  "installCommand": "npm install",
  "framework": null
}
```

**Deploy flow:**
```bash
# Local dev
npm install
npm run dev          # → localhost:8080, live reload

# Production
git add . && git commit -m "your message"
git push origin main  # Vercel auto-deploys on push
```

**Security headers set in `vercel.json`:**
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- X-XSS-Protection
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: camera, mic, geolocation blocked
- Assets: `Cache-Control: immutable, max-age=31536000`

---

## 12. RESUME

A production-ready `.docx` resume was built separately.

**Key positioning in resume:**
- Title: Senior DevOps Engineer
- Signature Capability section (unique section): Rapid System & Platform Pattern Recognition
- Featured metric: 60–80% reduction in integration ramp-up time
- Impact bar: 2TB+ data automated · 500GB delivered <1.5hrs · Zero manual workflows
- Contact: bilalmeccai@gmail.com | bilalmeccai.com

---

## 13. PERSONAL BRAND STRATEGY

**Platform priority:**
1. **X (Twitter)** — primary content platform, daily posts
2. **bilalmeccai.com** — content hub, SEO anchor, proof of work
3. **LinkedIn** — maintain, don't invest heavily

**Content strategy:**
- Every problem solved fast = one X post + one blog post
- X post format: observation → insight → implication (no humble bragging)
- First X post drafted: pattern recognition angle around the EmailJS fix today
- Blog post #1: EmailJS template variable mismatch fix (LIVE in this build)

**Brand voice:**
- Direct, sharp, no fluff
- Explains tech in plain language (accessible to laymen)
- Shows thinking process, not just outcomes
- Personal — uses real problems from real work

**Mecfinity AI separation:**
- bilalmeccai.com = Bilal the person
- mecfinityai.com = the company
- Do NOT cross-link yet. Build Bilal's trust first (min 6 months).
- When Mecfinity AI is revealed, Bilal's audience transfers credibility automatically

---

## 14. IMMEDIATE TODO LIST

Priority order for Claude Code:

- [ ] **P0** Migrate `index.html` homepage into `src/index.njk` (Eleventy base layout)
- [ ] **P0** Wire EmailJS credentials into the homepage contact form
- [ ] **P1** Add sitemap generation (`@11ty/eleventy-plugin-sitemap`)
- [ ] **P1** Add `src/404.njk` — custom 404 page matching brand
- [ ] **P2** Add `src/about.njk` — dedicated about/bio page
- [ ] **P2** Add Open Graph image (`og:image`) for social sharing
- [ ] **P3** Add RSS feed for blog (`@11ty/eleventy-plugin-rss`)
- [ ] **P3** Add syntax highlight CSS from PrismJS for code blocks in posts

---

## 15. COMMANDS REFERENCE

```bash
# Install dependencies
npm install

# Local development (live reload at localhost:8080)
npm run dev

# Production build (outputs to _site/)
npm run build

# Clean build output
npm run clean

# Deploy to Vercel (one-time setup)
npx vercel --prod

# After setup — just push to GitHub
git add . && git commit -m "feat: ..." && git push origin main
```

---

## 16. FILE NAMING CONVENTIONS

| Type | Convention | Example |
|---|---|---|
| Blog posts | `kebab-case.md` | `emailjs-template-variables-fix.md` |
| CSS files | `kebab-case.css` | `blog.css`, `base.css` |
| Layouts | `kebab-case.njk` | `post.njk`, `base.njk` |
| Pages | `kebab-case.njk` | `about.njk`, `index.njk` |

Blog post URL is auto-generated from filename:
`emailjs-template-variables-fix.md` → `/blog/emailjs-template-variables-fix/`

---

*Last updated: 6 June 2026 | Built in conversation with Claude (claude.ai)*
