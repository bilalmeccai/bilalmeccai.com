FROM node:20-slim

# Install git (needed for bot's git operations)
RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI — uses ANTHROPIC_API_KEY at runtime, no interactive login needed
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY telegram-bot/package*.json ./
RUN npm install --production

COPY telegram-bot/bot.cjs telegram-bot/start.sh ./
RUN chmod +x start.sh

# Claude project dir — set to the cloned repo location in start.sh
ENV CLAUDE_PROJECT_DIR=/workspace/project

CMD ["./start.sh"]
