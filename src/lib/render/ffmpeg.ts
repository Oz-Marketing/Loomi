import { spawn } from 'child_process';
import { access, constants } from 'fs/promises';

/**
 * ffmpeg — resolving the binary, and running it.
 *
 * Mirrors `chromium.ts`: the renderer shouldn't care where the tool came from.
 * Resolution order, most explicit first:
 *
 *   1. `FFMPEG_PATH`      — an operator's decision always wins.
 *   2. `ffmpeg-static`    — the npm-bundled binary, so a dev machine and CI work
 *                           with no setup.
 *   3. `ffmpeg` on PATH   — a droplet with the system package installed, which is
 *                           the cheaper choice there: apt's build is hardware-
 *                           accelerated where the box supports it, and it doesn't
 *                           put an 80MB binary through every deploy's npm ci.
 *
 * Availability is a first-class answer rather than an exception, because the UI
 * has to be able to say "video export isn't configured on this server" instead of
 * failing a user's export with a stack trace.
 */

/** Cached across calls — resolution touches the filesystem, and an export renders
 *  several sizes in one request. */
let cached: { path: string | null } | null = null;

async function isExecutable(p: string): Promise<boolean> {
  try {
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Does a bare `ffmpeg` on PATH answer? */
function pathHasFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
}

/** The ffmpeg binary to use, or null when this server has none. */
export async function resolveFfmpeg(): Promise<string | null> {
  if (cached) return cached.path;

  const explicit = process.env.FFMPEG_PATH?.trim();
  if (explicit && (await isExecutable(explicit))) {
    cached = { path: explicit };
    return explicit;
  }

  try {
    // Optional dependency: a deployment that installs ffmpeg via apt instead
    // shouldn't fail to boot because this package isn't there.
    const mod = (await import('ffmpeg-static')) as unknown as { default?: string | null };
    const bundled = typeof mod.default === 'string' ? mod.default : null;
    if (bundled && (await isExecutable(bundled))) {
      cached = { path: bundled };
      return bundled;
    }
  } catch {
    // fall through to PATH
  }

  if (await pathHasFfmpeg()) {
    cached = { path: 'ffmpeg' };
    return 'ffmpeg';
  }

  cached = { path: null };
  return null;
}

/** For the UI / preflight: can this server produce video at all? */
export async function isFfmpegAvailable(): Promise<boolean> {
  return (await resolveFfmpeg()) !== null;
}

/** Thrown when the binary is missing, so callers can distinguish "not configured
 *  here" from "this particular clip failed". */
export class FfmpegUnavailableError extends Error {
  constructor() {
    super(
      'Video export needs ffmpeg, and this server has none. Install it (apt-get install -y ffmpeg) or set FFMPEG_PATH.',
    );
    this.name = 'FfmpegUnavailableError';
  }
}

/**
 * How many encodes may run at once in this process.
 *
 * One, by default, and that default is the whole point: production is a single
 * shared vCPU that also serves every request. A 1080×1080 six-second composite
 * costs about ten seconds of CPU, so two simultaneous exports don't take twice as
 * long — they starve the web app while they fight each other. Queuing is slower
 * for the second person and survivable for everyone else.
 *
 * Raise it (`MOTION_MAX_CONCURRENT`) when the box has cores to spare.
 */
function maxConcurrent(): number {
  const raw = Number(process.env.MOTION_MAX_CONCURRENT);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

let active = 0;
const waiting: (() => void)[] = [];

/** FIFO, so a queued export can't be starved by later arrivals. */
async function acquireSlot(): Promise<() => void> {
  if (active >= maxConcurrent()) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active--;
    waiting.shift()?.();
  };
}

export interface RunFfmpegOptions {
  /** Hard wall-clock cap. A malformed input can make ffmpeg sit forever, and an
   *  export route holding a connection open is worse than a failed export. */
  timeoutMs?: number;
}

/**
 * Run ffmpeg to completion.
 *
 * stderr is ffmpeg's log AND its error message, so it's captured whole and the
 * tail is attached to the thrown error — a filtergraph mistake is unfixable from
 * "exit code 1" alone.
 */
export async function runFfmpeg(args: string[], opts: RunFfmpegOptions = {}): Promise<void> {
  const bin = await resolveFfmpeg();
  if (!bin) throw new FfmpegUnavailableError();
  const timeoutMs = opts.timeoutMs ?? 180_000;
  // Waiting for a slot happens BEFORE the timeout starts: a queued export should
  // not fail because it spent its allowance in the queue.
  const release = await acquireSlot();

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(bin, ['-hide_banner', '-nostdin', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
      let log = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, timeoutMs);

      proc.stderr?.on('data', (chunk: Buffer) => {
        log += chunk.toString();
        // Keep the tail only: a long encode logs a progress line per second, and
        // none of that is diagnostic.
        if (log.length > 8000) log = log.slice(-8000);
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) return reject(new Error(`ffmpeg timed out after ${Math.round(timeoutMs / 1000)}s`));
        if (code === 0) return resolve();
        reject(new Error(`ffmpeg exited ${code}\n${log.trim().split('\n').slice(-12).join('\n')}`));
      });
    });
  } finally {
    release();
  }
}
