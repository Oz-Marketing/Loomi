const os = require('os');

/**
 * ── Memory budget follows the machine ──
 *
 * These limits used to be one hardcoded pair for every environment, sized for a
 * 2GB/1vCPU droplet. Production has since been resized to 8GB/4vCPU while
 * STAGING is still 2GB/1vCPU — and both read this same file, so a single number
 * is now either far too small for one or dangerous for the other. It was too
 * small: the app idles at ~409MB against a 512MB restart threshold, so any
 * request with a real working set (the ad-generator ZIP export at 22 retina
 * sizes is the one that found this) crossed the line and pm2 killed the process
 * mid-request. nginx reports that as "upstream prematurely closed connection"
 * and the browser gets a bare 502.
 *
 * So the budget is derived from the box's own RAM. Small hosts keep exactly the
 * conservative pair they had; a resized host gets headroom without anyone having
 * to remember to edit this file. The heap ceiling ALWAYS stays below the restart
 * threshold, which is the invariant that matters — see the note below.
 */
const TOTAL_MB = Math.round(os.totalmem() / 1024 / 1024);
/** Roomy enough that the app's working set isn't the binding constraint. */
const LARGE_HOST = TOTAL_MB >= 4096;
const APP_MEMORY = LARGE_HOST ? { restart: '1536M', heap: 1024 } : { restart: '512M', heap: 384 };
const WORKER_MEMORY = LARGE_HOST ? { restart: '768M', heap: 512 } : { restart: '256M', heap: 192 };

module.exports = {
  apps: [
    {
      name: 'loomi-studio',
      script: 'npm',
      args: 'start',
      cwd: '/var/www/loomi-studio',
      // ── Memory: the heap ceiling must stay BELOW the restart threshold ──
      //
      // Values come from APP_MEMORY above, which scales with the host's RAM.
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
      // DO NOT hand a SMALL host more room without first moving the build off
      // the box: `npm run build` (webpack) still runs ON it during every deploy
      // — see the "Move the production build off the droplet" item in
      // docs/ROADMAP.md. On a 2GB droplet extra resident memory here comes
      // straight out of the build's headroom and pushes a 7-8 minute deploy into
      // swap, which is why the small-host pair is left exactly as it was.
      max_memory_restart: APP_MEMORY.restart,
      kill_timeout: 5000,
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        NODE_OPTIONS: `--max-old-space-size=${APP_MEMORY.heap}`,
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
      max_memory_restart: WORKER_MEMORY.restart,
      kill_timeout: 10000,
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        NODE_OPTIONS: `--max-old-space-size=${WORKER_MEMORY.heap}`,
      },
    },
  ],
};
