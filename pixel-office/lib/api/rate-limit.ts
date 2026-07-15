// Per-user rate limiting (CR-003 F-02).
//
// Behind the `RateLimiter` interface so the in-memory default can later be swapped
// for a shared store (Upstash/Redis) with ZERO caller changes — the route handlers
// only ever call `enforceRateLimit(userId, bucket)`.
//
// ⚠️ SERVERLESS CAVEAT: the default limiter keeps its counters in module memory.
// On Vercel/serverless each cold instance has its OWN Map, so the effective limit
// is (configured limit × concurrent instances) and counters reset on scale-down.
// This is a best-effort in-process shield, NOT a global guarantee. For a hard,
// cross-instance limit, implement `RateLimiter` against Redis and swap the
// `defaultLimiter` factory below — no handler edits required.
import { TooManyRequests } from "./errors";

export interface RateLimitResult {
  allowed: boolean;
  /** Requests still permitted in the current window (0 when blocked). */
  remaining: number;
  /** Seconds until the caller may retry (0 when allowed). */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Record one hit for `key` and report whether it is within the limit. */
  check(key: string): RateLimitResult;
}

interface WindowState {
  count: number;
  windowStart: number; // epoch ms
}

/**
 * Fixed-window counter. Simple, allocation-light, and deterministic to unit-test.
 * `now` is injectable so tests can advance time without real clocks.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, WindowState>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): RateLimitResult {
    const t = this.now();
    const state = this.windows.get(key);

    if (!state || t - state.windowStart >= this.windowMs) {
      // New (or expired) window — this hit is the first one.
      this.windows.set(key, { count: 1, windowStart: t });
      return { allowed: true, remaining: this.limit - 1, retryAfterSeconds: 0 };
    }

    if (state.count < this.limit) {
      state.count += 1;
      return {
        allowed: true,
        remaining: this.limit - state.count,
        retryAfterSeconds: 0,
      };
    }

    // Over the limit for this window.
    const msLeft = this.windowMs - (t - state.windowStart);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(msLeft / 1000)),
    };
  }
}

// A limiter that never blocks — used when rate limiting is disabled via env.
class NoopRateLimiter implements RateLimiter {
  check(): RateLimitResult {
    return { allowed: true, remaining: Number.POSITIVE_INFINITY, retryAfterSeconds: 0 };
  }
}

// Bucket = a category of request with its own budget. Writes are cheaper to abuse
// destructively; provider-hitting reads must be capped to protect upstream quotas;
// agentsRead caps the (cheap, cached) /api/agents roster read per user; signalsRead
// caps the /api/tradingview-webhook GET (alert dashboard read) per user.
export type RateLimitBucket =
  | "write"
  | "providerRead"
  | "agentsRead"
  | "signalsRead"
  | "tradingBotRead"
  | "tradingBotWrite"
  | "backtestRun";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Configurable via env (all optional). Disable entirely with RATE_LIMIT_DISABLED=1.
const DISABLED = process.env.RATE_LIMIT_DISABLED === "1";
const WINDOW_MS = envInt("RATE_LIMIT_WINDOW_MS", 60_000);

// Lazily-built singletons so env is read once, at first use, in the Node runtime.
const limiters = new Map<RateLimitBucket, RateLimiter>();

function limiterFor(bucket: RateLimitBucket): RateLimiter {
  const existing = limiters.get(bucket);
  if (existing) return existing;

  const limit =
    bucket === "write"
      ? envInt("RATE_LIMIT_WRITE_MAX", 30)
      : bucket === "agentsRead"
        ? envInt("RATE_LIMIT_AGENTS_MAX", 30)
        : bucket === "signalsRead"
          ? envInt("RATE_LIMIT_SIGNALS_MAX", 60)
          : bucket === "tradingBotRead"
            ? envInt("RATE_LIMIT_TRADING_BOT_READ_MAX", 60)
            : bucket === "tradingBotWrite"
              ? envInt("RATE_LIMIT_TRADING_BOT_WRITE_MAX", 20)
              : bucket === "backtestRun"
                ? envInt("RATE_LIMIT_BACKTEST_MAX", 5)
                : envInt("RATE_LIMIT_READ_MAX", 60);

  const created: RateLimiter = DISABLED
    ? new NoopRateLimiter()
    : new InMemoryRateLimiter(limit, WINDOW_MS);
  limiters.set(bucket, created);
  return created;
}

/**
 * Enforce the per-user limit for a bucket. Keyed by the INTERNAL userId (the tenant
 * key), never by IP — one user cannot exhaust another's budget. Throws
 * TooManyRequests (→ 429 + Retry-After) when the budget is spent.
 */
export function enforceRateLimit(userId: string, bucket: RateLimitBucket): void {
  const result = limiterFor(bucket).check(`${bucket}:${userId}`);
  if (!result.allowed) {
    throw new TooManyRequests(result.retryAfterSeconds);
  }
}

/** Test seam: clear all in-memory counters between cases. */
export function __resetRateLimiters(): void {
  limiters.clear();
}
