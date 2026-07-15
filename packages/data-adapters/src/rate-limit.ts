export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
}

export interface RequestRateLimiter {
  acquire(key: string): RateLimitDecision;
}

export interface TokenBucketOptions {
  readonly capacity: number;
  readonly refillTokensPerSecond: number;
  readonly now?: () => number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export function createTokenBucketRateLimiter(options: TokenBucketOptions): RequestRateLimiter {
  if (
    !Number.isInteger(options.capacity) ||
    options.capacity <= 0 ||
    !Number.isFinite(options.refillTokensPerSecond) ||
    options.refillTokensPerSecond <= 0
  ) {
    throw new RangeError("Token bucket configuration must be positive");
  }
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  return {
    acquire(key) {
      const currentTime = now();
      const previous = buckets.get(key) ?? {
        tokens: options.capacity,
        updatedAt: currentTime
      };
      const elapsedSeconds = Math.max(0, currentTime - previous.updatedAt) / 1_000;
      const tokens = Math.min(
        options.capacity,
        previous.tokens + elapsedSeconds * options.refillTokensPerSecond
      );
      if (tokens < 1) {
        buckets.set(key, { tokens, updatedAt: currentTime });
        return {
          allowed: false,
          retryAfterMs: Math.ceil(((1 - tokens) / options.refillTokensPerSecond) * 1_000)
        };
      }
      buckets.set(key, { tokens: tokens - 1, updatedAt: currentTime });
      return { allowed: true, retryAfterMs: 0 };
    }
  };
}
