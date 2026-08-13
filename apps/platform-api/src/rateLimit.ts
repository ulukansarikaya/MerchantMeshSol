import type { MiddlewareHandler } from "hono";
import type Redis from "ioredis";

/**
 * Fixed-window rate limit via Redis INCR+EXPIRE. Per plans/faz-c.md §4:
 * /auth/* endpoints get 10 requests/minute per IP.
 */
export function createRateLimiter(redis: Redis, opts: { windowSec: number; max: number; keyPrefix: string }): MiddlewareHandler {
  return async (c, next) => {
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "unknown";
    const key = `${opts.keyPrefix}:${ip}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, opts.windowSec);
    if (count > opts.max) {
      return c.json({ error: "rate_limited", detail: `Max ${opts.max} requests per ${opts.windowSec}s.` }, 429);
    }
    await next();
  };
}
