const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const getPrevData = (coin) => coin?.previousDayData || coin?.previous_day_data || null;

const getRiskNotes = (coin) => {
  const notes = coin?.riskNotes || coin?.risk_notes;
  return Array.isArray(notes) ? notes.filter(Boolean) : [];
};

const normalizeBackendSignal = (signal) => {
  if (!signal || typeof signal !== 'object') return null;
  return {
    direction: signal.direction || 'neutral',
    level: signal.level || null,
    color: signal.color || (signal.direction === 'long' ? 'success' : signal.direction === 'short' ? 'error' : 'default'),
    risk: signal.risk || 'medium',
    confirmed: Boolean(signal.confirmed),
    label: signal.label || '观望',
    reasons: Array.isArray(signal.reasons) ? signal.reasons : [],
    confirmations: Array.isArray(signal.confirmations) ? signal.confirmations : [],
    warnings: Array.isArray(signal.warnings) ? signal.warnings : [],
    description: signal.description || '',
  };
};

const getField = (row, camelKey, snakeKey) => row?.[camelKey] ?? row?.[snakeKey];

const normalizePeriodQuality = (quality) => String(quality || '').trim();

const isLowQualityEntry = (quality) => normalizePeriodQuality(quality).includes('低质量进场');

const makeSignal = ({ direction, level, label, reasons, warnings = [] }) => ({
  direction,
  level,
  color: direction === 'long' ? 'success' : direction === 'short' ? 'error' : 'default',
  risk: level?.includes('trigger') ? 'medium' : 'low',
  confirmed: direction !== 'neutral',
  label,
  reasons,
  confirmations: [],
  warnings,
  description: reasons.slice(0, 3).join(' / '),
});

const OTC_UP_SIGNAL_MIN_INDEX = 1000;

function normalizeHistory(coin) {
  const rows = Array.isArray(coin?.history) ? [...coin.history] : [];
  const prevData = getPrevData(coin);

  rows.push({
    date: coin?.date,
    timestamp: coin?.timestamp,
    otc_index: coin?.otcIndex ?? coin?.otc_index,
    explosion_index: coin?.explosionIndex ?? coin?.explosion_index,
  });

  if (prevData) {
    rows.push(prevData);
  }

  const byDate = new Map();
  rows
    .filter(row => row?.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .forEach(row => {
      if (!byDate.has(row.date)) byDate.set(row.date, row);
    });

  return [...byDate.values()];
}

function getOtcTrend(historyRows) {
  const recent = historyRows.slice(0, 3);
  if (recent.length < 3) return null;

  const [current, previous, beforePrevious] = recent.map(row => toNumber(getField(row, 'otcIndex', 'otc_index')));
  if ([current, previous, beforePrevious].some(value => value === null)) return null;

  if (current > previous && previous > beforePrevious) return 'up';
  if (current < previous && previous < beforePrevious) return 'down';
  return null;
}

function isOtcUpSignal(historyRows) {
  const recent = historyRows.slice(0, 3);
  if (recent.length < 3) return false;

  const [current, previous, beforePrevious] = recent.map(row => toNumber(getField(row, 'otcIndex', 'otc_index')));
  if ([current, previous, beforePrevious].some(value => value === null)) return false;

  return current > OTC_UP_SIGNAL_MIN_INDEX
    && previous > OTC_UP_SIGNAL_MIN_INDEX
    && beforePrevious > OTC_UP_SIGNAL_MIN_INDEX
    && current > previous
    && previous > beforePrevious;
}

export function evaluateStrategySignal(coin) {
  const backendSignal = normalizeBackendSignal(coin?.strategySignal || coin?.strategy_signal);
  if (backendSignal) return backendSignal;

  const riskNotes = getRiskNotes(coin);
  if (!coin) {
    return {
      direction: 'neutral',
      color: 'default',
      label: '数据不足',
      reasons: [],
      confirmations: [],
      warnings: ['缺少币种数据'],
    };
  }

  const prevData = getPrevData(coin);
  const prevExplosion = toNumber(getField(prevData, 'explosionIndex', 'explosion_index'));
  const currExplosion = toNumber(coin.explosionIndex ?? coin.explosion_index);
  const entryExitType = coin.entryExitType ?? coin.entry_exit_type;
  const entryExitDay = Number(coin.entryExitDay ?? coin.entry_exit_day ?? 0);
  const quality = normalizePeriodQuality(coin.period_quality);
  const historyRows = normalizeHistory(coin);
  const otcTrend = getOtcTrend(historyRows);

  const candidates = [];
  if (otcTrend === 'down') {
    candidates.push(makeSignal({
      direction: 'short',
      level: 'otc_down_3',
      label: '做空：场外三连降',
      reasons: ['场外指数连续3天下降'],
      warnings: riskNotes,
    }));
  }

  const shortTriggerReasons = [];
  const brokeBelow200 = prevExplosion !== null && currExplosion !== null && prevExplosion >= 200 && currExplosion < 200;
  if (brokeBelow200 && isLowQualityEntry(quality)) {
    shortTriggerReasons.push('爆破指数跌破200', quality);
  }
  if (entryExitType === 'exit' && entryExitDay === 1) {
    shortTriggerReasons.push('退场期第一天');
  }
  if (shortTriggerReasons.length > 0) {
    candidates.push(makeSignal({
      direction: 'short',
      level: 'short_trigger',
      label: '做空：触发',
      reasons: shortTriggerReasons,
      warnings: riskNotes,
    }));
  }

  if (isOtcUpSignal(historyRows)) {
    candidates.push(makeSignal({
      direction: 'long',
      level: 'otc_up_3',
      label: '做多：场外三连升',
      reasons: ['场外指数连续3天大于1000且上升'],
      warnings: riskNotes,
    }));
  }

  const longTriggerReasons = [];
  // 由负转正按字面：小于 0 变成大于等于 0，与后端一致
  if (prevExplosion !== null && currExplosion !== null && prevExplosion < 0 && currExplosion >= 0) {
    longTriggerReasons.push('爆破指数负转正');
  }
  if (entryExitType === 'entry' && entryExitDay === 1) {
    longTriggerReasons.push('进场期第一天');
  }
  if (longTriggerReasons.length > 0) {
    candidates.push(makeSignal({
      direction: 'long',
      level: 'long_trigger',
      label: '做多：触发',
      reasons: longTriggerReasons,
      warnings: riskNotes,
    }));
  }

  if (candidates.length > 0) {
    const priority = {
      short_trigger: 4,
      long_trigger: 3,
      otc_down_3: 2,
      otc_up_3: 2,
    };
    return candidates.sort((a, b) => (priority[b.level] || 0) - (priority[a.level] || 0))[0];
  }

  return {
    direction: 'neutral',
    color: 'default',
    label: currExplosion !== null && currExplosion < 200 ? '风险注意' : '观望',
    reasons: [],
    confirmations: [],
    warnings: riskNotes,
  };
}

export function hasStrategyDirection(coin, direction) {
  const signal = evaluateStrategySignal(coin);
  return signal.direction === direction;
}
