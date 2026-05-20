const assert = require('assert');

const { buildPeriodRiskNotes } = require('../utils/periodRiskNotes');

function run() {
  const hotEntryNotes = buildPeriodRiskNotes({
    entry_exit_type: 'entry',
    entry_exit_day: 1,
    explosion_index: 327,
  });

  assert.deepStrictEqual(
    hotEntryNotes,
    ['进场首日爆破高于200，短线偏热'],
    'entry day 1 with explosion above 200 should be a risk note'
  );

  assert.deepStrictEqual(
    buildPeriodRiskNotes({
      entry_exit_type: 'entry',
      entry_exit_day: 2,
      explosion_index: 327,
    }),
    [],
    'later entry days should wait for key-node quality checks'
  );

  assert.deepStrictEqual(
    buildPeriodRiskNotes({
      entry_exit_type: 'entry',
      entry_exit_day: 1,
      explosion_index: 200,
    }),
    [],
    'entry day 1 at 200 should not be treated as hot'
  );

  console.log('periodRiskNotes.test.js passed');
}

run();
