const assert = require('assert');

const {
  buildPeriodStateFeatures,
} = require('../utils/btcPeriodStateFeatures');
const {
  buildBtcPredictionRows,
  buildLatestFeatureRow,
} = require('../utils/btcPredictionFeatures');

function run() {
  const lateEntry = buildPeriodStateFeatures({
    entry_exit_type: 'entry',
    entry_exit_day: 34,
  });

  assert.strictEqual(lateEntry.is_entry_period, 1);
  assert.strictEqual(lateEntry.is_exit_period, 0);
  assert.strictEqual(lateEntry.late_entry_period, 1);
  assert.strictEqual(lateEntry.entry_day_bucket, 'entry_31_plus');
  assert.strictEqual(lateEntry.period_state_label, '进场期第31天以后');

  const earlyExit = buildPeriodStateFeatures({
    entry_exit_type: 'exit',
    entry_exit_day: 4,
  });

  assert.strictEqual(earlyExit.is_entry_period, 0);
  assert.strictEqual(earlyExit.is_exit_period, 1);
  assert.strictEqual(earlyExit.early_exit_period, 1);
  assert.strictEqual(earlyExit.exit_day_bucket, 'exit_1_7');

  const metrics = [
    { date: '2026-01-01', otc_index: 1000, explosion_index: 100, schelling_point: 100, btc_publish_price: 1000, entry_exit_type: 'entry', entry_exit_day: 1 },
    { date: '2026-01-02', otc_index: 1010, explosion_index: 150, schelling_point: 103, btc_publish_price: 1010, entry_exit_type: 'entry', entry_exit_day: 2 },
    { date: '2026-01-03', otc_index: 1050, explosion_index: 210, schelling_point: 102, btc_publish_price: 1020, entry_exit_type: 'entry', entry_exit_day: 3 },
    { date: '2026-01-04', otc_index: 1040, explosion_index: 190, schelling_point: 106, btc_publish_price: 1100, entry_exit_type: 'entry', entry_exit_day: 4 },
    { date: '2026-01-05', otc_index: 1080, explosion_index: 220, schelling_point: 110, btc_publish_price: 1080, entry_exit_type: 'entry', entry_exit_day: 5 },
    { date: '2026-01-06', otc_index: 1070, explosion_index: 180, schelling_point: 111, btc_publish_price: 1070, entry_exit_type: 'entry', entry_exit_day: 6 },
    { date: '2026-01-07', otc_index: 1090, explosion_index: 240, schelling_point: 90, btc_publish_price: 1210, entry_exit_type: 'entry', entry_exit_day: 7 },
    { date: '2026-01-08', otc_index: 1110, explosion_index: 260, schelling_point: 115, btc_publish_price: 1200, entry_exit_type: 'entry', entry_exit_day: 8 },
    { date: '2026-01-09', otc_index: 1120, explosion_index: 230, schelling_point: null, btc_publish_price: null, entry_exit_type: 'entry', entry_exit_day: 9 },
  ];

  const rows = buildBtcPredictionRows(metrics, { horizons: [1, 3] });

  assert.ok(rows.length > 0);
  assert.ok(rows.every(row => row.schelling_point !== null));
  assert.ok(rows.every(row => row.target_horizon === 1 || row.target_horizon === 3));
  assert.ok(rows.some(row => row.target_horizon === 3 && row.date === '2026-01-04'));

  const targetRow = rows.find(row => row.date === '2026-01-04' && row.target_horizon === 3);
  assert.strictEqual(targetRow.future_date, '2026-01-07');
  assert.strictEqual(targetRow.target_up, 1);
  assert.strictEqual(targetRow.btc_publish_price, 1100);
  assert.strictEqual(targetRow.future_btc_publish_price, 1210);
  assert.strictEqual(targetRow.future_schelling_point, 90);
  assert.ok(Math.abs(targetRow.future_return - 0.1) < 0.000001);
  assert.ok(targetRow.features.explosion_cross_down_200);
  assert.strictEqual(targetRow.features.is_entry_period, 1);
  assert.ok(Number.isFinite(targetRow.features.otc_ma_3));

  const latestFeature = buildLatestFeatureRow(metrics);
  assert.strictEqual(latestFeature.date, '2026-01-08');
  assert.strictEqual(latestFeature.features.early_entry_period, 0);
  assert.strictEqual(latestFeature.features.middle_entry_period, 1);
  assert.strictEqual(latestFeature.periodState.entry_day_bucket, 'entry_8_30');

  const duplicateDayRows = buildBtcPredictionRows([
    {
      date: '2026-02-01',
      timestamp: '2026-02-01T08:00:00.000Z',
      otc_index: 1000,
      explosion_index: 100,
      schelling_point: 100,
      btc_publish_price: 1000,
      entry_exit_type: 'entry',
      entry_exit_day: 1,
    },
    {
      date: '2026-02-01',
      timestamp: '2026-02-01T12:00:00.000Z',
      otc_index: 1005,
      explosion_index: 110,
      schelling_point: 101,
      btc_publish_price: 1005,
      entry_exit_type: 'entry',
      entry_exit_day: 1,
    },
    {
      date: '2026-02-02',
      timestamp: '2026-02-02T09:00:00.000Z',
      otc_index: 1010,
      explosion_index: 120,
      schelling_point: 102,
      btc_publish_price: 1100,
      entry_exit_type: 'entry',
      entry_exit_day: 2,
    },
  ], { horizons: [1] });

  const firstVersionTarget = duplicateDayRows.find(row => row.date === '2026-02-01' && row.timestamp === '2026-02-01T08:00:00.000Z');
  assert.strictEqual(firstVersionTarget.future_date, '2026-02-02');
  assert.strictEqual(firstVersionTarget.future_btc_publish_price, 1100);

  console.log('btcPredictionFeatures.test.js passed');
}

run();
