---
layout: post
title: "I Auto-Publish Blog Posts From My Coding Sessions Using Claude Code and a Telegram Bot"
subtitle: "Every debugging session is a draft blog post. Here's the pipeline that makes it happen automatically."
description: "How I built a Telegram bot that reads Claude Code sessions, generates blog posts, and deploys them to my site — no writing required."
date: 2026-06-29
tags:
  - posts
  - Claude Code
  - Automation
  - DevOps
  - Telegram
  - Content Creation
category: "DevOps"
tldr: "Claude Code saves every session to disk. A Telegram bot reads those sessions, passes them to Claude with a blog-post prompt, writes the <code>.md</code> file, commits to a branch, and sends me an <strong>Approve & Deploy</strong> button. Tap it — Vercel deploys in 30 seconds. The bottleneck is no longer writing, it's just deciding what to ship."
faq:
  - q: "Where does Claude Code store sessions?"
    a: "Under ~/.claude/projects/<hashed-project-path>/<session-id>/. Each session is a directory containing the conversation turns as JSON. You can read them programmatically — the bot does exactly this."
  - q: "Does the blog post need editing before publishing?"
    a: "The bot creates a branch, not a direct merge. You review the diff in Telegram before approving. You can also reject and ask for a rewrite. The pipeline is automated but the approval is manual."
  - q: "What keeps a post from getting published twice for the same session?"
    a: "The branch name includes the session ID and a timestamp. You can check whether a branch for that session already exists before spawning Claude. In practice, you just don't tap Summarize on the same session twice."
  - q: "Can this work for sessions on a laptop that aren't always on?"
    a: "Sessions need to be on the server where the bot runs. Set up a sync job — rsync on a schedule, a cron that copies the ~/.claude directory to the VPS — and the bot always has access regardless of whether the laptop is online."
---

The real problem with writing consistently isn't motivation. It's that the writing phase is completely separate from the work phase.

You solve a real problem. The insight is fresh. Then you close the terminal, open a blank document, and start reconstructing what just happened — from memory, usually days later.

By then the thinking is gone. You get a summary of the summary.

I wanted to close that gap. Every non-trivial Claude Code session already contains the full thinking trail: what I tried, what failed, what worked, and why. That's a blog post. It just isn't formatted like one.

---

## The Architecture

```
Claude Code session (laptop)
        ↓
  rsync to VPS (scheduled)
        ↓
  ~/.claude/projects/<hash>/<session-id>/
        ↓
  Telegram: tap ✍️ Summarize Session
        ↓
  Bot picks session, sends to Claude:
  "Summarize this as a blog post for bilalmeccai.com"
        ↓
  Claude writes src/blog/<slug>.md
        ↓
  git commit → git push → branch created
        ↓
  Bot sends [✅ Approve & Deploy] [📋 Diff] [❌ Reject]
        ↓
  Tap Approve → merge to main → Vercel deploys
```

Five minutes from session to live post. The only manual step is tapping Approve.

---

## Where Claude Code Stores Sessions

This is the part most people don't know about.

Claude Code persists every session under:
```
~/.claude/projects/<hashed-path>/<session-id>/
```

The hash is derived from the project directory path. So for `/opt/bilal/bilalmeccai.com`, there's a corresponding directory under `~/.claude/projects/` that contains every session ever run in that project.

Each session is a JSON file with the full conversation — every user message, every assistant response, every tool call. It's all there.

The bot reads this directory, lists available sessions with their timestamps and approximate topic (extracted from the first few turns), and presents them as a numbered menu in Telegram. Pick one, tap Summarize, and Claude reads the full session JSON and drafts the post.

---

## The Summarize Prompt

The bot passes the session to Claude with a prompt that specifies:
- Write for bilalmeccai.com — direct, no fluff, plain-language explanations
- Follow the exact frontmatter spec (title, subtitle, description, tags, tldr, faq)
- Show the thinking process and the aha moment
- Include code examples for anything that had a working fix
- No credentials, internal IPs, or confidential client names

The output is a complete `.md` file dropped into `src/blog/`. No post-processing.

---

## The Approval Gate

The bot doesn't merge directly. It creates a branch:

```
feat/blog-from-session-<session-id>-<timestamp>
```

Then sends two buttons to Telegram:

- **✅ Approve & Deploy** — merges to main, Vercel deploys automatically
- **📋 View Diff** — shows the full diff so you can read the post before shipping
- **❌ Reject** — deletes the branch

If the post needs changes, you reject and either edit manually or ask the bot to regenerate with additional context.

This keeps the pipeline fast while keeping the final call with you.

---

## What Had to Work First

The pipeline sounds simple. Getting it to work headless on a Linux VPS — always on, no interactive terminal — took fixing four separate systems.

Claude Code has a root-process restriction, a project trust dialog, and no git identity or push credentials on a fresh server. Each one broke the pipeline silently or with a cryptic error.

I documented all four in detail: [Moved My Claude Code Bot to a VPS — Here Are the 4 Things That Broke](/blog/moved-claude-bot-to-vps-four-things-that-broke/).

The short version: trust the project non-interactively, remove `--dangerously-skip-permissions`, set global git identity, and embed a GitHub PAT in the remote URL.

After those four fixes, the flow runs end to end.

---

## The Real Value

The bottleneck shifted.

Before: I'd do good work, then face a blank page.
After: I tap a button, read the draft, and decide whether to ship it.

The draft isn't always perfect. Sometimes the framing is off. Sometimes I add a section Claude missed. But starting from 80% done is a completely different cognitive state than starting from zero.

The work creates the content. The pipeline just moves it.

---

## Frequently Asked Questions

<details class="faq-item">
  <summary class="faq-q">Where does Claude Code store sessions?</summary>
  <div class="faq-a">Under <code>~/.claude/projects/&lt;hashed-project-path&gt;/&lt;session-id&gt;/</code>. Each session is a directory containing conversation turns as JSON. The hash is derived from the project directory path — you can list the directory to find your project's hash.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">Does the blog post need editing before publishing?</summary>
  <div class="faq-a">The bot creates a branch, not a direct merge. You review the diff in Telegram before approving. You can reject and ask for a rewrite with more context. The pipeline is automated; the approval is manual.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">What keeps a post from getting published twice for the same session?</summary>
  <div class="faq-a">Branch names include the session ID and a timestamp. In practice — you just don't tap Summarize on the same session twice. You could add a check that looks for existing branches with that session ID before spawning Claude.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">Can this work for sessions on a laptop that isn't always on?</summary>
  <div class="faq-a">Sessions need to be on the server where the bot runs. Set up an rsync job on a schedule — copy the <code>~/.claude</code> directory to the VPS. The bot always has access regardless of whether the laptop is online.</div>
</details>
