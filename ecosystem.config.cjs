/**
 * PM2 Ecosystem Configuration for CallCast
 * Run with:  pm2 start ecosystem.config.cjs
 * Save:      pm2 save
 */
module.exports = {
  apps: [
    {
      name: 'callcast',
      script: './backend/src/app.js',

      // ── Always-On Settings ─────────────────────────────────────────────
      watch: false,               // Don't restart on file change (production)
      autorestart: true,          // Restart automatically on crash
      max_restarts: 20,           // Max restart attempts before giving up
      restart_delay: 3000,        // Wait 3s between restarts
      min_uptime: '5s',           // Consider startup successful after 5s

      // ── Environment ───────────────────────────────────────────────────
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
      },

      // ── Logging ───────────────────────────────────────────────────────
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/callcast-error.log',
      out_file: './logs/callcast-out.log',
      merge_logs: true,
    },
  ],
};
