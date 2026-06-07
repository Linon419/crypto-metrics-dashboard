const assert = require('assert');

const {
  OPTIONS_STRATEGY_CATALOG,
  collectMatchingParagraphs,
  normalizeText,
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

function testTextMatching() {
  const text = normalizeText(`
    老师这里讲铁鹰策略，也就是 iron condor。
    下方做 bull put spread，上方做 bear call spread。

    这一段讲第二战法，和铁鹰无关。
  `);

  const matches = collectMatchingParagraphs(text, ['铁鹰', 'iron condor'], 500);
  assert.strictEqual(matches.length, 1);
  assert.ok(matches[0].includes('iron condor'));
  assert.ok(matches[0].includes('bear call spread'));
}

testCatalogIntegrity();
testTextMatching();

const { buildIndexFromSourceTexts } = require('../build-options-knowledge-index');

function testBuildIndexFromSourceTexts() {
  const index = buildIndexFromSourceTexts({
    sourceTexts: [
      {
        sourceFile: 'day11微信录音 魔方_20260414225958_原文.docx',
        text: '铁鹰策略就是 iron condor，下方做 bull put spread，上方做 bear call spread，目标是在区间内收租。',
      },
    ],
    maxExcerptChars: 500,
  });

  const ironCondor = index.find(item => item.id === 'iron-condor');
  assert.ok(ironCondor);
  assert.strictEqual(ironCondor.quotes.length, 1);
  assert.strictEqual(ironCondor.quotes[0].sourceFile, 'day11微信录音 魔方_20260414225958_原文.docx');
  assert.ok(ironCondor.quotes[0].excerpt.includes('iron condor'));
}

testBuildIndexFromSourceTexts();

console.log('optionsKnowledgeIndex.test.js passed');
