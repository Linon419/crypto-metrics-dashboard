const assert = require('assert');

const {
  AdminDateRecordError,
  deleteDateRecords,
  getDateRecordSummary,
  normalizeDateParam,
  parseDateTimeUpdate,
  updateDateRecordTime,
} = require('../utils/adminDateRecords');

function assertValidationError(fn, message) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof AdminDateRecordError, message);
}

function createFakeModel(count) {
  const calls = {
    count: [],
    update: [],
    destroy: [],
  };

  return {
    calls,
    count: async (options) => {
      calls.count.push(options);
      return count;
    },
    update: async (payload, options) => {
      calls.update.push({ payload, options });
      return [count];
    },
    destroy: async (options) => {
      calls.destroy.push(options);
      return count;
    },
  };
}

function createFakeModels() {
  return {
    DailyMetric: createFakeModel(2),
    LiquidityOverview: createFakeModel(1),
    TrendingCoin: createFakeModel(3),
  };
}

async function run() {
  assert.strictEqual(normalizeDateParam('2026-05-18'), '2026-05-18');
  assertValidationError(() => normalizeDateParam('2026/05/18'), 'slashes should fail');
  assertValidationError(
    () => parseDateTimeUpdate({ date: '2026-02-30', timePrecision: 'day' }),
    'invalid calendar date should fail'
  );

  const minuteUpdate = parseDateTimeUpdate({
    date: '2026-05-18',
    time: '23:01',
    timePrecision: 'minute',
  });

  assert.strictEqual(minuteUpdate.date, '2026-05-18');
  assert.strictEqual(minuteUpdate.time_precision, 'minute');
  assert.strictEqual(minuteUpdate.timestamp.getFullYear(), 2026);
  assert.strictEqual(minuteUpdate.timestamp.getMonth(), 4);
  assert.strictEqual(minuteUpdate.timestamp.getDate(), 18);
  assert.strictEqual(minuteUpdate.timestamp.getHours(), 23);
  assert.strictEqual(minuteUpdate.timestamp.getMinutes(), 1);

  const hourUpdate = parseDateTimeUpdate({
    date: '2026-05-18',
    time: '9',
    timePrecision: 'hour',
  });

  assert.strictEqual(hourUpdate.time_precision, 'hour');
  assert.strictEqual(hourUpdate.timestamp.getHours(), 9);
  assert.strictEqual(hourUpdate.timestamp.getMinutes(), 0);

  const dayUpdate = parseDateTimeUpdate({
    date: '2026-05-18',
    timePrecision: 'day',
  });

  assert.strictEqual(dayUpdate.time_precision, 'day');
  assert.strictEqual(dayUpdate.timestamp.getHours(), 0);
  assert.strictEqual(dayUpdate.timestamp.getMinutes(), 0);

  assertValidationError(
    () => parseDateTimeUpdate({ date: '2026-05-18', time: '25:01', timePrecision: 'minute' }),
    'invalid hour should fail'
  );
  assertValidationError(
    () => parseDateTimeUpdate({ date: '2026-05-18', time: '23:99', timePrecision: 'minute' }),
    'invalid minute should fail'
  );
  assertValidationError(
    () => parseDateTimeUpdate({ date: '2026-05-18', time: '', timePrecision: 'hour' }),
    'missing hour time should fail'
  );

  const summaryModels = createFakeModels();
  const summary = await getDateRecordSummary(summaryModels, '2026-05-18');
  assert.deepStrictEqual(summary.counts, {
    dailyMetrics: 2,
    liquidityOverviews: 1,
    trendingCoins: 3,
    total: 6,
  });
  assert.deepStrictEqual(summaryModels.DailyMetric.calls.count[0].where, { date: '2026-05-18' });

  const transaction = { id: 'tx-1' };
  const updateModels = createFakeModels();
  const updateResult = await updateDateRecordTime(updateModels, {
    date: '2026-05-18',
    time: '23:01',
    timePrecision: 'minute',
    transaction,
  });
  assert.strictEqual(updateResult.updated.total, 6);
  assert.strictEqual(updateModels.DailyMetric.calls.update[0].payload.time_precision, 'minute');
  assert.strictEqual(updateModels.DailyMetric.calls.update[0].options.transaction, transaction);
  assert.strictEqual(updateModels.DailyMetric.calls.update[0].options.where.date, '2026-05-18');

  const deleteModels = createFakeModels();
  const deleteResult = await deleteDateRecords(deleteModels, {
    date: '2026-05-18',
    transaction,
  });
  assert.strictEqual(deleteResult.deleted.total, 6);
  assert.strictEqual(deleteModels.TrendingCoin.calls.destroy[0].transaction, transaction);
  assert.deepStrictEqual(deleteModels.TrendingCoin.calls.destroy[0].where, { date: '2026-05-18' });

  console.log('adminDateRecords.test.js passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
