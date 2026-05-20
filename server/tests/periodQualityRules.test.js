const assert = require('assert');

const dataRouter = require('../routes/data');

const { calculatePeriodQualityForDate } = dataRouter.__qualityTestUtils;

async function assertQuality(date, expectedQuality, historicalMetrics) {
  const actualQuality = await calculatePeriodQualityForDate(1, date, historicalMetrics);
  assert.strictEqual(actualQuality, expectedQuality);
}

async function run() {
  const historicalMetrics = [
    { date: '2026-05-18', otc_index: 964, explosion_index: 11, entry_exit_type: 'entry' },
    { date: '2026-05-12', otc_index: 1406, explosion_index: 176, entry_exit_type: 'entry' },
    { date: '2026-05-11', otc_index: 1424, explosion_index: 204, entry_exit_type: 'entry' },
    { date: '2026-04-27', otc_index: 1545, explosion_index: 180, entry_exit_type: 'entry' },
    { date: '2026-04-24', otc_index: 1657, explosion_index: 201, entry_exit_type: 'entry' },
    { date: '2026-04-20', otc_index: 1245, explosion_index: 176, entry_exit_type: 'entry' },
    { date: '2026-04-17', otc_index: 1268, explosion_index: 204, entry_exit_type: 'entry' },
    { date: '2026-04-11', otc_index: 976, explosion_index: 212, entry_exit_type: 'entry' },
    { date: '2026-04-09', otc_index: 986, explosion_index: 194, entry_exit_type: 'exit' },
  ];

  await assertQuality('2026-05-12', '低质量进场', historicalMetrics.slice(1));
  await assertQuality('2026-05-18', '低质量进场', historicalMetrics);

  const nearFlatDipMetrics = [
    { date: '2026-04-22', otc_index: 1694, explosion_index: 240, entry_exit_type: 'entry' },
    { date: '2026-04-20', otc_index: 1245, explosion_index: 176, entry_exit_type: 'entry' },
    { date: '2026-04-17', otc_index: 1268, explosion_index: 204, entry_exit_type: 'entry' },
    { date: '2026-04-16', otc_index: 1268, explosion_index: 186, entry_exit_type: 'entry' },
    { date: '2026-04-15', otc_index: 1231, explosion_index: 204, entry_exit_type: 'entry' },
    { date: '2026-04-13', otc_index: 1031, explosion_index: 159, entry_exit_type: 'entry' },
    { date: '2026-04-11', otc_index: 976, explosion_index: 212, entry_exit_type: 'entry' },
    { date: '2026-04-09', otc_index: 986, explosion_index: 194, entry_exit_type: 'exit' },
  ];

  await assertQuality('2026-04-20', '观察型进场', nearFlatDipMetrics.slice(1));
  await assertQuality('2026-04-22', '观察型进场', nearFlatDipMetrics);

  const recoveryAfterWeakDipMetrics = [
    { date: '2026-03-10', otc_index: 1131, explosion_index: 253, entry_exit_type: 'entry' },
    { date: '2026-03-08', otc_index: 1011, explosion_index: 108, entry_exit_type: 'entry' },
    { date: '2026-03-07', otc_index: 881, explosion_index: 117, entry_exit_type: 'entry' },
    { date: '2026-03-06', otc_index: 921, explosion_index: 238, entry_exit_type: 'entry' },
    { date: '2026-03-05', otc_index: 1017, explosion_index: 301, entry_exit_type: 'entry' },
    { date: '2026-03-04', otc_index: 887, explosion_index: 265, entry_exit_type: 'exit' },
  ];

  await assertQuality('2026-03-08', '修复型进场', recoveryAfterWeakDipMetrics.slice(1));
  await assertQuality('2026-03-10', '修复型进场', recoveryAfterWeakDipMetrics);

  const recoveryWithPreviousCycleMetrics = [
    { date: '2026-03-19', otc_index: 1137, explosion_index: 116, entry_exit_type: 'entry' },
    { date: '2026-03-18', otc_index: 1291, explosion_index: 218, entry_exit_type: 'entry' },
    { date: '2026-03-17', otc_index: 1324, explosion_index: 242, entry_exit_type: 'entry' },
    { date: '2026-03-16', otc_index: 1304, explosion_index: 247, entry_exit_type: 'entry' },
    { date: '2026-03-14', otc_index: 1133, explosion_index: 186, entry_exit_type: 'entry' },
    { date: '2026-03-13', otc_index: 1096, explosion_index: 254, entry_exit_type: 'entry' },
    { date: '2026-03-11', otc_index: 1063, explosion_index: 190, entry_exit_type: 'entry' },
    { date: '2026-03-10', otc_index: 1131, explosion_index: 253, entry_exit_type: 'entry' },
    { date: '2026-03-08', otc_index: 1011, explosion_index: 108, entry_exit_type: 'entry' },
    { date: '2026-03-07', otc_index: 881, explosion_index: 117, entry_exit_type: 'entry' },
    { date: '2026-03-06', otc_index: 921, explosion_index: 238, entry_exit_type: 'entry' },
    { date: '2026-03-05', otc_index: 1017, explosion_index: 301, entry_exit_type: 'entry' },
    { date: '2026-03-04', otc_index: 887, explosion_index: 265, entry_exit_type: 'exit' },
    { date: '2026-01-17', otc_index: 1305, explosion_index: 197, entry_exit_type: 'entry' },
    { date: '2026-01-16', otc_index: 1300, explosion_index: 218, entry_exit_type: 'entry' },
  ];

  await assertQuality('2026-03-11', '修复型进场', recoveryWithPreviousCycleMetrics.slice(1));
  await assertQuality('2026-03-13', '修复型进场', recoveryWithPreviousCycleMetrics.slice(1));
  await assertQuality('2026-03-14', '高质量进场', recoveryWithPreviousCycleMetrics.slice(4));
  await assertQuality('2026-03-19', '低质量进场', recoveryWithPreviousCycleMetrics);

  const weakRecoveryMetrics = [
    { date: '2026-05-18', otc_index: 964, explosion_index: 11, entry_exit_type: 'entry' },
    { date: '2026-05-15', otc_index: 1343, explosion_index: 83, entry_exit_type: 'entry' },
    { date: '2026-05-14', otc_index: 1287, explosion_index: 125, entry_exit_type: 'entry' },
    { date: '2026-05-13', otc_index: 1258, explosion_index: 129, entry_exit_type: 'entry' },
    { date: '2026-05-12', otc_index: 1406, explosion_index: 176, entry_exit_type: 'entry' },
    { date: '2026-05-11', otc_index: 1424, explosion_index: 204, entry_exit_type: 'entry' },
    { date: '2026-04-27', otc_index: 1545, explosion_index: 180, entry_exit_type: 'entry' },
    { date: '2026-04-24', otc_index: 1657, explosion_index: 201, entry_exit_type: 'entry' },
    { date: '2026-04-11', otc_index: 976, explosion_index: 212, entry_exit_type: 'entry' },
    { date: '2026-04-09', otc_index: 986, explosion_index: 194, entry_exit_type: 'exit' },
  ];

  await assertQuality('2026-05-15', '低质量进场', weakRecoveryMetrics.slice(1));

  console.log('periodQualityRules.test.js passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
