'use strict';

const dotenvResult = require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const DOTENV_KEYS = new Set(Object.keys(dotenvResult.parsed || {}));

const { Telegraf, Markup } = require('telegraf');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── Config ────────────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) { console.error('[Bot] TELEGRAM_BOT_TOKEN not set'); process.exit(1); }

const ALLOWED_IDS = (process.env.TELEGRAM_ALLOWED_USER_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean).map(Number);

const PROJECT_DIR  = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..');
const BLOG_DIR     = path.join(PROJECT_DIR, 'src', 'blog');
const MAX_LEN      = 3800;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || null;

function cliArgs(args) {
  return CLAUDE_MODEL ? ['--model', CLAUDE_MODEL, ...args] : args;
}

// ── Session store ─────────────────────────────────────────────────────────────

const SESSION_STORE  = path.join(PROJECT_DIR, '.claude-flow', 'data', 'telegram-sessions.json');
const SESSIONS_LOG   = path.join(PROJECT_DIR, '.claude', 'sessions.log');
const APPROVAL_STORE = path.join(PROJECT_DIR, '.claude-flow', 'data', 'telegram-approvals.json');

function loadStore(file) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) {}
  return {};
}
function saveStore(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (_) {}
}

function getSession(chatId)      { return loadStore(SESSION_STORE)[String(chatId)] || null; }
function setSession(chatId, sid) { const d = loadStore(SESSION_STORE); d[String(chatId)] = sid; saveStore(SESSION_STORE, d); }
function clearSession(chatId)    { const d = loadStore(SESSION_STORE); delete d[String(chatId)]; saveStore(SESSION_STORE, d); }

function sessionIdsInLog() {
  try {
    if (!fs.existsSync(SESSIONS_LOG)) return new Set();
    const c = fs.readFileSync(SESSIONS_LOG, 'utf8');
    return new Set([...c.matchAll(/Session ID\s*:\s*([a-f0-9-]{36})/gi)].map(m => m[1]));
  } catch (_) { return new Set(); }
}
function newSessionId(beforeIds) {
  const after = sessionIdsInLog();
  for (const id of [...after].reverse()) if (!beforeIds.has(id)) return id;
  return null;
}

// ── Branch / approval store ───────────────────────────────────────────────────

function saveApproval(branch, data) {
  const d = loadStore(APPROVAL_STORE);
  d[branch] = data;
  saveStore(APPROVAL_STORE, d);
}
function removeApproval(branch) {
  const d = loadStore(APPROVAL_STORE);
  delete d[branch];
  saveStore(APPROVAL_STORE, d);
}
function getApprovals() { return loadStore(APPROVAL_STORE); }

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
    .replace(/\s+/g, '-').slice(0, 35);
}
function branchName(label) {
  const ts = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').slice(2); // 2606061530
  return `feat/${slugify(label)}-${ts}`;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function splitText(text) {
  const parts = [];
  for (let i = 0; i < text.length; i += MAX_LEN) parts.push(text.slice(i, i + MAX_LEN));
  return parts.length ? parts : ['(empty)'];
}
async function sendLong(ctx, text, extra = {}) {
  for (const part of splitText(text)) await ctx.reply(part, extra).catch(() => ctx.reply(part));
}
async function editThenOverflow(ctx, msgId, text, extra = {}) {
  const [first, ...rest] = splitText(text);
  await ctx.telegram.editMessageText(ctx.chat.id, msgId, null, first, { parse_mode: 'Markdown', ...extra })
    .catch(() => ctx.reply(first, extra));
  for (const part of rest) await ctx.reply(part, { parse_mode: 'Markdown' }).catch(() => ctx.reply(part));
}
function runCmd(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    let out = '';
    const spawnEnv = { ...process.env, npm_config_update_notifier: 'false' };
    // On local Windows, strip a stale system-level ANTHROPIC_API_KEY so Claude
    // falls back to its stored OAuth credentials. Skip this on Railway/cloud —
    // the key there was set intentionally via env vars and must be kept.
    const onRailway = !!process.env.RAILWAY_ENVIRONMENT;
    if (cmd === 'claude' && !onRailway && !DOTENV_KEYS.has('ANTHROPIC_API_KEY')) {
      delete spawnEnv.ANTHROPIC_API_KEY;
    }
    const proc = spawn(cmd, args, {
      cwd: PROJECT_DIR,
      env: spawnEnv,
      windowsHide: true,
      timeout: opts.timeout || 120000,
    });
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { out += d; });
    proc.on('close', code => resolve({ ok: code === 0, out: out.trim() || '(no output)' }));
    proc.on('error', err  => resolve({ ok: false, out: err.message }));
  });
}
function keepTyping(ctx) {
  const id = setInterval(() => ctx.sendChatAction('typing').catch(() => {}), 4000);
  return () => clearInterval(id);
}

