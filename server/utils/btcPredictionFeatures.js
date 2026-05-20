const { buildPeriodStateFeatures } = require('./btcPeriodStateFeatures');

const HORIZONS = [1, 3, 5, 7];

const FEATURE_NAMES = [
  'otc_index',
  'explosion_index',
  'entry_exit_day',
  'is_entry_period',
  'is_exit_period',
  'early_entry_period',
  'middle_entry_period',
  'late_entry_period',
  'early_exit_period',
  'middle_exit_period',
  'late_exit_period',
  'otc_change_1d',
  'otc_change_3d',
  'otc_change_7d',
  'explosion_change_1d',
  'explosion_change_3d',
  'explosion_change_7d',
  'otc_pct_change_1d',
  'explosion_pct_change_1d',
  'otc_ma_3',
  'otc_ma_7',
  'explosion_ma_3',
  'explosion_ma_7',
  'otc_slope_3',
  'explosion_slope_3',
  'otc_up_3d',
  'explosion_up_3d',
  'explosion_above_200',
  'explosion_below_0',
  'explosion_cross_up_200',
  'explosion_cross_down_200',
  'otc_above_1000',
  'otc_above_1500',
  'schelling_return_1d',
  'schelling_return_3d',
  'schelling_ma_3',
  'schelling_ma_7',
];

function isFiniteNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function toNumber(value, fallback = 0) {
  return isFiniteNumber(value) ? Number(value) : fallback;
}

function sortMetrics(metrics = []) {
  return [...metrics]
    .filter(metric => metric && metric.date)
    .sort((a, b) => {
      const dateCompare = String(a.date).localeCompare(String(b.date));
      if (dateCompare !== 0) return dateCompare;

      const timeCompare = metricTimeValue(a) - metricTimeValue(b);
      if (timeCompare !== 0) return timeCompare;

      return Number(a.id || 0) - Number(b.id || 0);
    });
}

function hasRequiredInputs(metric) {
  return isFiniteNumber(metric?.otc_index) && isFiniteNumber(metric?.explosion_index);
}

function hasSchellingPoint(metric) {
  return isFiniteNumber(metric?.schelling_point);
}

function hasPublishPrice(metric) {
  return isFiniteNumber(metric?.btc_publish_price);
}

