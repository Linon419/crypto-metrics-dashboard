const assert = require('assert');

const {
  getBayesianConditionKey,
  trainBayesianRuleModel,
} = require('../utils/btcBayesianSignals');

function run() {
  const row = {
    features: {
      explosion_index: 240,
      otc_index: 1600,
      otc_up_3d: 1,
      explosion_cross_down_200: 0,
      early_entry_period: 1,
      middle_entry_period: 0,
      late_entry_period: 0,
      early_exit_period: 0,
      middle_exit_period: 0,
      late_exit_period: 0,
    },
    target_up: 1,
  };

  assert.strictEqual(
    getBayesianConditionKey(row),
    'explosion_above_200|otc_above_1500|otc_up_3d|entry_1_7'
  );

  const model = trainBayesianRuleModel([
    row,
    { ...row, target_up: 1 },
    { ...row, target_up: 0 },
    {
      features: {
        explosion_index: 120,
        otc_index: 900,
        otc_up_3d: 0,
        explosion_cross_down_200: 1,
        early_entry_period: 0,
        middle_entry_period: 0,
        late_entry_period: 0,
        early_exit_period: 1,
        middle_exit_period: 0,
        late_exit_period: 0,
      },
      target_up: 0,
    },
  ]);

  const prediction = model.predict(row);

  assert.strictEqual(prediction.sampleSize, 3);
  assert.strictEqual(prediction.upCount, 2);
  assert.ok(Math.abs(prediction.probability - 0.6) < 0.00001);
  assert.ok(prediction.explanation.includes('爆破>200'));
  assert.ok(prediction.explanation.includes('进场期1-7天'));

  console.log('btcBayesianSignals.test.js passed');
}

run();
