---
layout: post
title: "I built a Telegram bot that manages my website — nothing deploys without my approval"
subtitle: "Branch per task, Claude does the work, I tap Approve on my phone. Here's the full setup: bot code, PM2 on Windows, persistent sessions, and the git approval gate."
description: "How to build a Telegram bot that remote-controls Claude Code on your project: creates a git branch per task, requires human approval before merging to main, and auto-deploys via Vercel on approval."
date: 2026-06-06
tags:
  - posts
  - Telegram
  - Claude Code
  - Git Workflow
  - Developer Automation
  - DevOps
category: "Developer Automation"
tldr: "A <code>telegraf</code>-based Node.js bot runs <code>claude --resume &lt;id&gt; -p</code> in your project directory. Every file-changing task creates a git branch. When done, the bot sends Approve / Diff / Reject buttons. Tap Approve → <code>git merge</code> → <code>git push</code> → Vercel deploys. The bot stores one session UUID per Telegram chat so Claude remembers context across messages."
faq:
  - q: "Does the Telegram bot work when my computer is off?"
    a: "No — the bot runs on your local machine and needs it to be on. For always-on access, move the bot to a VPS (Railway, Render, Fly.io) with the project cloned there. The bot code is fully portable — only CLAUDE_PROJECT_DIR in .env changes."
  - q: "How does the bot keep conversation context across Telegram messages?"
    a: "The first message stores a Claude session UUID in .claude-flow/data/telegram-sessions.json, keyed by your Telegram chat ID. Every subsequent message uses claude --resume <uuid>. The /reset command clears the stored session."
  - q: "What happens if a Claude session expires?"
    a: "The bot detects the 'not found' error from --resume, starts a fresh session automatically, and notifies you with both the old and new session IDs. You're never left silently on a stale session."
  - q: "How do I stop other people from using my bot?"
    a: "Set TELEGRAM_ALLOWED_USER_IDS in your .env file to your Telegram user ID. You can get it by messaging @userinfobot. Messages from any other user ID are silently dropped."
  - q: "Can I approve or reject branch merges from my phone?"
    a: "Yes. That's the whole point. When a task finishes, the bot sends inline keyboard buttons directly in the chat. Tap Approve to merge and deploy, Diff to review changes inline, or Reject to delete the branch."
  - q: "How does the bot know which files Claude changed?"
    a: "After Claude finishes, the bot runs git status --short on the project directory. If any files were staged, it commits them to the feature branch and sends the approval notification. If nothing changed, it cleans up the branch silently."
---

Ideas don't wait for a desk.

I was on the road when I thought of a blog post I wanted to write. I had my phone, not my laptop. I wanted to send a message and have it just happen — Claude writes the post, formats it correctly, commits it to a branch, and waits for me to approve before anything goes live.

That's what this bot does. Here's how I built it and how it works.

---

## The full flow

```
You send a message on Telegram
         ↓
bot.cjs receives it (running on your machine via PM2)
         ↓
Creates a git branch: feat/your-task-slug-timestamp
         ↓
Runs: claude --resume <session_id> -p "your message"
         ↓
Claude works in your project (writes files, creates posts, etc.)
         ↓
git add -A && git commit
         ↓
Bot sends approval notification:
  [✅ Approve & Deploy]  [📋 Diff]  [❌ Reject]
         ↓
You tap Approve
         ↓
git merge → git push origin main → Vercel deploys
Live in ~30 seconds
```

Nothing reaches `main` without a deliberate tap.

---

## Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Bot framework | `telegraf` v4 | Modern, well-maintained, clean middleware API |
| Process manager | PM2 + `pm2-windows-startup` | Auto-restart, survives reboots on Windows |
| Claude integration | `claude -p` / `--resume` | Full project context (reads CLAUDE.md, codebase) |
| Session storage | JSON file (`.claude-flow/data/`) | No database, survives bot restarts |
| Branch tracking | JSON file (`.claude-flow/data/`) | Pending approvals persist across crashes |

---

## The branch-per-task pattern

The core of the safety system. Every task that changes files gets its own branch. The `withBranch` helper handles the full lifecycle in one function:

```javascript
async function withBranch(ctx, label, actionFn) {
  const branch = `feat/${slugify(label)}-${timestamp()}`;

  await runCmd('git', ['checkout', 'main']);          // always start from main
  await runCmd('git', ['checkout', '-b', branch]);    // create feature branch

  const result = await actionFn(branch);              // run the actual work

  const { out: statusOut } = await runCmd('git', ['status', '--short']);
  if (!statusOut.trim()) {
    // Nothing changed — delete the branch, return result directly
    await runCmd('git', ['checkout', 'main']);
    await runCmd('git', ['branch', '-D', branch]);
    return { ...result, branched: false };
  }

  await runCmd('git', ['add', '-A']);
  await runCmd('git', ['commit', '-m', `feat: ${label}`]);
  await runCmd('git', ['checkout', 'main']);           // always return to main

  return { ...result, branched: true, branch };
}
```

