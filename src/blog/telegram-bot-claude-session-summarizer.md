---
layout: post
title: "I Built a Telegram Bot That Turns Any Claude Code Session Into a Blog Post"
subtitle: "Claude Code saves every session as a JSONL file. Once you know that, you can build anything on top of it — including a bot that writes your blog for you."
description: "How I built a Telegram bot that scans Claude Code session transcripts, lets you pick one with a button tap, then generates a publish-ready blog post or tweet — no UUID typing, no per-project setup."
date: 2026-06-07
tags:
  - posts
  - Telegram
  - Claude Code
  - Node.js
  - Automation
  - DevTools
category: "AI Engineering"
tldr: "Claude Code stores every session transcript as a JSONL file under <code>~/.claude/projects/&lt;project-hash&gt;/&lt;session-id&gt;.jsonl</code>. A Telegram bot can scan that folder, show all sessions as tap-to-pick inline buttons, then call Claude to generate a blog post or tweet from any session — including sessions from other projects. No UUID typing. No per-project setup."
faq:
  - q: "Where does Claude Code store session transcripts?"
    a: "Under ~/.claude/projects/<project-hash>/<session-id>.jsonl on your machine. Every session from every project ends up there. The project hash is derived from the working directory path."
  - q: "Why use a reply keyboard instead of slash commands in Telegram?"
    a: "Slash commands require the user to type or remember them. A reply keyboard shows persistent buttons at the bottom of the chat — tapping one sends the action directly, like a native mobile UI. Better for frequent operations."
  - q: "What is the pendingAction pattern for Telegram bots?"
    a: "When a button needs follow-up input (like a title or UUID), store the expected action in a Map keyed by chat ID. The next message handler checks for a pending action before routing normally. This lets you build multi-step flows without a state machine library."
  - q: "Why does the blog-post format need --dangerously-skip-permissions?"
    a: "When Claude is spawned as a subprocess with no TTY, any file write that triggers an approval prompt blocks indefinitely — no stdin to respond. The --dangerously-skip-permissions flag lets Claude write the file unblocked. The approval gate is moved to the bot level: withBranch creates a branch, and you approve/reject the merge from Telegram."
  - q: "Why do Telegram callback queries sometimes throw when answered?"
    a: "Telegram can fire the same callback twice if the button tap is slow or the connection retries. The second answerCbQuery call on an already-answered query throws an error. Wrap every answerCbQuery in .catch(() => {}) to silently drop duplicates."
  - q: "How do I get a Claude Code session ID?"
    a: "Run /session in the Claude Code chat window. The UUID is also the filename of the transcript JSONL under ~/.claude/projects/."
---

## The Problem With Letting Good Sessions Die

Every time I solve something interesting in Claude Code, it ends the same way: I close the tab and the thinking disappears.

The session transcript is sitting there — a full record of what was tried, what failed, what clicked. The kind of material that would make a useful blog post or a sharp tweet. But turning it into content means opening the file, reading through pages of tool calls, writing a summary, editing it. Nobody does that consistently.

I wanted a one-tap solution. Open Telegram, tap a button, pick a session, get a draft. No manual steps.

Here's how I built it.

---

## The Key Insight

Claude Code stores every session transcript locally as a JSONL file:

```
C:\Users\<you>\.claude\projects\<project-hash>\<session-id>.jsonl
```

The project hash is deterministic from the working directory path. The session ID is the UUID you see in the Claude Code interface (or via `/session`). Every session from every project ends up in that folder tree — automatically, without any setup.

This means any script on your machine can read any Claude Code session. The data is yours, local, not behind an API.

That's the unlock. Once I saw that, the rest was wiring.

---

## The Architecture

The bot runs locally via PM2. It has three layers:

1. **Reply keyboard** — 8 persistent buttons replacing slash commands
2. **Session picker** — scans `~/.claude/projects/` and shows all sessions as inline buttons
3. **Content generator** — spawns Claude as a subprocess, passes the JSONL transcript, gets back a blog post or tweet

```
Telegram tap → bot → scan ~/.claude/projects/ → show sessions as buttons
                                                    ↓
                                              Claude subprocess
                                                    ↓
                                         blog .md / tweet text / summary
```

---

## Part 1: Reply Keyboard Over Slash Commands

The bot started with slash commands. My question was simple: why should I type `/newpost` when I could just tap a button?