// ── Branch workflow helpers ───────────────────────────────────────────────────

// Ensure we're on main before starting new work
async function ensureMain() {
  await runCmd('git', ['checkout', 'main']);
}

// Create branch, run action fn, then commit + send approval gate
async function withBranch(ctx, label, actionFn) {
  const branch = branchName(label);
  const chatId = String(ctx.chat.id);

  await ensureMain();
  const { ok: branchOk, out: branchOut } = await runCmd('git', ['checkout', '-b', branch]);
  if (!branchOk) {
    await ensureMain();
    return { ok: false, out: `Failed to create branch: ${branchOut}` };
  }

  // Run the actual work (Claude, file writes, etc.)
  const result = await actionFn(branch);

  // Stage first, then check what's actually staged
  await runCmd('git', ['add', '-A']);
  // --quiet: exits 0 = nothing staged, exits 1 = something staged
  const { ok: nothingStaged } = await runCmd('git', ['diff', '--cached', '--quiet']);

  if (nothingStaged) {
    // Nothing staged — clean up branch
    await ensureMain();
    await runCmd('git', ['branch', '-D', branch]);
    return { ok: result.ok, out: result.out, branched: false };
  }

  // Commit on branch
  const { ok: commitOk, out: commitOut } = await runCmd('git', ['commit', '-m', `feat: ${label}`]);

  if (!commitOk) {
    await ensureMain();
    await runCmd('git', ['branch', '-D', branch]);
    return { ok: false, out: `Commit failed: ${commitOut}` };
  }

  // Get a concise diff summary
  const { out: statOut } = await runCmd('git', ['diff', 'main...HEAD', '--stat']);

  // Store pending approval
  saveApproval(branch, {
    chatId,
    label,
    createdAt: new Date().toISOString(),
    stat: statOut,
  });

  // Return to main so bot is never stuck on a feature branch
  await ensureMain();

  return { ok: true, out: result.out, branched: true, branch, stat: statOut };
}

// Approval inline keyboard
function approvalKeyboard(branch) {
  const b64 = Buffer.from(branch).toString('base64').slice(0, 60); // keep callback data short
  // Store full name in approvals, use index or short key in button
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Approve & Deploy', `approve:${branch}`),
      Markup.button.callback('📋 Diff', `diff:${branch}`),
    ],
    [Markup.button.callback('❌ Reject', `reject:${branch}`)],
  ]);
}

// ── Reply keyboard ────────────────────────────────────────────────────────────

const MAIN_KB = Markup.keyboard([
  ['📝 New Post',       '🐦 Tweet Draft'],
  ['📋 Blog Posts',     '✅ Pending Branches'],
  ['📊 Git Status',     '🔨 Build Site'],
  ['📂 Task List',      '🔄 Reset Session'],
  ['✍️ Summarize Session'],
]).resize();

// Pending state for buttons that need a follow-up input
const PENDING = new Map(); // chatId → 'newpost' | 'tweet' | 'draft' | 'task'

// ── Bot ───────────────────────────────────────────────────────────────────────

const bot = new Telegraf(BOT_TOKEN);

bot.use(async (ctx, next) => {
  if (ALLOWED_IDS.length > 0 && !ALLOWED_IDS.includes(ctx.from?.id)) return;
  return next();
});

// ── /start & /help ────────────────────────────────────────────────────────────

bot.command('start', async (ctx) => {
  await ctx.reply(
    `*bilalmeccai.com* — remote control\n\nUse the buttons below or just type a task. Everything runs on a branch — nothing ships without your approval.`,
    { parse_mode: 'Markdown', ...MAIN_KB }
  );
});

bot.command('help', (ctx) => ctx.reply(
  `*Commands*\n\n` +
  `*Site*\n` +
  `/posts · /newpost <title> · /todo\n` +
  `/branches — pending branch approvals\n` +
  `/deploy <msg> — stage + commit → approval\n` +
  `/status · /build\n\n` +
  `*Content*\n` +
  `/tweet <topic> · /draft <topic>\n` +
  `/summarize [id] — session → blog draft / X post / summary\n\n` +
  `*Session*\n` +
  `/session · /use <id> · /reset · /whoami`,
  { parse_mode: 'Markdown' }
));

// ── Branch approval callbacks ─────────────────────────────────────────────────

