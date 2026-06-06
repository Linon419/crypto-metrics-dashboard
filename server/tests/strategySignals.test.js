const assert = require('assert');
const {
  evaluateStrategySignal,
  hasStrategyDirection,
} = require('../utils/strategySignals');

function makeMetric(overrides = {}) {
  return {
    symbol: 'TEST',
    date: '2026-06-06',
    otcIndex: 100,
    explosionIndex: 100,
    entryExitType: 'neutral',
    entryExitDay: 0,
    period_quality: '数据不足',
    previousDayData: {
      date: '2026-06-05',
      otc_index: 100,
      explosion_index: 100,
    },
    ...overrides,
  };
}

function history(...rows) {
  return rows.map(row => ({
    date: row.date,
    otc_index: row.otc,
    explosion_index: row.explosion,
    entry_exit_type: row.type || 'neutral',
    entry_exit_day: row.day || 0,
    period_quality: row.quality || '数据不足',
  }));
}

function testLongOnThreeDayOtcRise() {
  const coin = makeMetric({
    otcIndex: 1300,
    explosionIndex: 120,
    history: history(
      { date: '2026-06-06', otc: 1300, explosion: 120 },
      { date: '2026-06-05', otc: 1200, explosion: 110 },
      { date: '2026-06-04', otc: 1100, explosion: 105 }
    ),
  });

  const signal = evaluateStrategySignal(coin);
  assert.strictEqual(signal.direction, 'long');
  assert.strictEqual(signal.level, 'otc_up_3');
  assert.ok(signal.reasons.includes('场外指数连续3天大于1000且上升'));
  assert.strictEqual(hasStrategyDirection(coin, 'long'), true);
}

function testLongOtcRiseRequiresThreeDaysAbove1000() {
  const coin = makeMetric({
    otcIndex: 1001,
    explosionIndex: 120,
    history: history(
      { date: '2026-06-06', otc: 1001, explosion: 120 },
      { date: '2026-06-05', otc: 995, explosion: 110 },
      { date: '2026-06-04', otc: 990, explosion: 105 }
    ),
  });

  const signal = evaluateStrategySignal(coin);
  assert.strictEqual(signal.direction, 'neutral');
}

function testLongOnExplosionFlipOrEntryFirstDay() {
  const flipSignal = evaluateStrategySignal(makeMetric({
    explosionIndex: 8,
    previousDayData: { otc_index: 100, explosion_index: -5 },
  }));
  assert.strictEqual(flipSignal.direction, 'long');
  assert.strictEqual(flipSignal.level, 'long_trigger');
  assert.ok(flipSignal.reasons.includes('爆破指数负转正'));

  const entryStartSignal = evaluateStrategySignal(makeMetric({
    entryExitType: 'entry',
    entryExitDay: 1,
  }));
  assert.strictEqual(entryStartSignal.direction, 'long');
  assert.strictEqual(entryStartSignal.level, 'long_trigger');
  assert.ok(entryStartSignal.reasons.includes('进场期第一天'));
}

function testShortOnThreeDayOtcDecline() {
  const coin = makeMetric({
    otcIndex: 90,
    explosionIndex: 220,
    history: history(
      { date: '2026-06-06', otc: 90, explosion: 220 },
      { date: '2026-06-05', otc: 100, explosion: 230 },
      { date: '2026-06-04', otc: 110, explosion: 240 }
    ),
  });

  const signal = evaluateStrategySignal(coin);
  assert.strictEqual(signal.direction, 'short');
  assert.strictEqual(signal.level, 'otc_down_3');
  assert.ok(signal.reasons.includes('场外指数连续3天下降'));
  assert.strictEqual(hasStrategyDirection(coin, 'short'), true);
}

function testShortOnBreakBelow200AndLowQualityEntry() {
  const signal = evaluateStrategySignal(makeMetric({
    explosionIndex: 150,
    period_quality: '低质量进场',
    previousDayData: { otc_index: 100, explosion_index: 220 },
  }));

  assert.strictEqual(signal.direction, 'short');
  assert.strictEqual(signal.level, 'short_trigger');
  assert.ok(signal.reasons.includes('爆破指数跌破200'));
  assert.ok(signal.reasons.includes('低质量进场'));
}

function testShortOnExitFirstDay() {
  const signal = evaluateStrategySignal(makeMetric({
    explosionIndex: 260,
    entryExitType: 'exit',
    entryExitDay: 1,
  }));

  assert.strictEqual(signal.direction, 'short');
  assert.strictEqual(signal.level, 'short_trigger');
  assert.ok(signal.reasons.includes('退场期第一天'));
}

function testBreakBelow200WithoutLowQualityEntryStaysNeutral() {
  const signal = evaluateStrategySignal(makeMetric({
    explosionIndex: 150,
    period_quality: '高质量进场',
    previousDayData: { otc_index: 100, explosion_index: 220 },
  }));

  assert.strictEqual(signal.direction, 'neutral');
}

testLongOnThreeDayOtcRise();
testLongOtcRiseRequiresThreeDaysAbove1000();
testLongOnExplosionFlipOrEntryFirstDay();
testShortOnThreeDayOtcDecline();
testShortOnBreakBelow200AndLowQualityEntry();
testShortOnExitFirstDay();
testBreakBelow200WithoutLowQualityEntryStaysNeutral();

console.log('strategySignals.test.js passed');