Telegram supports a **reply keyboard** — a row of buttons that sits where the text keyboard was. Tapping one sends a message automatically. No typing. No `/` prefix. Native feel.

```js
const MAIN_KEYBOARD = {
  reply_markup: {
    keyboard: [
      ['📝 New Post', '🐦 Tweet Draft'],
      ['📋 Blog Posts', '📊 Git Status'],
      ['🔨 Build Site', '✅ Pending Branches'],
      ['📂 Task List', '✍️ Summarize Session'],
    ],
    resize_keyboard: true,
    persistent: true,
  },
};

bot.command('start', (ctx) => ctx.reply('Ready.', MAIN_KEYBOARD));
```

The `persistent: true` flag keeps the keyboard visible. `resize_keyboard: true` stops it from taking up half the screen.

For buttons that need follow-up input — like "New Post" needing a title — I use a **pendingAction state**:

```js
const pending = new Map(); // chatId → { action, data }

// When button is tapped, store what we're waiting for
if (text === '📝 New Post') {
  pending.set(chatId, { action: 'new_post_title' });
  return ctx.reply('Post title?');
}

// At the top of the message handler, check pending first
const p = pending.get(chatId);
if (p) {
  pending.delete(chatId);
  if (p.action === 'new_post_title') return handleNewPost(ctx, text);
  // ...
}
```

Simple `Map` keyed by chat ID. No state machine library. No session middleware. The next message from that chat is interpreted in context.

---

## Part 2: Session Picker Without UUID Typing

The first version of the Summarize button asked you to paste a session UUID. That's a 36-character string. Useless on mobile.

The fix: scan the entire `~/.claude/projects/` tree and show every session as an inline button.

```js
function listAllSessions() {
  const base = path.join(os.homedir(), '.claude', 'projects');
  const sessions = [];

  for (const projectHash of fs.readdirSync(base)) {
    const projectDir = path.join(base, projectHash);
    if (!fs.statSync(projectDir).isDirectory()) continue;

    // Derive a human-readable project name from the hash folder name
    // The folder name is the encoded working directory path
    const projectName = projectHash.replace(/^D--/, '').replace(/--/g, '/').slice(-40);

    for (const file of fs.readdirSync(projectDir)) {
      if (!file.endsWith('.jsonl')) continue;
      const sessionId = file.replace('.jsonl', '');
      const filePath  = path.join(projectDir, file);
      const mtime     = fs.statSync(filePath).mtimeMs;

      sessions.push({ sessionId, projectName, filePath, mtime });
    }
  }

  return sessions.sort((a, b) => b.mtime - a.mtime); // newest first
}
```

Show them as inline keyboard buttons:

```js
bot.hears('✍️ Summarize Session', async (ctx) => {
  const sessions = listAllSessions().slice(0, 10); // top 10 most recent

  const buttons = sessions.map((s) => [{
    text: `${new Date(s.mtime).toISOString().slice(0, 10)}  ${s.projectName}  ${s.sessionId.slice(0, 8)}…`,
    callback_data: `sum_pick:${s.sessionId}`,
  }]);

  await ctx.reply('Pick a session:', { reply_markup: { inline_keyboard: buttons } });
});
```

Tap a session → format picker (Blog / Tweet / Summary) → tap format → content generated. Zero UUID typing.

{% callout "info" %}
This works for sessions from **any Claude Code project** on your machine — not just the project the bot lives in. If you solved something in a completely different working directory with no bot setup, the session still shows up here.
{% endcallout %}

---

## Part 3: Spawning Claude to Generate Content

When a format is picked, the bot reads the JSONL transcript and passes it to Claude as a subprocess:

```js
async function runSummarize(ctx, sessionId, format) {
  const session  = listAllSessions().find(s => s.sessionId === sessionId);
  const transcript = fs.readFileSync(session.filePath, 'utf8');

  const prompt = format === 'blog'
    ? `You are summarising a Claude Code conversation for content creation.
       Write a complete, publish-ready blog post for bilalmeccai.com.
       Save it as a .md file in src/blog/ following the frontmatter spec in .claude/CLAUDE.md exactly.
       Use Bilal's voice: direct, sharp, no fluff, explains tech in plain language.
       Show the thinking process and the "aha" moment.
       Include TL;DR, code examples, and FAQ section.
       Do NOT include credentials, API keys, passwords, internal IPs, or confidential company names.

       CONVERSATION TRANSCRIPT:\n\n${extractLastNTurns(transcript, 40)}`
    : format === 'tweet'
    ? `OUTPUT ONLY — do not write files.
       Write a sharp X/Twitter thread (3-5 tweets) from this Claude Code session.
       Observation → insight → implication. No humble bragging.\n\n${extractLastNTurns(transcript, 20)}`
    : /* brief */
      `OUTPUT ONLY — do not write files.
       Write a 3-sentence plain-English summary of what was built or solved in this session.\n\n${extractLastNTurns(transcript, 20)}`;

  const flags = format === 'blog' ? ['--dangerously-skip-permissions'] : [];

  const result = await runClaude(prompt, flags);
  return result;
}
```

