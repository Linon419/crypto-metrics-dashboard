const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDbPath = path.join(os.tmpdir(), `option-tuning-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
process.env.DB_STORAGE = tempDbPath;

const dataRouter = require('../routes/data');
const { OptionTuning, sequelize } = require('../models');

const {
  normalizeOptionTuning,
  serializeOptionTuning,
  storeProcessedData,
} = dataRouter.__optionTuningTestUtils || {};

async function run() {
  assert.strictEqual(
    typeof normalizeOptionTuning,
    'function',
    'normalizeOptionTuning should be exported for tests'
  );

  const normalized = normalizeOptionTuning({
    deltaTarget: 'delta调为中性',
    vegaTarget: 'vega 正数',
    strategy: '组成 iron condor',
    rawText: 'delta调为中性\nvega 正数\n组成 iron condor',
  });

  assert.deepStrictEqual(normalized, {
    delta_target: 'neutral',
    vega_target: 'positive',
    strategy: 'iron_condor',
    raw_text: 'delta调为中性\nvega 正数\n组成 iron condor',
  });

  assert.deepStrictEqual(
    normalizeOptionTuning({
      deltaTarget: 'delta调为中性',
      vegaTarget: 'vega 正数',
      strategy: '组成 gamma squeeze',
      rawText: 'delta调为中性\nvega 正数\n组成 gamma squeeze',
    }),
    {
      delta_target: 'neutral',
      vega_target: 'positive',
      strategy: 'gamma_squeeze',
      raw_text: 'delta调为中性\nvega 正数\n组成 gamma squeeze',
    }
  );

  assert.strictEqual(
    normalizeOptionTuning({
      deltaTarget: 'neutral',
      vegaTarget: 'positive',
      rawText: '期权调参\ndelta调为中性\nvega 正数\n组成 gamma squeeze',
    }).strategy,
    'gamma_squeeze'
  );

  assert.strictEqual(
    normalizeOptionTuning({ strategy: '组成 long straddle' }).strategy,
    'long_straddle'
  );

  assert.deepStrictEqual(
    serializeOptionTuning({
      delta_target: 'neutral',
      vega_target: 'positive',
      strategy: 'iron_condor',
      raw_text: 'delta调为中性',
    }),
    {
      deltaTarget: 'neutral',
      vegaTarget: 'positive',
      strategy: 'iron_condor',
      rawText: 'delta调为中性',
    }
  );

  const uniqueIndexes = OptionTuning.options.indexes.filter(index => index.unique);
  const hasTimestampUniqueIndex = uniqueIndexes.some(index => (
    JSON.stringify(index.fields) === JSON.stringify(['date', 'timestamp'])
  ));

  assert.strictEqual(hasTimestampUniqueIndex, true);

  assert.strictEqual(
    typeof storeProcessedData,
    'function',
    'storeProcessedData should be exported for option tuning storage tests'
  );

  await sequelize.sync({ force: true });
  await storeProcessedData({
    date: '2026-06-17 14:30',
    coins: [
      {
        symbol: 'BTC',
        otcIndex: 373,
        explosionIndex: -66,
        entryExitType: 'exit',
        entryExitDay: 17,
      },
    ],
    optionTuning: {
      deltaTarget: 'delta调为中性',
      vegaTarget: 'vega 正数',
      strategy: '组成 gamma squeeze',
      rawText: '期权调参\ndelta调为中性\nvega 正数\n组成 gamma squeeze',
    },
  });

  const saved = await OptionTuning.findOne({ where: { date: '2026-06-17' }, raw: true });
  assert.strictEqual(saved.delta_target, 'neutral');
  assert.strictEqual(saved.vega_target, 'positive');
  assert.strictEqual(saved.strategy, 'gamma_squeeze');
  assert.strictEqual(saved.time_precision, 'minute');

  await sequelize.close();
  fs.rmSync(tempDbPath, { force: true });
  console.log('optionTuning.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
