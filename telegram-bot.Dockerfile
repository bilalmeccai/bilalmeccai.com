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
