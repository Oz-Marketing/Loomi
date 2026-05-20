module.exports = {
  apps: [
    {
      name: 'loomi-studio',
      script: 'npm',
      args: 'start',
      cwd: '/var/www/loomi-studio',
      max_memory_restart: '512M',
      kill_timeout: 5000,
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        NODE_OPTIONS: '--max-old-space-size=768',
        PORT: 3000,
      },
    },
    {
      // Loomi-native send engine worker. Runs pg-boss and fires recurring
      // jobs that move scheduled email/SMS campaigns through their pipeline.
      // Singleton — not blue/green. A brief restart on deploy is fine: jobs
      // persist in Postgres via pg-boss and resume on next boot.
      name: 'loomi-studio-worker',
      script: 'npm',
      args: 'run worker:start',
      cwd: '/var/www/loomi-studio',
      max_memory_restart: '256M',
      kill_timeout: 10000,
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        NODE_OPTIONS: '--max-old-space-size=384',
      },
    },
  ],
};
