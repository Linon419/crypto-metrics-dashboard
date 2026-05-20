const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

class AdminDateRecordError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'AdminDateRecordError';
    this.statusCode = statusCode;
  }
}

function normalizeDateParam(date) {
  if (typeof date !== 'string' || !DATE_PATTERN.test(date)) {
    throw new AdminDateRecordError('日期格式无效，应为 YYYY-MM-DD');
  }

  return date;
}

function parseDateParts(date) {
  const [year, month, day] = normalizeDateParam(date).split('-').map(Number);
  const timestamp = new Date(year, month - 1, day);

  if (
    timestamp.getFullYear() !== year ||
    timestamp.getMonth() !== month - 1 ||
    timestamp.getDate() !== day
  ) {
    throw new AdminDateRecordError('日期无效');
  }

  return { year, month, day };
}

function normalizeTimePrecision(timePrecision) {
  if (timePrecision === 'day' || timePrecision === 'hour' || timePrecision === 'minute') {
    return timePrecision;
  }

  throw new AdminDateRecordError('时间精度无效，应为 day、hour 或 minute');
}

function parseTimeForPrecision(time, timePrecision) {
  if (timePrecision === 'day') {
    return { hour: 0, minute: 0 };
  }

  if (typeof time !== 'string' || time.trim() === '') {
    throw new AdminDateRecordError('小时或分钟精度需要提供时间');
  }

  const trimmedTime = time.trim();

  if (timePrecision === 'hour') {
    const match = trimmedTime.match(/^(\d{1,2})(?::00)?$/);
    if (!match) {
      throw new AdminDateRecordError('小时精度时间格式应为 HH 或 HH:00');
    }

    const hour = Number.parseInt(match[1], 10);
    if (hour < 0 || hour > 23) {
      throw new AdminDateRecordError('小时必须在 0 到 23 之间');
    }

    return { hour, minute: 0 };
  }

  const match = trimmedTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new AdminDateRecordError('分钟精度时间格式应为 HH:mm');
  }

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new AdminDateRecordError('时间必须在 00:00 到 23:59 之间');
  }

  return { hour, minute };
}

function parseDateTimeUpdate({ date, time, timePrecision }) {
  const normalizedDate = normalizeDateParam(date);
  const normalizedPrecision = normalizeTimePrecision(timePrecision);
  const { year, month, day } = parseDateParts(normalizedDate);
  const { hour, minute } = parseTimeForPrecision(time, normalizedPrecision);

  return {
    date: normalizedDate,
    timestamp: new Date(year, month - 1, day, hour, minute, 0, 0),
    time_precision: normalizedPrecision,
  };
}

async function getDateRecordSummary(models, date) {
  const normalizedDate = normalizeDateParam(date);
  const [dailyMetrics, liquidityOverviews, trendingCoins] = await Promise.all([
    models.DailyMetric.count({ where: { date: normalizedDate } }),
    models.LiquidityOverview.count({ where: { date: normalizedDate } }),
    models.TrendingCoin.count({ where: { date: normalizedDate } }),
  ]);

  return {
    date: normalizedDate,
    counts: {
      dailyMetrics,
      liquidityOverviews,
      trendingCoins,
      total: dailyMetrics + liquidityOverviews + trendingCoins,
    },
  };
}

async function updateDateRecordTime(models, { date, time, timePrecision, transaction }) {
  const parsed = parseDateTimeUpdate({ date, time, timePrecision });
  const updatePayload = {
    timestamp: parsed.timestamp,
    time_precision: parsed.time_precision,
  };

  const [dailyMetrics, liquidityOverviews, trendingCoins] = await Promise.all([
    models.DailyMetric.update(updatePayload, { where: { date: parsed.date }, transaction }),
    models.LiquidityOverview.update(updatePayload, { where: { date: parsed.date }, transaction }),
    models.TrendingCoin.update(updatePayload, { where: { date: parsed.date }, transaction }),
  ]);

  return {
    date: parsed.date,
    timestamp: parsed.timestamp,
    timePrecision: parsed.time_precision,
    updated: {
      dailyMetrics: dailyMetrics[0] || 0,
      liquidityOverviews: liquidityOverviews[0] || 0,
      trendingCoins: trendingCoins[0] || 0,
      total: (dailyMetrics[0] || 0) + (liquidityOverviews[0] || 0) + (trendingCoins[0] || 0),
    },
  };
}

async function deleteDateRecords(models, { date, transaction }) {
  const normalizedDate = normalizeDateParam(date);
  const [dailyMetrics, liquidityOverviews, trendingCoins] = await Promise.all([
    models.DailyMetric.destroy({ where: { date: normalizedDate }, transaction }),
    models.LiquidityOverview.destroy({ where: { date: normalizedDate }, transaction }),
    models.TrendingCoin.destroy({ where: { date: normalizedDate }, transaction }),
  ]);

  return {
    date: normalizedDate,
    deleted: {
      dailyMetrics,
      liquidityOverviews,
      trendingCoins,
      total: dailyMetrics + liquidityOverviews + trendingCoins,
    },
  };
}

module.exports = {
  AdminDateRecordError,
  deleteDateRecords,
  getDateRecordSummary,
  normalizeDateParam,
  parseDateTimeUpdate,
  updateDateRecordTime,
};
