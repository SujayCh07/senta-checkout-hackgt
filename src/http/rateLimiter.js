export function createFixedWindowLimiter({ limit = 12, windowMs = 15 * 60 * 1000, maxKeys = 5000, now = Date.now } = {}) {
  if (![limit, windowMs, maxKeys].every(Number.isSafeInteger) || limit < 1 || windowMs < 1 || maxKeys < 1) {
    throw new TypeError('Rate limit settings must be positive integers');
  }
  const buckets = new Map();

  return Object.freeze({
    consume(key) {
      const timestamp = now();
      const current = buckets.get(key);
      if (!current || current.expiresAt <= timestamp) {
        if (buckets.size >= maxKeys) {
          const oldestKey = buckets.keys().next().value;
          buckets.delete(oldestKey);
        }
        buckets.set(key, { count: 1, expiresAt: timestamp + windowMs });
        return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
      }
      current.count += 1;
      return {
        allowed: current.count <= limit,
        remaining: Math.max(0, limit - current.count),
        retryAfterMs: Math.max(0, current.expiresAt - timestamp),
      };
    },
    clear() { buckets.clear(); },
    size() { return buckets.size; },
  });
}
