module.exports = {
  apps: [
    {
      name: 'bilal-telegram-bot',
      script: './bot.cjs',
      cwd: __dirname,
      env_file: './.env',
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      log_file: '../.claude-flow/logs/telegram-bot.log',
      error_file: '../.claude-flow/logs/telegram-bot-error.log',
      time: true,
    },
  ],
};
