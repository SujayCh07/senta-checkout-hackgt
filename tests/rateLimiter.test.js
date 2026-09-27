import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixedWindowLimiter } from '../src/http/rateLimiter.js';

test('fixed-window limiter blocks after the configured attempts and resets at expiry', () => {
  let now = 10_000;
  const limiter = createFixedWindowLimiter({ limit: 2, windowMs: 1000, maxKeys: 4, now: () => now });
  assert.equal(limiter.consume('127.0.0.1').allowed, true);
  assert.equal(limiter.consume('127.0.0.1').allowed, true);
  const limited = limiter.consume('127.0.0.1');
  assert.equal(limited.allowed, false);
  assert.equal(limited.retryAfterMs, 1000);
  now += 1000;
  assert.equal(limiter.consume('127.0.0.1').allowed, true);
});

test('fixed-window limiter bounds memory while keeping independent client buckets', () => {
  const limiter = createFixedWindowLimiter({ limit: 1, maxKeys: 2, now: () => 1 });
  limiter.consume('a');
  limiter.consume('b');
  limiter.consume('c');
  assert.equal(limiter.size(), 2);
  assert.equal(limiter.consume('c').allowed, false);
});
