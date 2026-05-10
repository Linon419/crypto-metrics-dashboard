const assert = require('assert');

const dataRouter = require('../routes/data');

const {
  normalizeMomentumIndicators,
  serializeMomentumIndicators,
} = dataRouter.__qualityTestUtils || {};

function run() {
  assert.strictEqual(
    typeof normalizeMomentumIndicators,
    'function',
    'normalizeMomentumIndicators should be exported for tests'
  );

  assert.deepStrictEqual(
    normalizeMomentumIndicators('*'),
    ['*'],
    'single asterisk should be preserved as a momentum indicator'
  );

  assert.deepStrictEqual(
    normalizeMomentumIndicators('["*", "※"]'),
    ['*', '※'],
    'stored JSON should round-trip to an indicator array'
  );

  assert.strictEqual(
    serializeMomentumIndicators('*'),
    '["*"]',
    'single asterisk should serialize as a JSON array'
  );

  console.log('momentumIndicators.test.js passed');
}

run();
