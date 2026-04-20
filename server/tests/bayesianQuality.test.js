const assert = require('assert');

const dataRouter = require('../routes/data');

const {
  buildKeyNodeComparisons,
  scoreBayesianPeriodQuality,
  QUALITY_LOOKBACK_DAYS
} = dataRouter.__qualityTestUtils || {};

function run() {
  assert.strictEqual(
    typeof buildKeyNodeComparisons,
    'function',
    'buildKeyNodeComparisons should be exported for tests'
  );
  assert.strictEqual(
    typeof scoreBayesianPeriodQuality,
    'function',
    'scoreBayesianPeriodQuality should be exported for tests'
  );
  assert.strictEqual(
    QUALITY_LOOKBACK_DAYS,
    365,
    'latest and historical quality evaluation should share a 365-day window'
  );

  const entryComparisons = buildKeyNodeComparisons({
    phase: 'entry',
    beforeNode: { nodeNum: 2, date: '2025-05-27', otc_index: 1163 },
    startNode: { nodeNum: 3, date: '2025-06-25', otc_index: 835 },
    afterNodes: [
      { nodeNum: 4, date: '2025-07-01', otc_index: 995 }
    ]
  });

  assert.strictEqual(entryComparisons.length, 2, 'entry comparisons should include 2→3 and 3→4');
  assert.strictEqual(entryComparisons[0].fromLabel, '2爆破跌200');
  assert.strictEqual(entryComparisons[0].toLabel, '3进场期第一天');
  assert.ok(
    entryComparisons[0].changePercent < -20,
    '2→3 should capture the large OTC drop seen in the BTC repair-type entry'
  );
  assert.ok(
    entryComparisons[1].changePercent > 10,
    '3→4 should capture the OTC recovery after entry start'
  );

  const repairedEntry = scoreBayesianPeriodQuality({
    phase: 'entry',
    comparisons: entryComparisons
  });
  assert.strictEqual(repairedEntry.label, '修复型进场');
  assert.ok(repairedEntry.probability >= 0.55 && repairedEntry.probability < 0.75);

  const strongEntry = scoreBayesianPeriodQuality({
    phase: 'entry',
    comparisons: [
      { changePercent: 21.7 },
      { changePercent: 38.8 }
    ]
  });
  assert.strictEqual(strongEntry.label, '高质量进场');

  const weakExit = scoreBayesianPeriodQuality({
    phase: 'exit',
    comparisons: [
      { changePercent: 52.5 },
      { changePercent: -17.3 }
    ]
  });
  assert.strictEqual(weakExit.label, '修复型退场');

  const confirmedExit = scoreBayesianPeriodQuality({
    phase: 'exit',
    comparisons: [
      { changePercent: -28.9 },
      { changePercent: -6.5 }
    ]
  });
  assert.strictEqual(confirmedExit.label, '高质量退场');

  console.log('bayesianQuality.test.js passed');
}

run();
