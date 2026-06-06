---
layout: post
title: "How I gave Claude Code a memory, 17 agents, and a learning loop — in one command"
subtitle: "Ruflo v3 turns a single Claude Code session into a coordinated system. Here's the exact setup, including the Windows gotchas and the custom hooks I added on top."
description: "Step-by-step guide to installing Ruflo v3 on Windows with Claude Code: MCP server registration, session ID logging, and auto-initializing daemon/memory/swarm on every session start."
date: 2026-06-06
tags:
  - posts
  - Claude Code
  - Ruflo
  - AI Tooling
  - DevOps Automation
category: "AI Engineering"
tldr: "Run <code>npx ruflo@latest init</code> in your project, register the MCP server with <code>claude mcp add ruflo -- npx ruflo@latest mcp start</code>, then add a <code>SessionStart</code> hook to log session IDs and auto-start the daemon. Every session now has 17 specialised agents, vector memory, and a resume ID logged to <code>.claude/sessions.log</code>."
faq:
  - q: "What is Ruflo and how does it differ from plain Claude Code?"
    a: "Ruflo is a meta-harness on top of Claude Code. It adds 100+ specialised agents, HNSW vector memory, swarm coordination, and a hook system that fires on every Claude Code event. Plain Claude Code is one AI session; Ruflo turns it into a coordinated system where agents collaborate and knowledge persists across sessions."
  - q: "Does Ruflo work on Windows?"
    a: "Yes. Ruflo v3 auto-detects Windows and writes cmd.exe-compatible hook commands. Use npx ruflo@latest init instead of the curl installer, which requires a POSIX shell."
  - q: "How do I fix the npm ECOMPROMISED error when installing Ruflo?"
    a: "Run npm cache clean --force first, then retry npx ruflo@latest init. The ECOMPROMISED error is a stale integrity hash in the npm cache — not a genuine security issue."
  - q: "How do I resume a previous Claude Code session?"
    a: "Run claude --resume <session_id>. The session ID is logged automatically to .claude/sessions.log on every SessionStart. Each entry includes the full resume command so you can copy-paste it directly."
  - q: "Will Ruflo's CLAUDE.md conflict with my existing project CLAUDE.md?"
    a: "No. Ruflo creates a root CLAUDE.md with agent coordination rules. Your project CLAUDE.md lives at .claude/CLAUDE.md. Claude Code reads both without conflict."
  - q: "What is the SessionStart hook and what can I put in it?"
    a: "SessionStart fires every time a new Claude Code session opens. Ruflo uses it to restore state and import memory. You can add your own commands — I use it to log the session UUID to a file and to start the Ruflo daemon in the background."
---

I kept losing my place.

Every Claude Code session started from scratch. No memory of what I'd worked on the day before. No context about which tasks were mid-flight. I'd have to re-explain the project structure, re-set the context, re-tell Claude what we were doing.

Productive? Yes. But it was leaving time on the table.

Then I found Ruflo. One command later, I had 17 specialised agents, persistent vector memory, a learning loop that gets better with every task, and — the part I care about most — a session ID logged automatically so I can always resume exactly where I left off.

Here's the exact setup.

---

## What Ruflo adds to Claude Code

Before touching a terminal, here's what you're actually getting:

| Feature | Without Ruflo | With Ruflo |
|---------|--------------|------------|
| Memory between sessions | None | HNSW vector DB, persisted |
| Agent specialisation | One general assistant | 17 routed agents (coder, architect, security, etc.) |
| Background workers | None | Audit + optimise on a schedule |
| Session resume | Manual `--resume` flag | Auto-logged UUID with full resume command |
| Task routing | Manual | Automatic — hooks route to the best agent |

The key thing: **you don't change how you use Claude Code.** After setup, everything happens in the background. You type, Ruflo routes, learns, and remembers.

---

## Installation on Windows

The README has a one-liner curl installer. Skip it on Windows — it needs a POSIX shell. Use npx instead:

```powershell
# Run this inside your project directory
npx ruflo@latest init
```

**If you hit `ECOMPROMISED`**, your npm cache has a stale integrity hash. This is not a security alert — it's a cache mismatch. Fix it:

```powershell
npm cache clean --force
npx ruflo@latest init
```

The init takes about a minute and creates 106 files across 11 directories. Here's what matters:

| Path | What it is |
|------|-----------|
| `CLAUDE.md` (root) | Ruflo's agent coordination rules for Claude |
| `.claude/settings.json` | 8 hook types, permissions, env config |
| `.claude/agents/` | 17 agent definitions |
| `.claude/skills/` | 30 skill modules |
| `.mcp.json` | MCP server config — Claude Code reads this automatically |
| `.claude-flow/` | Runtime data, logs, memory (not committed to git) |

---

## Registering the MCP server

The `.mcp.json` file is picked up automatically by Claude Code, but I also register it explicitly so it appears in `claude mcp list` and I can verify the connection:

```bash
claude mcp add ruflo -- npx ruflo@latest mcp start
```

Verify it connected:

```bash
claude mcp list
# ruflo: npx ruflo@latest mcp start - ✓ Connected
```

If you see `⏸ Pending approval`, open Claude Code once — it'll prompt you to approve.

---

## The session ID problem (and my fix)

By default, if you close a Claude Code session and want to pick it back up, you need the session UUID. It's not obvious where to find it.

I solved this with a lightweight `SessionStart` hook that appends to `.claude/sessions.log` every time a new session opens:

