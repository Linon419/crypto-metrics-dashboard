function explosionBucket(features) {
  const value = Number(features.explosion_index);
  if (value < 0) return 'explosion_below_0';
  if (value > 200) return 'explosion_above_200';
  return 'explosion_between_0_200';
}

function otcBucket(features) {
  const value = Number(features.otc_index);
  if (value < 1000) return 'otc_below_1000';
  if (value > 1500) return 'otc_above_1500';
  return 'otc_between_1000_1500';
}

function trendBucket(features) {
  return Number(features.otc_up_3d) === 1 ? 'otc_up_3d' : 'otc_down_or_flat_3d';
}

function periodBucket(features) {
  if (Number(features.early_entry_period) === 1) return 'entry_1_7';
  if (Number(features.middle_entry_period) === 1) return 'entry_8_30';
  if (Number(features.late_entry_period) === 1) return 'entry_31_plus';
  if (Number(features.early_exit_period) === 1) return 'exit_1_7';
  if (Number(features.middle_exit_period) === 1) return 'exit_8_30';
  if (Number(features.late_exit_period) === 1) return 'exit_31_plus';
  return 'period_unknown';
}

const LABELS = {
  explosion_below_0: '爆破<0',
  explosion_between_0_200: '爆破0-200',
  explosion_above_200: '爆破>200',
  otc_below_1000: '场外<1000',
  otc_between_1000_1500: '场外1000-1500',
  otc_above_1500: '场外>1500',
  otc_up_3d: '场外3日上升',
  otc_down_or_flat_3d: '场外3日走平或下降',
  entry_1_7: '进场期1-7天',
  entry_8_30: '进场期8-30天',
  entry_31_plus: '进场期31天以后',
  exit_1_7: '退场期1-7天',
  exit_8_30: '退场期8-30天',
  exit_31_plus: '退场期31天以后',
  period_unknown: '周期未知',
};

function getBayesianConditionKey(row) {
  const features = row.features || row;
  return [
    explosionBucket(features),
    otcBucket(features),
    trendBucket(features),
    periodBucket(features),
  ].join('|');
}

function addStats(map, key, targetUp) {
  if (!map.has(key)) {
    map.set(key, { total: 0, up: 0 });
  }

  const stats = map.get(key);
  stats.total += 1;
  stats.up += Number(targetUp) === 1 ? 1 : 0;
}

function buildExplanation(key) {
  return key
    .split('|')
    .map(part => LABELS[part] || part)
    .join(' + ');
}

function trainBayesianRuleModel(rows = []) {
  const conditionStats = new Map();
  const globalStats = { total: 0, up: 0 };

  rows.forEach((row) => {
    const key = getBayesianConditionKey(row);
    addStats(conditionStats, key, row.target_up);
    globalStats.total += 1;
    globalStats.up += Number(row.target_up) === 1 ? 1 : 0;
  });

  function predict(row) {
    const key = getBayesianConditionKey(row);
    const stats = conditionStats.get(key) || { total: 0, up: 0 };
    const fallbackProbability = (globalStats.up + 1) / (globalStats.total + 2 || 2);
    const probability = stats.total > 0
      ? (stats.up + 1) / (stats.total + 2)
      : fallbackProbability;

    return {
      modelName: 'Bayesian Rule Model',
      probability,
      conditionKey: key,
      explanation: buildExplanation(key),
      sampleSize: stats.total,
      upCount: stats.up,
      globalSampleSize: globalStats.total,
      globalUpCount: globalStats.up,
    };
  }

  return {
    modelName: 'Bayesian Rule Model',
    predict,
    conditionStats,
    globalStats,
  };
}

module.exports = {
  buildExplanation,
  getBayesianConditionKey,
  trainBayesianRuleModel,
};
