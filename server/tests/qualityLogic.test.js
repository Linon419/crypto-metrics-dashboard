const assert = require('assert');

const { classifyPeriodQuality } = require('../utils/periodQuality');

function classify(phase, changes) {
  return classifyPeriodQuality({
    phase,
    comparisons: changes.map((changePercent) => ({ changePercent })),
  });
}

function run() {
  assert.strictEqual(classify('entry', [0.1]).label, '高质量进场');
  assert.strictEqual(classify('entry', [15, 20, 5]).label, '高质量进场');
  assert.strictEqual(classify('entry', [15, 0]).label, '低质量进场');
  assert.strictEqual(classify('entry', [15, -0.1]).label, '低质量进场');

  assert.strictEqual(classify('exit', [-0.1]).label, '高质量退场');
  assert.strictEqual(classify('exit', [-15, -20, -5]).label, '高质量退场');
  assert.strictEqual(classify('exit', [-15, 0]).label, '低质量退场');
  assert.strictEqual(classify('exit', [-15, 0.1]).label, '低质量退场');

  assert.strictEqual(classify('entry', []).label, '数据不足');
  assert.strictEqual(classify('unknown', [10]).label, '数据不足');

  console.log('qualityLogic.test.js passed');
}

run();
