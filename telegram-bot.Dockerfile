# syntax=docker/dockerfile:1
FROM node:20-slim

RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY telegram-bot/package*.json ./
RUN npm install --production

COPY telegram-bot/bot.cjs ./

# Embed startup script inline — no COPY needed, avoids build context issues
RUN <<'EOF' sh
cat > /app/start.sh << 'SCRIPT'
#!/bin/sh
set -e

# Debug: print which required env vars are present (names only, no values)
echo "[env] TELEGRAM_BOT_TOKEN    = $([ -n "$TELEGRAM_BOT_TOKEN" ] && echo SET || echo MISSING)"
echo "[env] TELEGRAM_ALLOWED_USER_IDS = $([ -n "$TELEGRAM_ALLOWED_USER_IDS" ] && echo SET || echo MISSING)"
echo "[env] ANTHROPIC_API_KEY     = $([ -n "$ANTHROPIC_API_KEY" ] && echo SET || echo MISSING)"
echo "[env] GITHUB_TOKEN          = $([ -n "$GITHUB_TOKEN" ] && echo SET || echo MISSING)"
echo "[env] GITHUB_REPO           = ${GITHUB_REPO:-bilalmeccai/bilalmeccai.com}"
echo "[env] RAILWAY_ENVIRONMENT   = ${RAILWAY_ENVIRONMENT:-not set}"

REPO="${GITHUB_REPO:-bilalmeccai/bilalmeccai.com}"
REPO_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO}.git"
echo "[start] Cloning ${REPO}..."
rm -rf /workspace/project
git clone "$REPO_URL" /workspace/project
cd /workspace/project
git remote set-url origin "$REPO_URL"
git config user.email "bilalmeccai@gmail.com"
git config user.name "bilalmeccai"
mkdir -p .claude-flow/data .claude-flow/logs
echo "[start] Starting bot..."
cd /app
exec node bot.cjs
SCRIPT
chmod +x /app/start.sh
EOF

ENV CLAUDE_PROJECT_DIR=/workspace/project

CMD ["/app/start.sh"]