The `--dangerously-skip-permissions` flag is **only used for blog format**, where Claude needs to write a file. Without a TTY, any approval prompt blocks forever — there's no stdin to answer it.

For tweet and brief, the prompt explicitly says "OUTPUT ONLY — do not write files", so no flag is needed.

---

## Part 4: The Bugs and Fixes

### Stderr Noise

Claude's stderr was leaking into the bot output:

```
Warning: no stdin data received in 3s, proceeding without it.
```

Fix: filter it out before showing to the user:

```js
function cleanOutput(raw) {
  return raw
    .split('\n')
    .filter(line => !line.startsWith('Warning: no stdin'))
    .filter(line => !line.includes('hook success'))
    .filter(line => !line.includes('hook error'))
    .join('\n')
    .trim();
}
```

### Double-Tap Throws

Telegram can fire the same callback query twice if the tap is slow or the network retries. The second `answerCbQuery` on an already-answered query throws an error that surfaced as a generic "Internal error" in the bot.

Fix: wrap every `answerCbQuery` in a catch:

```js
// ❌ Throws on double-tap
await ctx.answerCbQuery();

// ✅ Silent drop on duplicate
await ctx.answerCbQuery().catch(() => {});
```

One line. Should have done it from the start.

---

## What It Looks Like in Practice

1. Tap **✍️ Summarize Session** in Telegram
2. Bot shows 10 most-recent sessions as buttons: `2026-06-07  bilalmeccai.com  4a0096a2…`
3. Tap the session
4. Three format buttons appear: **Blog Post** / **Tweet** / **Summary**
5. Tap **Blog Post**
6. Bot shows: "Generating blog…" → "Blog post written and saved to src/blog/telegram-bot-claude-session-summarizer.md"
7. Approve the branch merge from Telegram

That's it. This post was generated this way.

---

> "The session transcript is already there. The thinking is already done. The only question is whether you build the pipe to capture it or let it evaporate."

---

## Frequently Asked Questions

<details class="faq-item">
  <summary class="faq-q">Where does Claude Code store session transcripts?</summary>
  <div class="faq-a">Under <code>~/.claude/projects/&lt;project-hash&gt;/&lt;session-id&gt;.jsonl</code> on your machine. Every session from every project ends up there — automatically, no setup needed.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">Why use a reply keyboard instead of slash commands?</summary>
  <div class="faq-a">Slash commands require typing. A reply keyboard shows persistent buttons at the bottom of the chat — tapping one sends the action directly. For frequent operations, it's significantly faster, especially on mobile.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">What is the pendingAction pattern for Telegram bots?</summary>
  <div class="faq-a">Store the expected next action in a <code>Map</code> keyed by chat ID when a button needs follow-up input. The message handler checks the Map before routing normally. Simple multi-step flows without a state machine library.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">Why does the blog-post format need --dangerously-skip-permissions?</summary>
  <div class="faq-a">When Claude runs as a subprocess with no TTY, any write-approval prompt blocks indefinitely — there's no stdin to answer it. The flag lets Claude write unblocked. The approval gate moves to the bot level via a branch + Telegram approval button.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">Why do Telegram callback queries sometimes throw when answered?</summary>
  <div class="faq-a">Telegram can fire the same callback twice on slow taps or network retries. The second <code>answerCbQuery</code> on an already-answered query throws. Wrap every call in <code>.catch(() => {})</code> to silently drop duplicates.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">How do I get a Claude Code session ID?</summary>
  <div class="faq-a">Run <code>/session</code> in the Claude Code chat window. The UUID is also the filename of the JSONL transcript under <code>~/.claude/projects/</code>.</div>
</details>
