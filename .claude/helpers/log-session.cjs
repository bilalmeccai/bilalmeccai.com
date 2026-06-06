#!/usr/bin/env node
/**
 * Session ID logger — appends each new Claude Code session to .claude/sessions.log
 * so you can jump back to previous work via: claude --resume <session_id>
 *
 * Fires on SessionStart. Input: JSON via stdin.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(
  process.env.CLAUDE_PROJECT_DIR || path.join(__dirname, '..', '..'),
  '.claude',
  'sessions.log'
);

async function readStdin() {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve) => {
    let data = '';
    const t = setTimeout(() => { process.stdin.removeAllListeners(); resolve(data); }, 500);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => { clearTimeout(t); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(t); resolve(data); });
    process.stdin.resume();
  });
}

(async () => {
  const safety = setTimeout(() => process.exit(0), 3000);
  safety.unref();

  let input = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) input = JSON.parse(raw);
  } catch (_) {}

  const sessionId = input.session_id || input.sessionId || '';
  const transcriptPath = input.transcript_path || input.transcriptPath || '';
  if (!sessionId) process.exit(0);

  // Avoid duplicate entries for the same session
  if (fs.existsSync(LOG_FILE)) {
    const existing = fs.readFileSync(LOG_FILE, 'utf8');
    if (existing.includes(sessionId)) process.exit(0);
  }

  const ts = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });

  const entry = [
    `[${ts} IST]`,
    `  Session ID : ${sessionId}`,
    transcriptPath ? `  Transcript : ${transcriptPath}` : '',
    `  Resume     : claude --resume ${sessionId}`,
    '',
  ].filter(l => l !== '').join('\n') + '\n';

  try {
    fs.appendFileSync(LOG_FILE, entry, 'utf8');
  } catch (_) {}

  clearTimeout(safety);
  process.exit(0);
})();
