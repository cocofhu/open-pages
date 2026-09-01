/** Simple sliding-window rate limiter (in-memory, single process). */

export interface RateLimitResult {
  ok: boolean;
  retryAfterMs: number;
}

export function createRateLimiter(options: {
  windowMs: number;
  max: number;
}): { check: (key: string) => RateLimitResult } {
  const hits = new Map<string, number[]>();

  return {
    check(key: string): RateLimitResult {
      const now = Date.now();
      const recent = (hits.get(key) ?? []).filter((t) => now - t < options.windowMs);
      if (recent.length >= options.max) {
        hits.set(key, recent);
        const oldest = recent[0] ?? now;
        return { ok: false, retryAfterMs: Math.max(0, options.windowMs - (now - oldest)) };
      }
      recent.push(now);
      hits.set(key, recent);
      return { ok: true, retryAfterMs: 0 };
    },
  };
}

/** Best-effort client address for rate limits. X-Forwarded-For is first hop only. */
export function requestIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim() ?? "";
    if (first) return first.slice(0, 128);
  }
  return (c.req.header("x-real-ip") ?? "unknown").slice(0, 128);
}

/** Global concurrency gate for expensive work (e.g. hexo generate). */
export function createConcurrencyGate(
  max: number,
  maxQueued = 8,
): {
  run: <T>(fn: () => Promise<T>) => Promise<T>;
} {
  let active = 0;
  const waiters: Array<() => void> = [];

  const acquire = () =>
    new Promise<void>((resolve, reject) => {
      if (active < max) {
        active += 1;
        resolve();
        return;
      }
      if (waiters.length >= maxQueued) {
        reject(new Error("Too many requests, try again shortly"));
        return;
      }
      waiters.push(() => {
        active += 1;
        resolve();
      });
    });

  const release = () => {
    active = Math.max(0, active - 1);
    const next = waiters.shift();
    if (next) next();
  };

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}