The bot always returns to `main` after creating a branch. Without this, subsequent tasks would branch off the wrong base.

---

## Persistent conversation across messages

Each Telegram chat maps to one Claude session UUID. The first message starts a fresh session, captures the new UUID from `.claude/sessions.log`, and stores it:

```javascript
// Before running claude, snapshot what's already in the log
const beforeIds = sessionIdsInLog();

// Run the prompt
const result = await runCmd('claude', ['-p', prompt], { timeout: 300000 });

// Wait 800ms — the SessionStart hook writes async
await new Promise(r => setTimeout(r, 800));

// Find the UUID that wasn't there before
const sid = newSessionId(beforeIds);
if (sid) setSession(chatId, sid);
```

Every subsequent message uses `claude --resume <uuid> -p "<message>"`. Claude remembers everything from earlier in the conversation — context across messages, across sessions, from wherever you are.

If a session expires, the bot detects the failure and tells you:

```
⚠️ Previous session expired
Old: `4a0096a2-...`
New: `e5f6g7h8-...`
```

You're never silently on a stale session.

---

## Setting up on Windows

```powershell
# Inside your project
cd telegram-bot
npm install

# Install PM2 and Windows startup handler
npm install -g pm2
npm install -g pm2-windows-startup
pm2-startup install    # writes a registry key — PM2 runs at Windows login

# Fill in credentials
copy .env.example .env
# Edit .env:
#   TELEGRAM_BOT_TOKEN — from @BotFather on Telegram
#   TELEGRAM_ALLOWED_USER_IDS — from @userinfobot on Telegram
#   CLAUDE_PROJECT_DIR — full path to your project

# Start the bot
pm2 start pm2.config.cjs
pm2 save              # saves process list so it restores on reboot
```

> One thing: `pm2 startup` throws "Init system not found" on Windows. Ignore that error — use `pm2-windows-startup install` instead (run separately, not as `pm2 startup`). This is a known Windows/PM2 quirk.

---

## The commands you'll actually use

| Command | What happens |
|---------|-------------|
| `/newpost My Post Title` | Creates branch → Claude writes the post → approval gate |
| `/deploy fix nav bug` | Stages all changes → creates branch → approval gate |
| `/status` | Git status + last 5 commits |
| `/branches` | Lists all branches waiting for your approval |
| `/session` | Shows your active Claude session UUID |
| `/reset` | Clears the stored session — next message starts fresh |
| `/summarize` | Reads session transcript → generates blog draft / X post / summary |
| Any text | Runs as `claude --resume <id> -p "<text>"` — full project context |

---

## One thing that caught me

The 800ms wait before reading `sessions.log` is a timing workaround. The `SessionStart` hook writes to the log file slightly after `claude -p` starts (not after it finishes). Without the wait, `newSessionId()` finds nothing and the session doesn't get stored.

A cleaner solution would be to poll until the log file changes. The 800ms delay has been reliable in practice — but if you're on a very slow machine or have heavy `SessionStart` hooks, increase it to 1500ms.

---

Moving to a cloud server later is straightforward. Copy `telegram-bot/` to a VPS, clone the project there, update `CLAUDE_PROJECT_DIR` in `.env`, and start PM2. Zero code changes. The bot is completely portable.

If you're building something similar and hit an edge case — particularly around session detection or Windows path handling — I'm happy to help work through it. Reach out at [bilalmeccai.com/#contact](https://bilalmeccai.com/#contact) or bilalmeccai@gmail.com.

---

## Frequently Asked Questions

<details class="faq-item">
  <summary class="faq-q">Does the bot work when my computer is off?</summary>
  <div class="faq-a">No — it runs on your local machine. For always-on access, move it to a VPS. Only <code>CLAUDE_PROJECT_DIR</code> in <code>.env</code> needs changing.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">How does the bot keep conversation context across messages?</summary>
  <div class="faq-a">First message → Claude session UUID stored per chat ID in a JSON file. Every subsequent message uses <code>claude --resume &lt;uuid&gt;</code>. <code>/reset</code> to start fresh.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">How do I stop other people from using my bot?</summary>
  <div class="faq-a">Set <code>TELEGRAM_ALLOWED_USER_IDS</code> in <code>.env</code> to your Telegram user ID. Get it from <code>@userinfobot</code>. Any other user ID is silently dropped.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">Can I approve merges from my phone?</summary>
  <div class="faq-a">Yes — that's the point. When a task finishes, the bot sends inline buttons in the chat: Approve & Deploy, Diff, or Reject. Approve runs <code>git merge</code> → <code>git push</code> → Vercel deploys.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">What does the bot do if Claude changes nothing?</summary>
  <div class="faq-a">It checks <code>git status --short</code> after Claude runs. If there are no changes, it deletes the feature branch silently and returns the Claude response directly — no approval prompt needed.</div>
</details>
