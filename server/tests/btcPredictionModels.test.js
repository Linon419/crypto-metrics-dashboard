const assert = require('assert');

const {
  evaluateBinaryPredictions,
  pickBestModelResult,
} = require('../utils/btcPredictionModels');

function run() {
  const metrics = evaluateBinaryPredictions([
    { yTrue: 1, probability: 0.8, futureReturn: 0.05 },
    { yTrue: 1, probability: 0.7, futureReturn: 0.03 },
    { yTrue: 0, probability: 0.65, futureReturn: -0.02 },
    { yTrue: 0, probability: 0.2, futureReturn: -0.01 },
  ]);

  assert.strictEqual(metrics.total, 4);
  assert.strictEqual(metrics.signalCount, 3);
  assert.ok(metrics.accuracy > 0.7);
  assert.ok(metrics.precisionAtThreshold > 0.6);
  assert.ok(metrics.averageReturnWhenSignal > 0);
  assert.ok(metrics.auc >= 0.75);

  const best = pickBestModelResult([
    { modelName: 'A', horizon: 3, metrics: { precisionAtThreshold: 0.5, signalCount: 10, f1: 0.7, auc: 0.6 } },
    { modelName: 'B', horizon: 3, metrics: { precisionAtThreshold: 0.7, signalCount: 4, f1: 0.6, auc: 0.7 } },
    { modelName: 'C', horizon: 5, metrics: { precisionAtThreshold: 0.65, signalCount: 12, f1: 0.8, auc: 0.8 } },
  ]);

  assert.strictEqual(best.modelName, 'C');
  assert.strictEqual(best.horizon, 5);

  console.log('btcPredictionModels.test.js passed');
}

run();
