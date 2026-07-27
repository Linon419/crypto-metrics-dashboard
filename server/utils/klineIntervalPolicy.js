const DISABLED_KLINE_INTERVALS = new Set(['15m']);

function normalizeKlineIntervalValue(interval, fallback = '1d') {
  return String(interval || fallback).trim();
}

function ensureKlineIntervalEnabled(interval, fallback = '1d') {
  const normalized = normalizeKlineIntervalValue(interval, fallback);
  if (DISABLED_KLINE_INTERVALS.has(normalized)) {
    const error = new Error(`Kline interval is disabled: ${normalized}`);
    error.code = 'KLINE_INTERVAL_DISABLED';
    error.status = 400;
    throw error;
  }
  return normalized;
}

module.exports = {
  DISABLED_KLINE_INTERVALS,
  ensureKlineIntervalEnabled,
  normalizeKlineIntervalValue,
};
