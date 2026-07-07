const assert = require('assert');

const {
  OPTIONS_STRATEGY_CATALOG,
} = require('../optionsStrategyCatalog');

function testCatalogIntegrity() {
  const requiredIds = [
    'long-straddle',
    'short-strangle',
    'calendar-spread',
    'diagonal-spread',
    'butterfly',
    'collar',
    'gamma-scalping',
    'iron-condor',
    'bull-put-spread',
    'risk-reversal',
    'alligator-strategy',
  ];

  const ids = OPTIONS_STRATEGY_CATALOG.map(item => item.id);
  requiredIds.forEach(id => assert.ok(ids.includes(id), `${id} exists`));

  OPTIONS_STRATEGY_CATALOG.forEach(item => {
    assert.ok(item.nameZh, `${item.id} has Chinese name`);
    assert.ok(item.nameEn, `${item.id} has English name`);
    assert.ok(item.marketStates.length > 0, `${item.id} has market states`);
    assert.ok(item.strategyTypes.length > 0, `${item.id} has strategy types`);
    assert.ok(item.operationSteps.length >= 4, `${item.id} has operation steps`);
    assert.ok(item.keywords.length >= 2, `${item.id} has matching keywords`);
  });
}

testCatalogIntegrity();

const { buildIndex } = require('../build-options-knowledge-index');

function testBuildIndex() {
  const index = buildIndex();

  const ironCondor = index.find(item => item.id === 'iron-condor');
  assert.ok(ironCondor);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(ironCondor, 'quotes'), false);
  assert.ok(ironCondor.operationSteps.length >= 4);
}

testBuildIndex();

console.log('optionsKnowledgeIndex.test.js passed');
