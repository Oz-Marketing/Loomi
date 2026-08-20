module.exports = {
  apps: [
    {
      name: 'loomi-studio',
      script: 'npm',
      args: 'start',
      cwd: '/var/www/loomi-studio',
      // ── Memory: the heap ceiling must stay BELOW the restart threshold ──
      //
      // These two used to disagree: pm2 killed the process at 512MB RSS while
      // V8 was told it had a 768MB heap. V8 sizes its GC pressure to the limit
      // it's given, so it stayed relaxed on the way to a budget it would never
      // be allowed to reach — and pm2 killed the process instead of V8 ever
      // collecting hard. Every in-flight request on the single production
      // process died together, which is what a burst of same-second 502s is.
      //
      // Now the heap ceiling sits under the restart threshold, leaving the
      // remainder for non-heap RSS (Prisma engine, sharp, socket buffers). V8
      // does the collecting; pm2's killer goes back to being a backstop.
      //
      // DO NOT raise these to "give the app more room" without first moving
      // the build off the box: the droplet is 2GB/1vCPU and `npm run build`
      // (webpack) still runs ON it during every deploy — see the "Move the
      // production build off the droplet" item in docs/ROADMAP.md. Extra
      // resident memory here comes straight out of the build's headroom and
      // pushes a 7-8 minute deploy into swap.
      max_memory_restart: '512M',
      kill_timeout: 5000,
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        NODE_OPTIONS: '--max-old-space-size=384',
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
      // Point at the symlink so the worker tracks whichever release is
      // currently active. The deploy workflow delete + re-starts the
      // worker AFTER swapping `current` so pm2 re-resolves the symlink
      // and binds to the new release's realpath.
      cwd: '/var/www/loomi-studio/current',
      // Same inversion as the app above — 256M restart threshold against a
      // 384M heap ceiling meant pm2 always won the race. Heap now sits under
      // the threshold so the worker GCs instead of being killed mid-job.
      max_memory_restart: '256M',
      kill_timeout: 10000,
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        NODE_OPTIONS: '--max-old-space-size=192',
      },
    },
  ],
};
