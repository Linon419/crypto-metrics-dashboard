function normalizePeriodType(value) {
  const normalized = String(value || '').trim().toLowerCase();

  if (['entry', 'in', 'long', '进场', '進場', '进场期', '進場期'].includes(normalized)) {
    return 'entry';
  }

  if (['exit', 'out', 'short', '退场', '退場', '退场期', '退場期'].includes(normalized)) {
    return 'exit';
  }

  return 'unknown';
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getEntryDayBucket(periodType, day) {
  if (periodType !== 'entry') return null;
  if (day <= 7) return 'entry_1_7';
  if (day <= 30) return 'entry_8_30';
  return 'entry_31_plus';
}

function getExitDayBucket(periodType, day) {
  if (periodType !== 'exit') return null;
  if (day <= 7) return 'exit_1_7';
  if (day <= 30) return 'exit_8_30';
  return 'exit_31_plus';
}

function getPeriodStateLabel(periodType, day) {
  if (periodType === 'entry') {
    if (day <= 7) return '进场期前7天';
    if (day <= 30) return '进场期第8-30天';
    return '进场期第31天以后';
  }

  if (periodType === 'exit') {
    if (day <= 7) return '退场期前7天';
    if (day <= 30) return '退场期第8-30天';
    return '退场期第31天以后';
  }

  return '周期未知';
}

function buildPeriodStateFeatures(metric = {}) {
  const periodType = normalizePeriodType(metric.entry_exit_type);
  const periodDay = Math.max(0, Math.round(toNumber(metric.entry_exit_day, 0)));
  const entryBucket = getEntryDayBucket(periodType, periodDay);
  const exitBucket = getExitDayBucket(periodType, periodDay);

  return {
    period_type: periodType,
    period_day: periodDay,
    is_entry_period: periodType === 'entry' ? 1 : 0,
    is_exit_period: periodType === 'exit' ? 1 : 0,
    early_entry_period: entryBucket === 'entry_1_7' ? 1 : 0,
    middle_entry_period: entryBucket === 'entry_8_30' ? 1 : 0,
    late_entry_period: entryBucket === 'entry_31_plus' ? 1 : 0,
    early_exit_period: exitBucket === 'exit_1_7' ? 1 : 0,
    middle_exit_period: exitBucket === 'exit_8_30' ? 1 : 0,
    late_exit_period: exitBucket === 'exit_31_plus' ? 1 : 0,
    entry_day_bucket: entryBucket,
    exit_day_bucket: exitBucket,
    period_state_label: getPeriodStateLabel(periodType, periodDay),
  };
}

module.exports = {
  buildPeriodStateFeatures,
  getEntryDayBucket,
  getExitDayBucket,
  getPeriodStateLabel,
  normalizePeriodType,
};
