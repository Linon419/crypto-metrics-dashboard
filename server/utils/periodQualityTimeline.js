const { QUALITY_LOOKBACK_DAYS } = require('./periodQuality');

function toPlainMetric(metric) {
  return typeof metric?.toJSON === 'function' ? metric.toJSON() : { ...metric };
}

function metricSortValue(metric) {
  const timestamp = metric?.timestamp || `${metric?.date || ''}T00:00:00.000Z`;
  const time = new Date(timestamp).getTime();
  if (Number.isFinite(time)) return time;
  const dateTime = new Date(`${metric?.date || ''}T00:00:00.000Z`).getTime();
  return Number.isFinite(dateTime) ? dateTime : 0;
}

function compareMetricAsc(left, right) {
  const timeDiff = metricSortValue(left) - metricSortValue(right);
  if (timeDiff !== 0) return timeDiff;
  return Number(left?.id || 0) - Number(right?.id || 0);
}

function compareMetricDesc(left, right) {
  return compareMetricAsc(right, left);
}

function getQualityLookbackStartDate(dateString, lookbackDays = QUALITY_LOOKBACK_DAYS) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - lookbackDays);
  return date.toISOString().slice(0, 10);
}

async function attachPeriodQualityToMetrics(metrics = [], options = {}) {
  const {
    coinId,
    historicalMetrics = metrics,
    calculatePeriodQualityForDate,
    lookbackDays = QUALITY_LOOKBACK_DAYS,
  } = options;

  if (typeof calculatePeriodQualityForDate !== 'function') {
    throw new Error('calculatePeriodQualityForDate is required');
  }

  const historicalRows = historicalMetrics
    .map(toPlainMetric)
    .sort(compareMetricAsc);

  return Promise.all(metrics.map(async (metric) => {
    const plainMetric = toPlainMetric(metric);
    const historyForMetric = historicalRows
      .filter(row => compareMetricAsc(row, plainMetric) <= 0)
      .sort(compareMetricDesc)
      .slice(0, lookbackDays);

    let periodQuality = '数据不足';
    if (historyForMetric.length >= 2) {
      try {
        periodQuality = await calculatePeriodQualityForDate(
          coinId,
          plainMetric.date,
          historyForMetric
        );
      } catch (error) {
        console.error(`[PeriodQualityTimeline] Failed to calculate ${plainMetric.date}:`, error);
        periodQuality = '计算出错';
      }
    }

    return {
      ...plainMetric,
      period_quality: periodQuality,
    };
  }));
}

module.exports = {
  attachPeriodQualityToMetrics,
  compareMetricAsc,
  compareMetricDesc,
  getQualityLookbackStartDate,
  metricSortValue,
};
