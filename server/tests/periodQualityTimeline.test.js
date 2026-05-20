const assert = require('assert');

const {
  attachPeriodQualityToMetrics,
} = require('../utils/periodQualityTimeline');

async function run() {
  const historicalMetrics = [
    { id: 1, date: '2026-01-01', timestamp: '2026-01-01T08:00:00.000Z' },
    { id: 2, date: '2026-01-01', timestamp: '2026-01-01T10:00:00.000Z' },
    { id: 3, date: '2026-01-01', timestamp: '2026-01-01T12:00:00.000Z' },
    { id: 4, date: '2026-01-02', timestamp: '2026-01-02T09:00:00.000Z' },
    { id: 5, date: '2026-01-03', timestamp: '2026-01-03T09:00:00.000Z' },
  ];
  const visibleMetrics = [historicalMetrics[1], historicalMetrics[2], historicalMetrics[3]];
  const calls = [];

  const annotated = await attachPeriodQualityToMetrics(visibleMetrics, {
    coinId: 1,
    historicalMetrics,
    calculatePeriodQualityForDate: async (_coinId, targetDate, history) => {
      calls.push({ targetDate, historyIds: history.map(metric => metric.id) });
      return `Q-${history[0].id}`;
    },
  });

  assert.deepStrictEqual(
    annotated.map(metric => metric.period_quality),
    ['Q-2', 'Q-3', 'Q-4']
  );
  assert.deepStrictEqual(calls[0].historyIds, [2, 1]);
  assert.deepStrictEqual(calls[1].historyIds, [3, 2, 1]);
  assert.deepStrictEqual(calls[2].historyIds, [4, 3, 2, 1]);

  console.log('periodQualityTimeline.test.js passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
