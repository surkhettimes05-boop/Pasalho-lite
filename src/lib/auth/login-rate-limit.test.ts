import { beforeEach, describe, expect, it } from "vitest";
import {
  checkLoginRateLimit,
  clearLoginFailures,
  getLoginRateLimitKey,
  recordLoginFailure,
  resetLoginRateLimiterForTests,
} from "@/lib/auth/login-rate-limit";

describe("login rate limiter", () => {
  beforeEach(() => resetLoginRateLimiterForTests());

  it("blocks after five failures inside the 15-minute window", () => {
    const key = getLoginRateLimitKey("OWNER@EXAMPLE.COM", "127.0.0.1");
    const now = 1_000_000;

    for (let i = 0; i < 5; i += 1) {
      expect(checkLoginRateLimit(key, now).allowed).toBe(true);
      recordLoginFailure(key, now);
    }

    expect(checkLoginRateLimit(key, now).allowed).toBe(false);
    expect(checkLoginRateLimit(key, now).retryAfterSeconds).toBeGreaterThan(0);
  });

  it("clears failures after successful authentication", () => {
    const key = getLoginRateLimitKey("owner@example.com", "127.0.0.1");

    for (let i = 0; i < 5; i += 1) recordLoginFailure(key, 10_000);
    expect(checkLoginRateLimit(key, 10_000).allowed).toBe(false);

    clearLoginFailures(key);
    expect(checkLoginRateLimit(key, 10_000).allowed).toBe(true);
  });

  it("expires the failure window", () => {
    const key = getLoginRateLimitKey("owner@example.com", "127.0.0.1");

    for (let i = 0; i < 5; i += 1) recordLoginFailure(key, 20_000);
    expect(checkLoginRateLimit(key, 20_000).allowed).toBe(false);
    expect(checkLoginRateLimit(key, 20_000 + 15 * 60 * 1000 + 1).allowed).toBe(true);
  });
});
