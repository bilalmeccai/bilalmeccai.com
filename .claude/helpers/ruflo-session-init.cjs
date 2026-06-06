#!/usr/bin/env node
/**
 * Fires on SessionStart — spawns ruflo daemon, memory init, and swarm init
 * as detached background processes so the hook returns instantly.
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const commands = [
  'npx ruflo@latest daemon start',
  'npx ruflo@latest memory init',
  'npx ruflo@latest swarm init',
];

for (const cmd of commands) {
  try {
    const child = spawn('cmd', ['/c', cmd], {
      detached: true,
      stdio: 'ignore',
      cwd: projectDir,
      env: { ...process.env, npm_config_update_notifier: 'false' },
      windowsHide: true,
    });
    child.unref(); // don't wait — hook exits immediately
  } catch (_) {}
}

process.exit(0);