function metricTimeValue(metric) {
  const value = metric?.timestamp || metric?.date;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function addCalendarDays(dateString, days) {
  const date = new Date(`${String(dateString).slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function findFutureRow(rows, index, horizon) {
  const current = rows[index];
  const targetDate = addCalendarDays(current.date, horizon);
  if (!targetDate) return null;

  for (let futureIndex = index + 1; futureIndex < rows.length; futureIndex += 1) {
    const future = rows[futureIndex];
    if (String(future.date) >= targetDate && hasPublishPrice(future)) {
      return future;
    }
  }

  return null;
}

function valueAt(rows, index, key) {
  if (index < 0 || index >= rows.length) return null;
  return isFiniteNumber(rows[index][key]) ? Number(rows[index][key]) : null;
}

function change(rows, index, key, lag) {
  const current = valueAt(rows, index, key);
  const previous = valueAt(rows, index - lag, key);
  if (current === null || previous === null) return 0;
  return current - previous;
}

function pctChange(rows, index, key, lag) {
  const current = valueAt(rows, index, key);
  const previous = valueAt(rows, index - lag, key);
  if (current === null || previous === null || previous === 0) return 0;
  return current / previous - 1;
}

function rollingMean(rows, index, key, windowSize) {
  const values = [];
  for (let offset = 0; offset < windowSize; offset += 1) {
    const value = valueAt(rows, index - offset, key);
    if (value !== null) values.push(value);
  }

  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildFeatureObject(rows, index) {
  const metric = rows[index];
  const previous = rows[index - 1] || null;
  const periodState = buildPeriodStateFeatures(metric);
  const currentExplosion = toNumber(metric.explosion_index);
  const previousExplosion = previous ? toNumber(previous.explosion_index, currentExplosion) : currentExplosion;
  const currentOtc = toNumber(metric.otc_index);
  const entryExitDay = Math.max(0, Math.round(toNumber(metric.entry_exit_day, 0)));

  const features = {
    otc_index: currentOtc,
    explosion_index: currentExplosion,
    entry_exit_day: entryExitDay,
    is_entry_period: periodState.is_entry_period,
    is_exit_period: periodState.is_exit_period,
    early_entry_period: periodState.early_entry_period,
    middle_entry_period: periodState.middle_entry_period,
    late_entry_period: periodState.late_entry_period,
    early_exit_period: periodState.early_exit_period,
    middle_exit_period: periodState.middle_exit_period,
    late_exit_period: periodState.late_exit_period,
    otc_change_1d: change(rows, index, 'otc_index', 1),
    otc_change_3d: change(rows, index, 'otc_index', 3),
    otc_change_7d: change(rows, index, 'otc_index', 7),
    explosion_change_1d: change(rows, index, 'explosion_index', 1),
    explosion_change_3d: change(rows, index, 'explosion_index', 3),
    explosion_change_7d: change(rows, index, 'explosion_index', 7),
    otc_pct_change_1d: pctChange(rows, index, 'otc_index', 1),
    explosion_pct_change_1d: pctChange(rows, index, 'explosion_index', 1),
    otc_ma_3: rollingMean(rows, index, 'otc_index', 3),
    otc_ma_7: rollingMean(rows, index, 'otc_index', 7),
    explosion_ma_3: rollingMean(rows, index, 'explosion_index', 3),
    explosion_ma_7: rollingMean(rows, index, 'explosion_index', 7),
    otc_slope_3: change(rows, index, 'otc_index', 3),
    explosion_slope_3: change(rows, index, 'explosion_index', 3),
    otc_up_3d: change(rows, index, 'otc_index', 3) > 0 ? 1 : 0,
    explosion_up_3d: change(rows, index, 'explosion_index', 3) > 0 ? 1 : 0,
    explosion_above_200: currentExplosion > 200 ? 1 : 0,
    explosion_below_0: currentExplosion < 0 ? 1 : 0,
    explosion_cross_up_200: previousExplosion <= 200 && currentExplosion > 200 ? 1 : 0,
    explosion_cross_down_200: previousExplosion >= 200 && currentExplosion < 200 ? 1 : 0,
    otc_above_1000: currentOtc > 1000 ? 1 : 0,
    otc_above_1500: currentOtc > 1500 ? 1 : 0,
    schelling_return_1d: pctChange(rows, index, 'schelling_point', 1),
    schelling_return_3d: pctChange(rows, index, 'schelling_point', 3),
    schelling_ma_3: rollingMean(rows, index, 'schelling_point', 3),
    schelling_ma_7: rollingMean(rows, index, 'schelling_point', 7),
  };

  return { features, periodState };
}

function buildFeatureRow(rows, index) {
  const metric = rows[index];
  const { features, periodState } = buildFeatureObject(rows, index);

  return {
    date: metric.date,
    timestamp: metric.timestamp || null,
    otc_index: toNumber(metric.otc_index),
    explosion_index: toNumber(metric.explosion_index),
    schelling_point: hasSchellingPoint(metric) ? Number(metric.schelling_point) : null,
    btc_publish_price: hasPublishPrice(metric) ? Number(metric.btc_publish_price) : null,
    entry_exit_type: periodState.period_type,
    entry_exit_day: periodState.period_day,
    features,
    periodState,
  };
}

function buildBtcPredictionRows(metrics = [], options = {}) {
  const horizons = options.horizons || HORIZONS;
  const minReturn = Number.isFinite(options.minReturn) ? options.minReturn : 0;
  const rows = sortMetrics(metrics).filter(hasRequiredInputs);
  const predictionRows = [];

  for (let index = 0; index < rows.length; index += 1) {
    const current = rows[index];
    if (!hasPublishPrice(current)) continue;

    const currentPrice = Number(current.btc_publish_price);
    const baseRow = buildFeatureRow(rows, index);

    horizons.forEach((horizon) => {
      const future = findFutureRow(rows, index, horizon);
      if (!future) return;

      const futurePrice = Number(future.btc_publish_price);
      const futureSchelling = hasSchellingPoint(future) ? Number(future.schelling_point) : null;
      const futureReturn = currentPrice === 0
        ? 0
        : futurePrice / currentPrice - 1;

      predictionRows.push({
        ...baseRow,
        target_horizon: horizon,
        future_date: future.date,
        future_timestamp: future.timestamp || null,
        future_btc_publish_price: futurePrice,
        future_schelling_point: futureSchelling,
        future_return: futureReturn,
        target_up: futureReturn > minReturn ? 1 : 0,
        target_flat: Math.abs(futureReturn) <= 0.01 ? 1 : 0,
        target_direction: futureReturn > 0.01 ? 'up' : futureReturn < -0.01 ? 'down' : 'flat',
      });
    });
  }

  return predictionRows;
}

function buildLatestFeatureRow(metrics = []) {
  const rows = sortMetrics(metrics).filter(metric => hasRequiredInputs(metric) && hasPublishPrice(metric));
  if (rows.length === 0) return null;
  return buildFeatureRow(rows, rows.length - 1);
}

function getFeatureVector(row, featureNames = FEATURE_NAMES) {
  return featureNames.map((name) => {
    const value = row.features ? row.features[name] : row[name];
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  });
}

module.exports = {
  FEATURE_NAMES,
  HORIZONS,
  buildBtcPredictionRows,
  buildFeatureRow,
  buildLatestFeatureRow,
  getFeatureVector,
  hasRequiredInputs,
  hasPublishPrice,
  hasSchellingPoint,
  isFiniteNumber,
  sortMetrics,
};
