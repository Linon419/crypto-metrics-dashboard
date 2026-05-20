const assert = require('assert');

const {
  PatchValidationError,
  buildFieldDiff,
  validateDatabasePatch,
} = require('../utils/databasePatch');

function assertValidationError(fn, message) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof PatchValidationError, message);
}

function run() {
  const normalized = validateDatabasePatch({
    reason: '修正 BTC 2026-05-18 完整时间',
    operations: [
      {
        table: 'DailyMetrics',
        match: {
          symbol: 'btc',
          date: '2026-05-18',
        },
        set: {
          timestamp: '2026-05-18T23:01:00+10:00',
          time_precision: 'minute',
          explosion_index: 11,
        },
      },
    ],
  });

  assert.strictEqual(normalized.reason, '修正 BTC 2026-05-18 完整时间');
  assert.strictEqual(normalized.operations[0].table, 'DailyMetrics');
  assert.deepStrictEqual(normalized.operations[0].match, {
    symbol: 'BTC',
    date: '2026-05-18',
  });
  assert.strictEqual(normalized.operations[0].set.time_precision, 'minute');
  assert.ok(normalized.operations[0].set.timestamp instanceof Date);

  assertValidationError(
    () => validateDatabasePatch({
      reason: 'bad field',
      operations: [
        {
          table: 'DailyMetrics',
          match: { symbol: 'BTC', date: '2026-05-18' },
          set: { id: 123 },
        },
      ],
    }),
    'id should be rejected as an update field'
  );

  assertValidationError(
    () => validateDatabasePatch({
      reason: 'wide update',
      operations: [
        {
          table: 'DailyMetrics',
          match: { date: '2026-05-18' },
          set: { explosion_index: 11 },
        },
      ],
    }),
    'DailyMetrics should require symbol + date exact match'
  );

  const diff = buildFieldDiff(
    {
      timestamp: new Date('2026-05-18T00:00:00Z'),
      time_precision: 'day',
      explosion_index: 11,
    },
    {
      timestamp: new Date('2026-05-18T13:01:00Z'),
      time_precision: 'minute',
      explosion_index: 11,
    }
  );

  assert.deepStrictEqual(diff, {
    timestamp: {
      before: '2026-05-18T00:00:00.000Z',
      after: '2026-05-18T13:01:00.000Z',
    },
    time_precision: {
      before: 'day',
      after: 'minute',
    },
  });

  console.log('databasePatch.test.js passed');
}

run();
