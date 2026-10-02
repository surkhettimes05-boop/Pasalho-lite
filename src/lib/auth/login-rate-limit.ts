const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

type Attempt = {
  failures: number;
  resetAt: number;
};

const globalForLimiter = globalThis as unknown as {
  pasalhoLoginAttempts?: Map<string, Attempt>;
};

const attempts =
  globalForLimiter.pasalhoLoginAttempts ?? new Map<string, Attempt>();

globalForLimiter.pasalhoLoginAttempts = attempts;

export function getLoginRateLimitKey(email: string, ip: string | null) {
  return `${ip ?? "unknown"}:${email.trim().toLowerCase()}`;
}

export function checkLoginRateLimit(key: string, now = Date.now()) {
  const current = attempts.get(key);

  if (!current || current.resetAt <= now) {
    if (current) attempts.delete(key);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (current.failures < MAX_FAILURES) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

export function recordLoginFailure(key: string, now = Date.now()) {
  const current = attempts.get(key);

  if (!current || current.resetAt <= now) {
    attempts.set(key, { failures: 1, resetAt: now + WINDOW_MS });
    return;
  }

  attempts.set(key, {
    failures: current.failures + 1,
    resetAt: current.resetAt,
  });
}

export function clearLoginFailures(key: string) {
  attempts.delete(key);
}

export function resetLoginRateLimiterForTests() {
  attempts.clear();
}
