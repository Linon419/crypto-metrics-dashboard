import {
  filterOptionsStrategies,
  getOptionsFilterCounts,
  normalizeOptionsSearch,
} from './optionsKnowledge';

const strategies = [
  {
    id: 'iron-condor',
    nameZh: '铁鹰策略',
    nameEn: 'iron condor',
    marketStates: ['区间震荡'],
    strategyTypes: ['卖出波动率', '区间结构'],
    coreGreeks: ['theta', 'vega'],
    sourceLessons: ['day11'],
  },
  {
    id: 'long-straddle',
    nameZh: '买入跨式',
    nameEn: 'long straddle',
    marketStates: ['波动率开始上升'],
    strategyTypes: ['买入波动率'],
    coreGreeks: ['gamma', 'vega'],
    sourceLessons: ['day3'],
  },
];

test('normalizes search text', () => {
  expect(normalizeOptionsSearch('  Iron  Condor ')).toBe('iron condor');
});

test('filters by market state and strategy type', () => {
  const result = filterOptionsStrategies(strategies, {
    marketState: '区间震荡',
    strategyType: '卖出波动率',
    searchTerm: '',
  });

  expect(result.map(item => item.id)).toEqual(['iron-condor']);
});

test('searches names greeks and lessons', () => {
  expect(filterOptionsStrategies(strategies, { searchTerm: 'gamma' }).map(item => item.id)).toEqual(['long-straddle']);
  expect(filterOptionsStrategies(strategies, { searchTerm: '铁鹰' }).map(item => item.id)).toEqual(['iron-condor']);
  expect(filterOptionsStrategies(strategies, { searchTerm: 'day11' }).map(item => item.id)).toEqual(['iron-condor']);
});

test('computes filter counts', () => {
  const counts = getOptionsFilterCounts(strategies);
  expect(counts.marketStates['区间震荡']).toBe(1);
  expect(counts.strategyTypes['买入波动率']).toBe(1);
});
