# Blog Post SOP — bilalmeccai.com

> Apply this to every post before it goes live. No exceptions.
> This file is read by Claude Code. Every new post must pass every gate below.

---

## 1. Voice Test

Read the post out loud. It should sound like Bilal explaining something to a smart friend over coffee — not like a tutorial site, not like a corporate blog, not like ChatGPT.

**Fail signals to fix:**
- "In this post, we will explore..." → delete, start with the situation
- "It is important to note that..." → delete, just say it
- "In conclusion..." → delete, end with the insight
- Passive voice in key statements: "the error was caused by" → "the missing variable caused"
- Hedging: "this might be one way to..." → "this is what worked"

**Pass signal:** Someone reading could believably think "this person wrote this at 11pm after actually dealing with this problem."

---

## 2. Opening Hook

The first paragraph must make someone stop scrolling. No slow builds, no context-setting paragraphs.

**Structure that works:**
- Specific situation → consequence → resolution teaser
- Example: "A developer had been working the problem for two hours. I fixed it in thirty minutes. Here's the exact sequence."

**Does NOT work:**
- "EmailJS is a popular library for sending emails from JavaScript..."
- "In modern web development, contact forms are an essential component..."

---

## 3. Human Specifics

Every post must contain at least one of:
- A specific time (2am, 30 minutes, 60 seconds)
- A specific tool or version (Hetzner Cloud Console, EmailJS v4, Node 24)
- A specific command or code that actually works (copy-paste ready)
- A real outcome with a number (2TB+ data, 30 minutes vs 2 hours, 60-second fix)

These are the details that make a post citable and trustworthy.

---

## 4. Readability Rules

- **Max sentence length:** 25 words for key statements. Shorter for impact.
- **Paragraph length:** 2–4 sentences max. Single sentences are fine for emphasis.
- **No jargon without a one-line definition** the first time it appears.
- **Headers**: every major section gets a clear header (H2 or H3). No walls of text.
- **Code blocks**: every code example must have a language label (```bash, ```js, etc.) and a comment explaining what it does if it's not immediately obvious.

---

## 5. AEO Checklist (Answer Engine Optimization)

For every post:

- [ ] `tldr:` in frontmatter — direct answer, above the fold, HTML-safe
- [ ] `faq:` array in frontmatter — 4–6 questions exactly how someone would Google them
- [ ] At least one table with reference data (AI engines love citing tables)
- [ ] A pull quote blockquote (`>`) that summarises the core insight in one sentence
- [ ] `<details>/<summary>` FAQ section at the bottom of the post body
- [ ] `TechArticle` schema — auto-injected by `post.njk` ✓
- [ ] `FAQPage` schema — auto-injected from frontmatter `faq:` ✓
- [ ] `category:` field set correctly in frontmatter
- [ ] No keyword stuffing — answer the question naturally, don't repeat the keyword 10 times

---

## 6. Authority Signals

The goal is to be cited, not just read. Every post should contain:

1. **The pattern insight** — the meta-lesson that separates this from a Stack Overflow answer. This is Bilal's differentiator: "I see the system, not just the symptom."
2. **A pull quote** that names the principle: `> "Pattern recognition isn't about being smarter. It's about knowing which layer to check first."`
3. **Specific outcome** that proves the approach worked. Not "the site was fixed" — "every system was confirmed live at the 30-minute mark."
4. **A checklist or table** that a reader can save and use. This is what gets bookmarked and shared.

---

## 7. Closing CTA

**Every post must end with this section**, formatted as a simple paragraph — not a sales pitch, not a button, just an open door:

```
---

If you ran into something similar or got stuck on a step, I'm happy to help.
Reach out at [bilalmeccai.com/#contact](https://bilalmeccai.com/#contact) or
drop me a line at bilalmeccai@gmail.com — I read every message.
```

Adjust the first sentence to match the post's topic. Keep it one or two sentences. No "Book a consultation" language.

---

## 8. Final Proofreading Pass

Before committing:

- [ ] No orphan lines (single sentences that should be merged with adjacent paragraphs)
- [ ] Every `{{variable}}` in frontmatter `tldr:` is wrapped in `<code>` or `<strong>` — no raw curly braces
- [ ] Filename is `kebab-case.md` and matches the post title closely
- [ ] `date:` is set to the actual publish date (`YYYY-MM-DD`)
- [ ] `tags:` includes `posts` (required for `collections.posts`) + 2–4 topic tags
- [ ] `description:` is under 155 characters (check manually)
- [ ] All links are absolute or root-relative (no `./` relative paths)
- [ ] Code blocks close properly (no unclosed triple backticks)
- [ ] FAQ `<details>` blocks all close with `</details>`

---

## 9. Complete Frontmatter Template

```yaml
---
layout: post
title: "Specific, outcome-focused headline (under 65 chars ideal)"
subtitle: "One sentence that earns the click — the specific situation or result"
description: "SEO meta: what this answers, who it's for. Under 155 chars."
date: YYYY-MM-DD
tags:
  - posts
  - Tag1
  - Tag2
category: "Infrastructure & DevOps | Web Engineering | Developer Automation | AI Engineering"
tldr: "Direct answer in 1–2 sentences. Use <code>code</code> and <strong>bold</strong>. No raw HTML tags."
faq:
  - q: "Exact question as someone would Google it?"
    a: "Direct answer. Specific. Actionable. Under 100 words."
---
```

---

*Last updated: 2026-06-06 | Applied to every post on bilalmeccai.com*
