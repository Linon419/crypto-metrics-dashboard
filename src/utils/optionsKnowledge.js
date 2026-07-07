export const MARKET_STATE_FILTERS = [
  '波动率开始上升',
  '低 IV + 高 RV 预期',
  '高 IV + 预期回落',
  '区间震荡',
  '近端横盘 + 远端保留波动',
  '单边趋势开始',
  '已有底仓需要保护',
  '偏多合成与结构增强',
];

export const STRATEGY_TYPE_FILTERS = [
  '买入波动率',
  '卖出波动率',
  '买入方向',
  '卖方收租',
  '时间结构',
  '区间结构',
  '趋势价差',
  '底仓保护',
  '合成多头',
  '课程组合结构',
];

export function normalizeOptionsSearch(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function includesValue(values = [], selected) {
  return !selected || values.includes(selected);
}

function buildSearchText(strategy) {
  return [
    strategy.nameZh,
    strategy.nameEn,
    ...(strategy.marketStates || []),
    ...(strategy.strategyTypes || []),
    ...(strategy.coreGreeks || []),
    ...(strategy.sourceLessons || []),
    ...(strategy.keywords || []),
  ].join(' ').toLowerCase();
}

export function filterOptionsStrategies(strategies = [], filters = {}) {
  const searchTerm = normalizeOptionsSearch(filters.searchTerm);
  return strategies.filter(strategy => {
    if (!includesValue(strategy.marketStates, filters.marketState)) return false;
    if (!includesValue(strategy.strategyTypes, filters.strategyType)) return false;
    if (!searchTerm) return true;
    return buildSearchText(strategy).includes(searchTerm);
  });
}

export function getOptionsFilterCounts(strategies = []) {
  return strategies.reduce((counts, strategy) => {
    (strategy.marketStates || []).forEach(state => {
      counts.marketStates[state] = (counts.marketStates[state] || 0) + 1;
    });
    (strategy.strategyTypes || []).forEach(type => {
      counts.strategyTypes[type] = (counts.strategyTypes[type] || 0) + 1;
    });
    return counts;
  }, { marketStates: {}, strategyTypes: {} });
}