bot.action(/^approve:(.+)$/, async (ctx) => {
  const branch = ctx.match[1];
  await ctx.answerCbQuery('Merging to main…');

  const stop = keepTyping(ctx);

  // Merge into main
  await ensureMain();
  const { ok: mergeOk, out: mergeOut } = await runCmd('git', ['merge', branch, '--no-ff', '-m', `merge: ${branch}`]);
  if (!mergeOk) {
    stop();
    await ctx.editMessageText(`❌ Merge failed\n\`\`\`\n${mergeOut}\n\`\`\``, { parse_mode: 'Markdown' });
    return;
  }

  const { ok: pushOk, out: pushOut } = await runCmd('git', ['push', 'origin', 'main'], { timeout: 60000 });
  await runCmd('git', ['branch', '-d', branch]); // clean up local branch
  removeApproval(branch);
  stop();

  await ctx.editMessageText(
    pushOk
      ? `✅ *Merged & deployed*\nBranch \`${branch}\` → main\nVercel building — live in ~30s at bilalmeccai.com`
      : `⚠️ Merged locally but push failed\n\`\`\`\n${pushOut}\n\`\`\``,
    { parse_mode: 'Markdown' }
  );
});

bot.action(/^diff:(.+)$/, async (ctx) => {
  const branch = ctx.match[1];
  await ctx.answerCbQuery();
  const { out } = await runCmd('git', ['diff', `main...${branch}`, '--stat']);
  const { out: preview } = await runCmd('git', ['diff', `main...${branch}`, '--', '*.md', '*.njk', '*.css', '*.js']);
  const text = `*Diff: \`${branch}\`*\n\`\`\`\n${out}\n\`\`\`\n\`\`\`diff\n${preview.slice(0, 2000)}\n\`\`\``;
  await sendLong(ctx, text, { parse_mode: 'Markdown' });
});

bot.action(/^reject:(.+)$/, async (ctx) => {
  const branch = ctx.match[1];
  await ctx.answerCbQuery('Rejected');
  await ensureMain();
  await runCmd('git', ['branch', '-D', branch]);
  removeApproval(branch);
  await ctx.editMessageText(`❌ Branch \`${branch}\` deleted.`, { parse_mode: 'Markdown' });
});

// ── Site commands ─────────────────────────────────────────────────────────────

bot.command('branches', async (ctx) => {
  const pending = getApprovals();
  const keys = Object.keys(pending);
  if (!keys.length) return ctx.reply('No branches pending approval.');

  const lines = keys.map(b => {
    const { label, createdAt } = pending[b];
    const age = Math.round((Date.now() - new Date(createdAt)) / 60000);
    return `• \`${b}\`\n  "${label}" — ${age}m ago`;
  });

  await sendLong(ctx,
    `*Pending Approvals (${keys.length})*\n\n${lines.join('\n\n')}\n\nUse the approval buttons above, or:\n/approve \`<branch>\` · /reject \`<branch>\``,
    { parse_mode: 'Markdown' }
  );
});

bot.command('approve', async (ctx) => {
  const branch = ctx.message.text.trim().split(/\s+/)[1];
  if (!branch) return ctx.reply('Usage: `/approve <branch>`', { parse_mode: 'Markdown' });
  await ensureMain();
  const { ok, out } = await runCmd('git', ['merge', branch, '--no-ff', '-m', `merge: ${branch}`]);
  if (!ok) return ctx.reply(`❌ Merge failed\n\`\`\`\n${out}\n\`\`\``, { parse_mode: 'Markdown' });
  const { ok: pushOk, out: pushOut } = await runCmd('git', ['push', 'origin', 'main'], { timeout: 60000 });
  await runCmd('git', ['branch', '-d', branch]);
  removeApproval(branch);
  await ctx.reply(
    pushOk
      ? `✅ Merged \`${branch}\` → main. Vercel deploying…`
      : `⚠️ Merged locally but push failed:\n\`\`\`\n${pushOut}\n\`\`\``,
    { parse_mode: 'Markdown' }
  );
});

bot.command('reject', async (ctx) => {
  const branch = ctx.message.text.trim().split(/\s+/)[1];
  if (!branch) return ctx.reply('Usage: `/reject <branch>`', { parse_mode: 'Markdown' });
  await ensureMain();
  await runCmd('git', ['branch', '-D', branch]);
  removeApproval(branch);
  await ctx.reply(`❌ Branch \`${branch}\` deleted.`, { parse_mode: 'Markdown' });
});

