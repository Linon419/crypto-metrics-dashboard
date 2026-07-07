const assert = require('assert');

const { __testUtils } = require('../services/openaiService');

const {
  filterMomentumIndicatorsByRawText,
  getDefaultPrompt,
  getDefaultPromptTemplate,
  validateAndFixDate,
} = __testUtils || {};

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

  const prompt = getDefaultPrompt('期权调参\ndelta调为中性\nvega 正数\n组成 gamma squeeze');
  assert.ok(prompt.includes('optionTuning'));
  assert.ok(prompt.includes('deltaTarget'));
  assert.ok(prompt.includes('vegaTarget'));
  assert.ok(prompt.includes('iron_condor'));
  assert.ok(prompt.includes('gamma_squeeze'));
  assert.ok(prompt.includes('snake_case'));

  const potentialWatchPrompt = getDefaultPrompt([
    '今日潜力观察 日内大盘不稳时不必操作',
    'Agt 谢林兜底区0.0263',
    'Hood谢林兜底区 105.2',
    '昨日复盘',
  ].join('\n'));
  assert.ok(potentialWatchPrompt.includes('今日潜力观察'));
  assert.ok(potentialWatchPrompt.includes('昨日复盘'));
  assert.ok(potentialWatchPrompt.includes('整段内容一律忽略'));
  assert.ok(potentialWatchPrompt.includes('谢林兜底区全部忽略'));

  const promptTemplate = getDefaultPromptTemplate();
  assert.ok(promptTemplate.includes('{{currentDate}}'));
  assert.ok(promptTemplate.includes('{{processedText}}'));
  assert.ok(promptTemplate.includes('CN_AI_ETF'));
  assert.ok(promptTemplate.includes('白银'));
  assert.ok(promptTemplate.includes('XAG'));
  assert.ok(promptTemplate.includes('CN_HOG'));
  assert.ok(promptTemplate.includes('SK 海力士'));
  assert.ok(promptTemplate.includes('SK_HYNIX'));
  assert.ok(promptTemplate.includes('HYNIX'));
  assert.ok(promptTemplate.includes('SAMSUNG'));

  console.log('openaiMomentumSource.test.js passed');
}

run();
