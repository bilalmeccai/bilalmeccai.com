#!/bin/sh
set -e

REPO="${GITHUB_REPO:-bilalmeccai/bilalmeccai.com}"
REPO_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO}.git"

echo "[start] Cloning ${REPO}..."
rm -rf /workspace/project
git clone "$REPO_URL" /workspace/project

cd /workspace/project

# Authenticated remote so git push works without prompts
git remote set-url origin "$REPO_URL"

# Git identity for commits made by the bot
git config user.email "bilalmeccai@gmail.com"
git config user.name "bilalmeccai"

# Runtime dirs expected by the bot
mkdir -p .claude-flow/data .claude-flow/logs

echo "[start] Starting bot..."
cd /app
exec node bot.cjs
