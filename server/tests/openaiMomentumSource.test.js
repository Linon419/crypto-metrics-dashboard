const assert = require('assert');

const { __testUtils } = require('../services/openaiService');

const { filterMomentumIndicatorsByRawText, getDefaultPrompt, validateAndFixDate } = __testUtils || {};

function run() {
  assert.strictEqual(
    typeof filterMomentumIndicatorsByRawText,
    'function',
    'filterMomentumIndicatorsByRawText should be exported for tests'
  );

  const rawText = [
    'Sndk场外指数1529场外进场期第34天',
    '爆破指数249 *',
    'Mu场外指数1641场外进场期第31天',
    '爆破指数268 *',
    'Btc场外指数1500场外进场期第1天',
    '爆破指数250',
  ].join('\n');

  const parsedData = {
    date: '2026-05-10',
    coins: [
      { symbol: 'SNDK', otcIndex: 1529, explosionIndex: 249, momentumIndicators: ['*', '※'] },
      { symbol: 'MU', otcIndex: 1641, explosionIndex: 268, momentumIndicators: ['*'] },
      { symbol: 'BTC', otcIndex: 1500, explosionIndex: 250, momentumIndicators: ['※', '*'] },
    ],
  };

  const filteredData = filterMomentumIndicatorsByRawText(parsedData, rawText);

  assert.deepStrictEqual(filteredData.coins[0].momentumIndicators, ['*']);
  assert.deepStrictEqual(filteredData.coins[1].momentumIndicators, ['*']);
  assert.deepStrictEqual(filteredData.coins[2].momentumIndicators, []);

  const dollarPrefixData = filterMomentumIndicatorsByRawText({
    date: '2026-05-10',
    coins: [
      { symbol: 'TRUMP', otcIndex: 1200, explosionIndex: 220, momentumIndicators: ['$'] },
    ],
  }, '$Trump场外指数1200场外进场期第1天\n爆破指数220');

  assert.deepStrictEqual(dollarPrefixData.coins[0].momentumIndicators, []);

  const explicitDollarData = filterMomentumIndicatorsByRawText({
    date: '2026-05-10',
    coins: [
      { symbol: 'BTC', otcIndex: 1500, explosionIndex: 490, momentumIndicators: ['$'] },
    ],
  }, 'BTC场外指数1500场外进场期第1天\n爆破指数490$');

  assert.deepStrictEqual(explicitDollarData.coins[0].momentumIndicators, ['$']);

  assert.strictEqual(
    validateAndFixDate('2026-05-20', '2026-05-20 00:01\nBTC场外指数1200', 2026),
    '2026-05-20 00:01'
  );

  assert.strictEqual(
    validateAndFixDate('2026-05-20 00:01', '2026-05-20\nBTC场外指数1200', 2026),
    '2026-05-20 00:01'
  );

  assert.strictEqual(
    typeof getDefaultPrompt,
    'function',
    'getDefaultPrompt should be exported for tests'
  );

  const prompt = getDefaultPrompt('期权调参\ndelta调为中性\nvega 正数\n组成 iron condor');
  assert.ok(prompt.includes('optionTuning'));
  assert.ok(prompt.includes('deltaTarget'));
  assert.ok(prompt.includes('vegaTarget'));
  assert.ok(prompt.includes('iron_condor'));

  console.log('openaiMomentumSource.test.js passed');
}

run();
