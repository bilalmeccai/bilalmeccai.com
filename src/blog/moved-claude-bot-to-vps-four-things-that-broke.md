---
layout: post
title: "Moved My Claude Code Bot to a VPS — Here Are the 4 Things That Broke"
subtitle: "Root restrictions, trust dialogs, missing git identity, PAT auth — every error in sequence, every fix in under two minutes each."
description: "Moving a Claude Code Telegram bot from Windows to a Linux VPS breaks in 4 predictable ways. Here's the exact error, the reason, and the fix for each one."
date: 2026-06-28
tags:
  - posts
  - Claude Code
  - DevOps
  - Linux
  - VPS
  - Telegram
  - Debugging
category: "DevOps"
tldr: "Running Claude Code as a server daemon on Linux breaks in four places: <strong>(1)</strong> <code>--dangerously-skip-permissions</code> is blocked on root, <strong>(2)</strong> the project needs a trust dialog accepted, <strong>(3)</strong> git has no identity configured, <strong>(4)</strong> git can't push without a GitHub PAT. Fix all four and it runs headless, 24/7."
faq:
  - q: "Why is --dangerously-skip-permissions blocked when running as root?"
    a: "It's a security guardrail baked into Claude Code. Running unrestricted AI-driven file operations as root could overwrite system files. The fix is to remove that flag and instead configure permissions.allow in .claude/settings.json with the specific tools Claude needs."
  - q: "How do I accept the Claude Code trust dialog without an interactive terminal?"
    a: "Edit /root/.claude.json directly. Add your project path under the projects key with hasTrustDialogAccepted set to true. Claude Code reads this file on startup and skips the interactive prompt."
  - q: "What GitHub PAT permissions does a git push bot need?"
    a: "Just repo (full). That covers push, status, fetch, and branch creation. Nothing else required."
  - q: "Will the GitHub PAT show up in git log or history?"
    a: "No — you embed it in the remote URL via git remote set-url. It lives in .git/config locally and in the git credential store. Never commit .git/config or expose the remote URL in logs."
  - q: "Can I run this as a non-root user to avoid the --dangerously-skip-permissions restriction?"
    a: "Yes, and that's the cleaner long-term setup. Create a deploy user, chown the project directory, run PM2 under that user. You can then use --dangerously-skip-permissions if needed without hitting the root guardrail."
---

The bot ran perfectly on Windows with PM2. Claude Code took tasks over Telegram, created git branches, committed files, and sent approval buttons. Worked great locally.

Then I moved it to a Linux VPS to run 24/7 — so the bot would work when my laptop was off, from anywhere, not just from my home network.

Four things broke. Every single one was a different system — Claude Code, the project trust system, git, and GitHub auth. Each took about two minutes to fix once I understood what was happening.

Here's the full sequence.

---

## What I Was Moving

A Node.js Telegram bot running on the server via PM2. When you send it a message, it runs `claude --resume <session_id> -p "your message"` in the project directory. Claude Code reads the codebase, does the work, commits to a branch, and the bot sends you Approve/Reject buttons.

The bot itself was already on the server. The project was cloned. PM2 was running it. And then I tried the Summarize Session → Blog Post Draft flow.

---

## Error 1: `--dangerously-skip-permissions` blocked on root

**What I saw:**
```
--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons
```

**Why it happens:**

The bot was spawning Claude with `--dangerously-skip-permissions` to avoid interactive permission prompts. Claude Code deliberately blocks this flag when the process is running as root. The reasoning is sound — unrestricted file operations as root can do real damage.

**The fix:**

Remove `--dangerously-skip-permissions` from the `claude` spawn command. Instead, configure `permissions.allow` in `.claude/settings.json` with the specific tools Claude needs. The flag was a shortcut — the right answer is explicit permission grants.

```json
{
  "permissions": {
    "allow": [
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git checkout:*)",
      "Bash(git merge:*)",
      "Bash(git push:*)",
      "Bash(git status:*)",
      "Bash(git log:*)",
      "Bash(git diff:*)",
      "Bash(git branch:*)",
      "Bash(npm run build:*)",
      "Bash(npm run dev:*)",
      "Write(*)",
      "Edit(*)",
      "Read(*)"
    ]
  }
}
```

This is actually better than `--dangerously-skip-permissions` — it's scoped. Claude can only do what the bot actually needs.

---

## Error 2: Project not trusted

**What I saw:**
```
Ignoring 4 permissions.allow entries from .claude/settings.json: this workspace has not been trusted.
Run Claude Code interactively here once and accept the trust dialog, or set
projects["/opt/bilal/bilalmeccai.com"].hasTrustDialogAccepted: true in /root/.claude.json
```

**Why it happens:**

Claude Code shows a one-time trust dialog when you open a project for the first time. It's interactive — you press enter to accept. On a headless server running a bot, there's no terminal to press enter in. The bot spawns Claude in non-interactive mode, the trust check fires, and it ignores all the `permissions.allow` entries as a result.

**The fix:**

Write the trust acceptance directly to `/root/.claude.json`:

