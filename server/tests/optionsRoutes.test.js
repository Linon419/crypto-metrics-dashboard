const assert = require('assert');
const express = require('express');

const { createOptionsRouter } = require('../routes/options');
const { buildStrategySetup } = require('../utils/optionsStrategyBlueprints');
const { buildPayoffModel } = require('../utils/optionsPayoff');

const NOW = Date.UTC(2026, 5, 8, 12);

function option({ strike, optionType, expirationDate = '2026-06-19' }) {
  return {
    instrumentName: `BTC-${expirationDate.replace(/-/g, '')}-${strike}-${optionType === 'call' ? 'C' : 'P'}`,
    expirationDate,
    expirationTimestamp: expirationDate === '2026-06-19'
      ? Date.UTC(2026, 5, 19, 8)
      : Date.UTC(2026, 6, 31, 8),
    strike,
    optionType,
    state: 'open',
    markPrice: 0.01,
    midPrice: 0.01,
    bidPrice: 0.009,
    askPrice: 0.011,
    markIv: 60,
    underlyingPrice: 64000,
    interestRate: 0,
  };
}

function buildChain() {
  const strikes = [52000, 56000, 60000, 64000, 68000, 72000, 76000];
  return {
    currency: 'BTC',
    underlyingPrice: 64000,
    updatedAt: new Date(NOW).toISOString(),
    options: ['2026-06-19', '2026-07-31'].flatMap(expirationDate => (
      strikes.flatMap(strike => [
        option({ strike, optionType: 'call', expirationDate }),
        option({ strike, optionType: 'put', expirationDate }),
      ])
    )),
    expirations: ['2026-06-19', '2026-07-31'],
  };
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  const payload = await response.json();
  return { response, payload };
}

async function run() {
  const chain = buildChain();
  const app = express();
  app.use(express.json());
  app.use('/api/options', createOptionsRouter({
    nowProvider: () => NOW,
    getBtcOptionChain: async () => chain,
    getBtcOptionTicker: async ({ instrumentName }) => ({
      instrumentName,
      markPrice: 0.01,
      markIv: 60,
      greeks: { delta: 0.2, gamma: 0.0001, theta: -10, vega: 18 },
      updatedAt: new Date(NOW).toISOString(),
    }),
    buildStrategySetup,
    buildPayoffModel,
  }));

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const chainResult = await requestJson(baseUrl, '/api/options/btc/chain');
    assert.strictEqual(chainResult.response.status, 200);
    assert.strictEqual(chainResult.payload.success, true);
    assert.strictEqual(chainResult.payload.data.options.length, 28);

    const setupResult = await requestJson(baseUrl, '/api/options/btc/strategies/iron-condor/setup');
    assert.strictEqual(setupResult.response.status, 200);
    assert.strictEqual(setupResult.payload.success, true);
    assert.strictEqual(setupResult.payload.data.strategyId, 'iron-condor');
    assert.strictEqual(setupResult.payload.data.legs.length, 4);
    assert.strictEqual(
      setupResult.payload.data.legs.every(leg => leg.greeks && Number.isFinite(leg.greeks.vega)),
      true
    );
    assert.strictEqual(setupResult.payload.data.legs[0].greeks.theta, -10);

    const selectedExpirySetup = await requestJson(
      baseUrl,
      '/api/options/btc/strategies/iron-condor/setup?expirationDate=2026-07-31'
    );
    assert.strictEqual(selectedExpirySetup.response.status, 200);
    assert.strictEqual(selectedExpirySetup.payload.data.controls.selectedExpiration, '2026-07-31');
    assert.strictEqual(
      selectedExpirySetup.payload.data.legs.every(leg => leg.expirationDate === '2026-07-31'),
      true
    );

    const tickerResult = await requestJson(baseUrl, '/api/options/btc/ticker?instrument_name=BTC-20260619-64000-C');
    assert.strictEqual(tickerResult.response.status, 200);
    assert.strictEqual(tickerResult.payload.data.instrumentName, 'BTC-20260619-64000-C');

    const payoffResult = await requestJson(baseUrl, '/api/options/btc/payoff', {
      method: 'POST',
      body: JSON.stringify({
        underlyingPrice: 64000,
        legs: setupResult.payload.data.legs,
        pointCount: 21,
      }),
    });
    assert.strictEqual(payoffResult.response.status, 200);
    assert.strictEqual(payoffResult.payload.success, true);
    assert.ok(payoffResult.payload.data.points.length >= 21);
    assert.ok(Array.isArray(payoffResult.payload.data.metrics.breakevens));
    assert.ok(Number.isFinite(payoffResult.payload.data.metrics.greeks.vega));

    const missingTicker = await requestJson(baseUrl, '/api/options/btc/ticker');
    assert.strictEqual(missingTicker.response.status, 400);
    assert.strictEqual(missingTicker.payload.success, false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log('optionsRoutes.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