```javascript
// .claude/helpers/log-session.cjs
'use strict';
const fs = require('fs');
const path = require('path');

const LOG = path.join(process.env.CLAUDE_PROJECT_DIR, '.claude', 'sessions.log');

async function readStdin() {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve) => {
    let data = '';
    const t = setTimeout(() => resolve(data), 500);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => { data += c; });
    process.stdin.on('end', () => { clearTimeout(t); resolve(data); });
    process.stdin.resume();
  });
}

(async () => {
  const safety = setTimeout(() => process.exit(0), 3000);
  safety.unref();

  let input = {};
  try { const raw = await readStdin(); if (raw.trim()) input = JSON.parse(raw); } catch (_) {}

  const sessionId = input.session_id || '';
  if (!sessionId) process.exit(0);

  // Don't log duplicates
  if (fs.existsSync(LOG) && fs.readFileSync(LOG, 'utf8').includes(sessionId)) process.exit(0);

  const ts = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  fs.appendFileSync(LOG, `[${ts} IST]\n  Session ID : ${sessionId}\n  Resume     : claude --resume ${sessionId}\n\n`);
  clearTimeout(safety);
  process.exit(0);
})();
```

Wire it into `SessionStart` in `.claude/settings.json` — add it alongside Ruflo's existing hooks, not replacing them:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cmd /c node \"%CLAUDE_PROJECT_DIR%\\.claude\\helpers\\log-session.cjs\"",
            "timeout": 3000
          }
        ]
      }
    ]
  }
}
```

Now every session logs this automatically:

```
[06/06/2026, 15:32:10 IST]
  Session ID : 4a0096a2-b694-4d50-82b8-0b515b4a7b42
  Resume     : claude --resume 4a0096a2-b694-4d50-82b8-0b515b4a7b42
```

To jump back in: `claude --resume 4a0096a2-b694-4d50-82b8-0b515b4a7b42`

---

## Auto-starting daemon, memory, and swarm

Ruflo needs three background services to be fully operational. Rather than starting them manually every time, I added a second `SessionStart` hook that spawns them as detached processes the moment a session opens:

```javascript
// .claude/helpers/ruflo-session-init.cjs
'use strict';
const { spawn } = require('child_process');

const commands = [
  'npx ruflo@latest daemon start',
  'npx ruflo@latest memory init',
  'npx ruflo@latest swarm init',
];

for (const cmd of commands) {
  const child = spawn('cmd', ['/c', cmd], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: process.env.CLAUDE_PROJECT_DIR,
    env: { ...process.env, npm_config_update_notifier: 'false' },
  });
  child.unref(); // hook exits immediately — processes continue in background
}

process.exit(0);
```

The `child.unref()` is non-negotiable. Hooks must exit cleanly — if you wait for these processes, your session start hangs until they finish.

---

## The complete hook sequence

After this setup, every Claude Code session fires this sequence:

```
SessionStart
  → session-restore     (Ruflo: loads previous state)
  → auto-memory-hook    (Ruflo: imports persisted memory)
  → log-session.cjs     (custom: writes UUID to sessions.log)
  → ruflo-session-init  (custom: starts daemon/memory/swarm in background)

UserPromptSubmit
  → route               (Ruflo: routes task to optimal agent)

PostToolUse
  → post-edit           (Ruflo: records edit outcome for learning)

Stop
  → auto-memory-hook sync (Ruflo: persists memory before exit)
```

You type. The rest happens automatically.

---

## One thing that caught me off guard

The `ECOMPROMISED` error looks alarming. It's not. NPM's integrity checking flags it when a cached package hash no longer matches the registry — which happens after a package update touches the cache. `npm cache clean --force` clears it in seconds.

The broader pattern: when any tool modifies your shell's hook system, review what's there before and after init. Ruflo is well-behaved — it writes its own hooks without touching existing ones. But I still read `.claude/settings.json` after init to understand the full picture before adding my custom hooks on top.

---

If you're setting this up and hitting something unexpected — a hook that doesn't fire, a session that won't resume, a Windows path issue — I'm happy to help debug it. Reach out at [bilalmeccai.com/#contact](https://bilalmeccai.com/#contact) or bilalmeccai@gmail.com.

---

## Frequently Asked Questions

<details class="faq-item">
  <summary class="faq-q">What is Ruflo and how does it differ from plain Claude Code?</summary>
  <div class="faq-a">Ruflo is a meta-harness on top of Claude Code. It adds 100+ specialised agents, HNSW vector memory, swarm coordination, and a hook system. Plain Claude Code is one AI session; Ruflo turns it into a coordinated system where agents collaborate and knowledge persists.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">Does Ruflo work on Windows?</summary>
  <div class="faq-a">Yes. Ruflo v3 auto-detects Windows and writes <code>cmd.exe</code>-compatible hook commands. Use <code>npx ruflo@latest init</code> — the curl installer requires a POSIX shell and won't work in PowerShell.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">How do I fix the npm ECOMPROMISED error?</summary>
  <div class="faq-a">Run <code>npm cache clean --force</code>, then retry <code>npx ruflo@latest init</code>. The error is a stale integrity hash in your local npm cache — not a security issue.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">How do I resume a previous Claude Code session?</summary>
  <div class="faq-a">Run <code>claude --resume &lt;session_id&gt;</code>. With the <code>log-session.cjs</code> hook, the UUID and full resume command are written to <code>.claude/sessions.log</code> automatically on every session start.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">Will Ruflo's CLAUDE.md conflict with my project CLAUDE.md?</summary>
  <div class="faq-a">No. Ruflo creates a root <code>CLAUDE.md</code>; your project CLAUDE.md lives at <code>.claude/CLAUDE.md</code>. Claude Code reads both without conflict.</div>
</details>
