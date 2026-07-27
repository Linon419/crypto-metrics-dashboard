const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_BLOCK_MS = 15 * 60 * 1000;

function normalizeKey(value) {
  return String(value || 'unknown').trim().toLowerCase();
}

function createLoginAttemptLimiter({
  maxAccountFailures = 5,
  maxIpFailures = 25,
  windowMs = DEFAULT_WINDOW_MS,
  blockMs = DEFAULT_BLOCK_MS,
  maxTrackedEntries = 10_000,
  now = Date.now,
} = {}) {
  const accountAttempts = new Map();
  const ipAttempts = new Map();
  const entryLimit = Math.max(1, Number.parseInt(maxTrackedEntries, 10) || 10_000);

  function getActiveEntry(store, key) {
    const currentTime = now();
    const entry = store.get(key);
    if (!entry) return { failures: [], blockedUntil: 0 };
    if (entry.blockedUntil && entry.blockedUntil <= currentTime) {
      store.delete(key);
      return { failures: [], blockedUntil: 0 };
    }
    entry.failures = entry.failures.filter(timestamp => currentTime - timestamp < windowMs);
    if (entry.failures.length === 0 && !entry.blockedUntil) store.delete(key);
    return entry;
  }

  function record(store, key, threshold) {
    const currentTime = now();
    const entry = getActiveEntry(store, key);
    entry.failures.push(currentTime);
    if (entry.failures.length >= threshold) {
      entry.blockedUntil = currentTime + blockMs;
    }
    if (store.has(key)) store.delete(key);
    while (store.size >= entryLimit) {
      store.delete(store.keys().next().value);
    }
    store.set(key, entry);
  }

  function getBlock(entry) {
    const remainingMs = Math.max(0, entry.blockedUntil - now());
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  }

  return {
    check({ username, ip }) {
      const account = getActiveEntry(accountAttempts, normalizeKey(username));
      const address = getActiveEntry(ipAttempts, normalizeKey(ip));
      const retryAfterSeconds = Math.max(getBlock(account), getBlock(address));
      return {
        allowed: retryAfterSeconds === 0,
        retryAfterSeconds,
      };
    },
    recordFailure({ username, ip }) {
      record(accountAttempts, normalizeKey(username), maxAccountFailures);
      record(ipAttempts, normalizeKey(ip), maxIpFailures);
    },
    recordSuccess({ username, ip }) {
      accountAttempts.delete(normalizeKey(username));
      // 只清账号桶会让 fail/fail/success/fail 依旧把该地址锁死，IP 桶也要一并清掉
      ipAttempts.delete(normalizeKey(ip));
    },
    reset() {
      accountAttempts.clear();
      ipAttempts.clear();
    },
    getTrackedEntryCounts() {
      return { accounts: accountAttempts.size, ips: ipAttempts.size };
    },
  };
}

module.exports = {
  createLoginAttemptLimiter,
};