```bash
cat > /tmp/trust.js << 'EOF'
const f = '/root/.claude.json';
const fs = require('fs');
let d = {};
try { d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch(_) {}
if (!d.projects) d.projects = {};
d.projects['/opt/bilal/bilalmeccai.com'] = { hasTrustDialogAccepted: true };
fs.writeFileSync(f, JSON.stringify(d, null, 2));
console.log('Done:', JSON.stringify(d.projects, null, 2));
EOF
node /tmp/trust.js
```

The script is written to a file first because bash's history expansion breaks on `!` inside double-quoted strings — `!d.projects` triggers it and you get `-bash: !d.projects: event not found`. Writing to a file and running with `node` sidesteps that completely.

{% callout "warn" %}
The error message tells you exactly where to set the flag. Read error messages to the end — they often contain the solution.
{% endcallout %}

---

## Error 3: git has no identity

**What I saw:**
```
Commit failed: *** Please tell me who you are.

Run
  git config --global user.email "you@example.com"
  git config --global user.name "Your Name"
```

**Why it happens:**

Claude ran, wrote the file, and the bot tried to commit. Git requires a name and email to create a commit. On a fresh VPS, this is never set. On Windows/Mac you usually configure this once during git install and forget about it.

**The fix:**

```bash
git config --global user.email "bilalmeccai@gmail.com"
git config --global user.name "bilalmeccai"
```

Two commands, done. The `--global` flag writes to `~/.gitconfig` so it applies to all repos on the server.

---

## Error 4: git can't push without auth

**What I saw:**

After fixing the commit identity, the bot committed successfully — and then failed to push the branch. GitHub requires authentication. SSH keys or HTTPS with a PAT.

**The fix:**

Generate a GitHub Personal Access Token (PAT) with `repo` scope only:

```
GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
→ Generate new token → tick: repo (full) → Generate
```

Then embed it in the remote URL:

```bash
cd /opt/bilal/bilalmeccai.com
git remote set-url origin https://YOUR_USERNAME:YOUR_PAT@github.com/YOUR_USERNAME/your-repo.git
```

Verify it works:

```bash
git fetch origin
```

If that returns cleanly, auth is working. The bot can now push branches.

---

## The pattern

Looking at these four errors together — they're all the same class of problem. Each one is a system that was configured interactively on Windows (once, years ago, and forgotten) that had no configuration at all on a fresh server.

| Error | Root cause | Time to fix |
|-------|-----------|------------|
| `--dangerously-skip-permissions` blocked | Security guardrail, root process | ~5 min (settings.json) |
| Project not trusted | Interactive dialog never run | ~2 min (one script) |
| No git identity | Never configured on this server | ~30 seconds |
| Push auth fails | No credentials stored | ~3 min (PAT + remote URL) |

None of them were Claude Code bugs. None were bot bugs. They were all missing configuration for a headless environment.

This is the pattern with server deployments: the things that "just work" locally are things that were configured once and forgotten. Servers start blank.

---

## Final state

After all four fixes, the flow runs end to end:

```
Telegram message
       ↓
bot.cjs spawns: claude --resume <id> -p "message"
       ↓
Claude reads project, writes files
       ↓
git add -A && git commit -m "feat: ..."
       ↓
git push origin feat/branch-name
       ↓
Bot sends: [✅ Approve & Deploy] [📋 Diff] [❌ Reject]
       ↓
Tap Approve → git merge → git push origin main → Vercel deploys
```

Always-on, works from anywhere. No laptop required.

---

If you're setting up a similar Claude Code bot on a server and hitting something outside these four — different Linux distro, different PM2 setup, different git hosting — reach out at [bilalmeccai.com/#contact](https://bilalmeccai.com/#contact).

---

## Frequently Asked Questions

<details class="faq-item">
  <summary class="faq-q">Why is --dangerously-skip-permissions blocked when running as root?</summary>
  <div class="faq-a">It's a security guardrail in Claude Code. Unrestricted AI-driven file operations as root could overwrite system files. Remove that flag and use <code>permissions.allow</code> in <code>.claude/settings.json</code> instead — it's more scoped and the right approach.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">How do I accept the Claude Code trust dialog without an interactive terminal?</summary>
  <div class="faq-a">Edit <code>/root/.claude.json</code> directly. Add your project path under the <code>projects</code> key with <code>hasTrustDialogAccepted: true</code>. Claude Code reads this on startup and skips the interactive prompt.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">What GitHub PAT permissions does the bot need?</summary>
  <div class="faq-a">Just <code>repo</code> (full). That covers push, fetch, branch creation, and status. Nothing else required for a private repo bot that commits and pushes branches.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">Why write the trust script to a file instead of running it inline?</summary>
  <div class="faq-a">Bash history expansion treats <code>!</code> inside double-quoted strings as a history reference. <code>!d.projects</code> triggers <code>-bash: !d.projects: event not found</code>. Writing to a file and running with <code>node</code> avoids the shell parsing entirely.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">Can I run this as a non-root user to avoid the root restriction?</summary>
  <div class="faq-a">Yes, and it's cleaner long-term. Create a deploy user, <code>chown</code> the project directory to that user, and run PM2 under that user. You can then use <code>--dangerously-skip-permissions</code> without hitting the root guardrail if needed.</div>
</details>