bot.command('posts', async (ctx) => {
  try {
    const files = fs.readdirSync(BLOG_DIR).filter(f => f.endsWith('.md'));
    if (!files.length) return ctx.reply('No posts yet. Use `/newpost <title>`.');
    const lines = files.map(f => {
      const c = fs.readFileSync(path.join(BLOG_DIR, f), 'utf8');
      const title = (c.match(/^title:\s*["']?(.+?)["']?\s*$/m) || [])[1] || f.replace('.md', '');
      const date  = (c.match(/^date:\s*(.+?)\s*$/m) || [])[1] || '—';
      return `• ${date} — ${title}\n  \`/blog/${f.replace('.md', '')}/\``;
    });
    await sendLong(ctx, `*Blog Posts (${files.length})*\n\n${lines.join('\n\n')}`, { parse_mode: 'Markdown' });
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

bot.command('newpost', async (ctx) => {
  const title = ctx.message.text.replace('/newpost', '').trim();
  if (!title) return ctx.reply('Usage: `/newpost Your Post Title`', { parse_mode: 'Markdown' });

  await ctx.sendChatAction('typing');
  const placeholder = await ctx.reply(`✍️ Creating branch + writing "${title}"…`);
  const stop = keepTyping(ctx);

  const prompt =
    `Create a new blog post file in src/blog/ titled: "${title}". ` +
    `Follow the frontmatter spec in .claude/CLAUDE.md exactly. Use today's date 2026-06-06. ` +
    `Write a complete, publish-ready post in Bilal's voice — direct, sharp, no fluff. ` +
    `Include TL;DR, at least one table or code block, and a FAQ section at the bottom.`;

  const { ok, out, branched, branch, stat } = await withBranch(ctx, title, async () => {
    const existing = getSession(ctx.chat.id);
    const beforeIds = sessionIdsInLog();
    const args = cliArgs(existing ? ['--resume', existing, '-p', prompt] : ['-p', prompt]);
    const result = await runCmd('claude', args, { timeout: 300000 });
    if (!existing) {
      await new Promise(r => setTimeout(r, 800));
      const sid = newSessionId(beforeIds);
      if (sid) setSession(ctx.chat.id, sid);
    }
    return result;
  });

  stop();

  if (!branched) {
    return editThenOverflow(ctx, placeholder.message_id, ok ? out : `❌ Error\n\`\`\`\n${out}\n\`\`\``);
  }

  await editThenOverflow(ctx, placeholder.message_id,
    `✅ *Post written on \`${branch}\`*\n\n${out.slice(0, 1500)}`
  );
  await ctx.reply(
    `📋 *Changes*\n\`\`\`\n${stat}\n\`\`\`\n\nApprove to merge → main → Vercel deploys.`,
    { parse_mode: 'Markdown', ...approvalKeyboard(branch) }
  );
});

bot.command('todo', async (ctx) => {
  try {
    const c = fs.readFileSync(path.join(PROJECT_DIR, '.claude', 'CLAUDE.md'), 'utf8');
    const m = c.match(/## 14\. IMMEDIATE TODO LIST([\s\S]*?)(?=\n---|\n## \d)/);
    if (!m) return ctx.reply('Could not parse TODO section from CLAUDE.md.');
    await sendLong(ctx, `*TODO — bilalmeccai.com*\n${m[1].trim()}`, { parse_mode: 'Markdown' });
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

bot.command('deploy', async (ctx) => {
  const msg = ctx.message.text.replace('/deploy', '').trim() || 'chore: update site';

  await ctx.sendChatAction('typing');
  const placeholder = await ctx.reply('📦 Staging changes…');
  const stop = keepTyping(ctx);

  // Check if there are any changes to commit
  const { out: statusOut } = await runCmd('git', ['status', '--short']);
  if (!statusOut.trim()) {
    stop();
    return editThenOverflow(ctx, placeholder.message_id, 'Nothing to deploy — working tree is clean.');
  }

  const branch = branchName(msg);
  await ensureMain();
  await runCmd('git', ['checkout', '-b', branch]);
  await runCmd('git', ['add', '-A']);
  const { ok: commitOk, out: commitOut } = await runCmd('git', ['commit', '-m', msg]);

  if (!commitOk) {
    await ensureMain();
    await runCmd('git', ['branch', '-D', branch]);
    stop();
    return editThenOverflow(ctx, placeholder.message_id, `❌ Commit failed\n\`\`\`\n${commitOut}\n\`\`\``);
  }

  const { out: statOut } = await runCmd('git', ['diff', 'main...HEAD', '--stat']);
  saveApproval(branch, { chatId: String(ctx.chat.id), label: msg, createdAt: new Date().toISOString(), stat: statOut });
  await ensureMain();
  stop();

  await editThenOverflow(ctx, placeholder.message_id,
    `📦 *Ready on \`${branch}\`*\n\n\`\`\`\n${statOut}\n\`\`\`\n\nApprove to merge → main → Vercel deploys.`,
  );
  await ctx.reply(
    `Approve or reject:`,
    approvalKeyboard(branch)
  );
});

bot.command('status', async (ctx) => {
  await ctx.sendChatAction('typing');
  const [st, log, br] = await Promise.all([
    runCmd('git', ['status', '--short']),
    runCmd('git', ['log', '--oneline', '-5']),
    runCmd('git', ['branch', '--list']),
  ]);
  await sendLong(ctx,
    `*Git Status*\n\`\`\`\n${st.out || 'clean'}\n\`\`\`\n\n*Branches*\n\`\`\`\n${br.out}\n\`\`\`\n\n*Recent Commits*\n\`\`\`\n${log.out}\n\`\`\``,
    { parse_mode: 'Markdown' }
  );
});

bot.command('build', async (ctx) => {
  await ctx.sendChatAction('typing');
  const placeholder = await ctx.reply('🔨 Building…');
  const stop = keepTyping(ctx);
  const { ok, out } = await runCmd('npm', ['run', 'build'], { timeout: 90000 });
  stop();
  await editThenOverflow(ctx, placeholder.message_id,
    `*Build ${ok ? '✅ Passed' : '❌ Failed'}*\n\`\`\`\n${out.slice(-2500)}\n\`\`\``
  );
});

// ── Summarize / content extraction ───────────────────────────────────────────

// Parse all sessions from sessions.log → [{ date, id }] newest first
function parseSessions() {
  try {
    if (!fs.existsSync(SESSIONS_LOG)) return [];
    const content = fs.readFileSync(SESSIONS_LOG, 'utf8');
    const results = [];
    let current = {};
    for (const line of content.split('\n')) {
      const dateM = line.match(/^\[(.+?)\]/);
      if (dateM) { current = { date: dateM[1] }; continue; }
      const idM = line.match(/Session ID\s*:\s*([a-f0-9-]{36})/i);
      if (idM && current.date) { current.id = idM[1]; results.push({ ...current }); current = {}; }
    }
    return results.reverse();
  } catch (_) { return []; }
}

// Search for a transcript JSONL across all Claude Code projects in USERPROFILE
function findTranscriptAnywhere(sessionId) {
  try {
    const base = path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'projects');
    if (!fs.existsSync(base)) return null;
    for (const proj of fs.readdirSync(base)) {
      const candidate = path.join(base, proj, `${sessionId}.jsonl`);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch (_) {}
  return null;
}

// Read the transcript path for a session — checks sessions.log first, then searches globally
function getTranscriptPath(sessionId) {
  try {
    if (fs.existsSync(SESSIONS_LOG)) {
      const content = fs.readFileSync(SESSIONS_LOG, 'utf8');
      for (const block of content.split(/\n(?=\[)/)) {
        if (block.includes(sessionId)) {
          const m = block.match(/Transcript\s*:\s*(.+)/);
          if (m) return m[1].trim();
        }
      }
    }
  } catch (_) {}
  return findTranscriptAnywhere(sessionId);
}

// Pull the last N human/assistant turns from a JSONL transcript, as plain text
function readTranscriptExcerpt(transcriptPath, lastTurns = 40) {
  try {
    const lines = fs.readFileSync(transcriptPath, 'utf8')
      .split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);

    const turns = [];
    for (const entry of lines) {
      // Claude Code JSONL: each entry has role + content
      const role    = entry.type || entry.role || '';
      const content = entry.message?.content || entry.content || '';
      if (!role || !['user', 'assistant', 'human'].includes(role.toLowerCase())) continue;

      let text = '';
      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        text = content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      }
      if (text.trim()) turns.push({ role: role.toLowerCase() === 'user' || role === 'human' ? 'Human' : 'Claude', text: text.slice(0, 800) });
    }

    return turns.slice(-lastTurns)
      .map(t => `**${t.role}:** ${t.text}`)
      .join('\n\n---\n\n');
  } catch (e) {
    return null;
  }
}

// Shared summarise runner — called from command and from callback buttons
async function runSummarize(ctx, sessionId, format) {
  const transcriptPath = getTranscriptPath(sessionId);
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    await ctx.reply(`No transcript found for session \`${sessionId}\`.\nTranscripts are written when the SessionStart hook fires.`, { parse_mode: 'Markdown' });
    return;
  }

  const excerpt = readTranscriptExcerpt(transcriptPath, 40);
  if (!excerpt) {
    await ctx.reply('Could not parse transcript — may still be in progress or format changed.');
    return;
  }

  const formatInstructions = {
    blog: `Write a complete, publish-ready blog post for bilalmeccai.com based on the work in this conversation. ` +
          `Follow the frontmatter spec in .claude/CLAUDE.md. Use Bilal's voice: direct, sharp, no fluff, explains tech in plain language. ` +
          `Show the thinking process and the "aha" moment. Include TL;DR, code examples, and FAQ section. ` +
          `Do NOT include any credentials, API keys, passwords, internal IP addresses, or confidential company names. ` +
          `Generalise any employer/client-specific details (e.g. "a US-based fintech platform" not "Markaaz").`,

    tweet: `Draft 3 X (Twitter) post options from the key insight in this conversation. ` +
           `Format each: observation → insight → implication. Max 280 chars each. Direct, no fluff. ` +
           `Strip all sensitive info. Focus on the engineering insight, not the company context.`,

    brief: `Write a concise 2-3 paragraph plain-English summary of what was built or solved in this conversation. ` +
           `Target audience: another senior engineer. Strip credentials, sensitive paths, company-specific names. ` +
           `Focus on: what the problem was, what approach was taken, what was the outcome.`,
  };

  const prompt =
    `You are summarising a Claude Code conversation for content creation. ` +
    `${formatInstructions[format]}\n\n` +
    `CONVERSATION TRANSCRIPT (last 40 turns):\n\n${excerpt}`;

  const placeholder = await ctx.reply(`⏳ Generating ${format === 'blog' ? 'blog draft' : format === 'tweet' ? 'X posts' : 'summary'}…`);
  const stop = keepTyping(ctx);

  const result = await runCmd('claude', cliArgs(['-p', prompt]), { timeout: 300000 });
  stop();

  await editThenOverflow(ctx, placeholder.message_id,
    result.ok ? result.out : `❌ Error\n\`\`\`\n${result.out}\n\`\`\``
  );
}

// /summarize [session_id] — pick the format via inline buttons
bot.command('summarize', async (ctx) => {
  const parts = ctx.message.text.trim().split(/\s+/);
  const uuidRe = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

  let sessionId = uuidRe.test(parts[1]) ? parts[1] : getSession(ctx.chat.id);

  if (!sessionId) {
    return ctx.reply(
      'No active session.\n\nUsage: `/summarize` (uses current session) or `/summarize <session_id>`\n\nGet IDs from `/log`.',
      { parse_mode: 'Markdown' }
    );
  }

  await ctx.reply(
    `*Summarise session*\n\`${sessionId}\`\n\nWhat do you want to generate?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📝 Blog Post Draft', `sum_blog:${sessionId}`)],
        [Markup.button.callback('🐦 X / Twitter Post', `sum_tweet:${sessionId}`)],
        [Markup.button.callback('📋 Brief Summary', `sum_brief:${sessionId}`)],
      ]),
    }
  );
});

// "Other session" → prompt for UUID (searches all Claude projects)
bot.action('sum_manual', async (ctx) => {
  await ctx.answerCbQuery();
  PENDING.set(ctx.chat.id, 'summarize');
  await ctx.reply('Paste the session UUID — I\'ll search across all your Claude Code projects:', Markup.forceReply().selective());
});

// Session picker → show format buttons
bot.action(/^sum_pick:(.+)$/, async (ctx) => {
  const sid = ctx.match[1];
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `*Summarise session*\n\`${sid}\`\n\nWhat do you want to generate?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📝 Blog Post Draft',   `sum_blog:${sid}`)],
        [Markup.button.callback('🐦 X / Twitter Post', `sum_tweet:${sid}`)],
        [Markup.button.callback('📋 Brief Summary',    `sum_brief:${sid}`)],
      ]),
    }
  );
});

bot.action(/^sum_(blog|tweet|brief):(.+)$/, async (ctx) => {
  const format    = ctx.match[1];          // blog | tweet | brief
  const sessionId = ctx.match[2];
  await ctx.answerCbQuery(`Generating ${format}…`);
  await ctx.editMessageText(
    `*Summarising as ${format}…*\n\`${sessionId}\``,
    { parse_mode: 'Markdown' }
  );
  await runSummarize(ctx, sessionId, format);
});

// ── Content commands ──────────────────────────────────────────────────────────

bot.command('tweet', async (ctx) => {
  const topic = ctx.message.text.replace('/tweet', '').trim();
  if (!topic) return ctx.reply('Usage: `/tweet <topic>`', { parse_mode: 'Markdown' });
  await ctx.sendChatAction('typing');
  const placeholder = await ctx.reply('✍️ Drafting…');
  const stop = keepTyping(ctx);
  const prompt = `Draft an X (Twitter) post for Bilal Meccai about: "${topic}". Format: observation → insight → implication. Voice: direct, sharp, no fluff, no humble bragging. Max 280 chars. No hashtags unless they add clear value.`;
  const existing = getSession(ctx.chat.id);
  const beforeIds = sessionIdsInLog();
  const result = await runCmd('claude', cliArgs(existing ? ['--resume', existing, '-p', prompt] : ['-p', prompt]), { timeout: 120000 });
  if (!existing) { await new Promise(r => setTimeout(r, 800)); const sid = newSessionId(beforeIds); if (sid) setSession(ctx.chat.id, sid); }
  stop();
  await editThenOverflow(ctx, placeholder.message_id,
    result.ok ? `*X Post Draft*\n\n${result.out}` : `❌ Error\n\`\`\`\n${result.out}\n\`\`\``
  );
});

bot.command('draft', async (ctx) => {
  const topic = ctx.message.text.replace('/draft', '').trim();
  if (!topic) return ctx.reply('Usage: `/draft <topic>`', { parse_mode: 'Markdown' });
  await ctx.sendChatAction('typing');
  const placeholder = await ctx.reply('📝 Outlining…');
  const stop = keepTyping(ctx);
  const prompt = `Create a detailed blog post outline for bilalmeccai.com on: "${topic}". Follow the frontmatter spec in .claude/CLAUDE.md. Include: title, subtitle, tldr, section headings, key points, FAQ questions, and suggested code examples or tables. Brand voice: direct, plain language, shows thinking.`;
  const existing = getSession(ctx.chat.id);
  const beforeIds = sessionIdsInLog();
  const result = await runCmd('claude', cliArgs(existing ? ['--resume', existing, '-p', prompt] : ['-p', prompt]), { timeout: 180000 });
  if (!existing) { await new Promise(r => setTimeout(r, 800)); const sid = newSessionId(beforeIds); if (sid) setSession(ctx.chat.id, sid); }
  stop();
  await editThenOverflow(ctx, placeholder.message_id,
    result.ok ? result.out : `❌ Error\n\`\`\`\n${result.out}\n\`\`\``
  );
});

// ── Session commands ──────────────────────────────────────────────────────────

bot.command('whoami', (ctx) =>
  ctx.reply(`Your Telegram user ID: \`${ctx.from?.id}\``, { parse_mode: 'Markdown' })
);
bot.command('session', async (ctx) => {
  const sid = getSession(ctx.chat.id);
  if (!sid) return ctx.reply('No active session. Send a message to start one.');
  await ctx.reply(`*Active Session*\n\`${sid}\`\n\nResume manually:\n\`claude --resume ${sid}\``, { parse_mode: 'Markdown' });
});
bot.command('reset', async (ctx) => {
  const prev = getSession(ctx.chat.id);
  clearSession(ctx.chat.id);
  await ctx.reply(prev ? `Session cleared.\nPrevious: \`${prev}\`\n\nNext message starts fresh.` : 'Already fresh.', { parse_mode: 'Markdown' });
});
bot.command('use', async (ctx) => {
  const sid = ctx.message.text.trim().split(/\s+/)[1];
  const uuidRe = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (!sid || !uuidRe.test(sid)) return ctx.reply('Usage: `/use <session-uuid>`', { parse_mode: 'Markdown' });
  setSession(ctx.chat.id, sid);
  await ctx.reply(`Pinned session:\n\`${sid}\``, { parse_mode: 'Markdown' });
});
bot.command('log', async (ctx) => {
  if (!fs.existsSync(SESSIONS_LOG)) return ctx.reply('No sessions logged yet.');
  const content = fs.readFileSync(SESSIONS_LOG, 'utf8').trim();
  await sendLong(ctx, `*Session Log*\n\`\`\`\n${content.slice(-3000)}\n\`\`\``, { parse_mode: 'Markdown' });
});

// ── Main handler — Claude task on a branch ────────────────────────────────────

bot.on('text', async (ctx) => {
  const text   = ctx.message.text.trim();
  const chatId = ctx.chat.id;
  if (text.startsWith('/')) return;

  // ── Keyboard button routing ──────────────────────────────────────────────
  const pending = PENDING.get(chatId);

  if (pending) {
    PENDING.delete(chatId);
    if (pending === 'newpost') {
      return bot.handleUpdate({ ...ctx.update, message: { ...ctx.message, text: `/newpost ${text}` } });
    }
    if (pending === 'tweet') {
      return bot.handleUpdate({ ...ctx.update, message: { ...ctx.message, text: `/tweet ${text}` } });
    }
    if (pending === 'draft') {
      return bot.handleUpdate({ ...ctx.update, message: { ...ctx.message, text: `/draft ${text}` } });
    }
    if (pending === 'summarize') {
      const uuidRe = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
      const sid = text.toLowerCase() === 'current' ? getSession(chatId) : uuidRe.test(text) ? text : null;
      if (!sid) return ctx.reply('Not a valid session ID. Send a UUID or type `current`.', { parse_mode: 'Markdown' });
      return ctx.reply(
        `*Summarise session*\n\`${sid}\`\n\nWhat do you want to generate?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📝 Blog Post Draft',    `sum_blog:${sid}`)],
            [Markup.button.callback('🐦 X / Twitter Post',  `sum_tweet:${sid}`)],
            [Markup.button.callback('📋 Brief Summary',     `sum_brief:${sid}`)],
          ]),
        }
      );
    }
  }

  // Button taps that need follow-up input
  if (text === '📝 New Post') {
    PENDING.set(chatId, 'newpost');
    return ctx.reply('Post title?', Markup.forceReply().selective());
  }
  if (text === '🐦 Tweet Draft') {
    PENDING.set(chatId, 'tweet');
    return ctx.reply('Tweet topic?', Markup.forceReply().selective());
  }

  // Button taps that run directly
  if (text === '📋 Blog Posts')      return bot.handleUpdate({ ...ctx.update, message: { ...ctx.message, text: '/posts' } });
  if (text === '✅ Pending Branches') return bot.handleUpdate({ ...ctx.update, message: { ...ctx.message, text: '/branches' } });
  if (text === '📊 Git Status')      return bot.handleUpdate({ ...ctx.update, message: { ...ctx.message, text: '/status' } });
  if (text === '🔨 Build Site')      return bot.handleUpdate({ ...ctx.update, message: { ...ctx.message, text: '/build' } });
  if (text === '📂 Task List')       return bot.handleUpdate({ ...ctx.update, message: { ...ctx.message, text: '/todo' } });
  if (text === '🔄 Reset Session')   return bot.handleUpdate({ ...ctx.update, message: { ...ctx.message, text: '/reset' } });
  if (text === '✍️ Summarize Session') {
    const sessions = parseSessions();
    if (!sessions.length) {
      PENDING.set(chatId, 'summarize');
      return ctx.reply('No sessions logged yet. Paste a session UUID:', Markup.forceReply().selective());
    }
    const current = getSession(chatId);
    const buttons = sessions.map(s => {
      const label = `${s.date}  ${s.id.slice(0, 8)}…${s.id.slice(-4)}${s.id === current ? ' ◀ active' : ''}`;
      return [Markup.button.callback(label, `sum_pick:${s.id}`)];
    });
    buttons.push([Markup.button.callback('🔍 Other session (paste UUID)…', 'sum_manual')]);
    return ctx.reply('*Choose a session to summarise:*', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  }
  // ────────────────────────────────────────────────────────────────────────

  const existing = getSession(chatId);

  await ctx.sendChatAction('typing');
  const placeholder = await ctx.reply('⏳ Working on branch…');
  const stop = keepTyping(ctx);

  const { ok, out, branched, branch, stat } = await withBranch(ctx, text.slice(0, 50), async () => {
    let result;
    if (existing) {
      result = await runCmd('claude', cliArgs(['--resume', existing, '-p', text]), { timeout: 300000 });
      if (!result.ok && result.out.toLowerCase().includes('not found')) {
        clearSession(chatId);
        const beforeIds = sessionIdsInLog();
        result = await runCmd('claude', cliArgs(['-p', text]), { timeout: 300000 });
        await new Promise(r => setTimeout(r, 800));
        const sid = newSessionId(beforeIds);
        if (sid) {
          setSession(chatId, sid);
          await ctx.reply(`⚠️ *Session expired*\nNew: \`${sid}\``, { parse_mode: 'Markdown' });
        }
      }
    } else {
      const beforeIds = sessionIdsInLog();
      result = await runCmd('claude', cliArgs(['-p', text]), { timeout: 300000 });
      await new Promise(r => setTimeout(r, 800));
      const sid = newSessionId(beforeIds);
      if (sid) {
        setSession(chatId, sid);
        await ctx.reply(`📌 *Session started*\n\`${sid}\``, { parse_mode: 'Markdown' });
      }
    }
    return result;
  });

  stop();

  const reply = ok ? (out || '(no output)') : `❌ Error\n\`\`\`\n${out}\n\`\`\``;
  await editThenOverflow(ctx, placeholder.message_id, reply);

  if (branched) {
    await ctx.reply(
      `📋 *Changes on \`${branch}\`*\n\`\`\`\n${stat}\n\`\`\`\n\nApprove to merge → main → Vercel deploys.`,
      { parse_mode: 'Markdown', ...approvalKeyboard(branch) }
    );
  }
});

// ── Error handler ─────────────────────────────────────────────────────────────

bot.catch((err, ctx) => {
  console.error(`[Bot Error] ${err.message}`);
  ctx.reply('❌ Internal error — check server logs.').catch(() => {});
});

// ── Start ─────────────────────────────────────────────────────────────────────

bot.launch({ dropPendingUpdates: true });

console.log('[Bot] bilalmeccai.com remote control started');
console.log(`[Bot] Project: ${PROJECT_DIR}`);
console.log(`[Bot] Allowed IDs: ${ALLOWED_IDS.join(', ') || '⚠️  NONE SET — open to all!'}`);

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
