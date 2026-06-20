const assert = require('assert');

const { OPTIONS_STRATEGY_CATALOG } = require('../../scripts/optionsStrategyCatalog');
const {
  buildStrategySetup,
  getStrategyBlueprint,
  listStrategyBlueprints,
} = require('../utils/optionsStrategyBlueprints');
const { buildPayoffModel } = require('../utils/optionsPayoff');

const NOW = Date.UTC(2026, 5, 8, 12);
const SPOT = 64000;
const MIN_DEFAULT_EXPIRATION_MS = 14 * 24 * 60 * 60 * 1000;

function option({ expirationDate, strike, optionType }) {
  const expirationTimestamps = {
    '2026-06-19': Date.UTC(2026, 5, 19, 8),
    '2026-06-26': Date.UTC(2026, 5, 26, 8),
    '2026-07-31': Date.UTC(2026, 6, 31, 8),
  };
  const instrumentName = `BTC-${expirationDate.replace(/-/g, '')}-${strike}-${optionType === 'call' ? 'C' : 'P'}`;
  return {
    instrumentName,
    expirationDate,
    expirationTimestamp: expirationTimestamps[expirationDate],
    strike,
    optionType,
    state: 'open',
    isActive: true,
    markPrice: Math.max(0.001, Math.abs(strike - SPOT) / SPOT / 10 + 0.01),
    midPrice: Math.max(0.001, Math.abs(strike - SPOT) / SPOT / 10 + 0.009),
    bidPrice: Math.max(0.001, Math.abs(strike - SPOT) / SPOT / 10 + 0.008),
    askPrice: Math.max(0.001, Math.abs(strike - SPOT) / SPOT / 10 + 0.012),
    markIv: 65,
    underlyingPrice: SPOT,
    interestRate: 0,
    openInterest: 10,
    greeks: {
      delta: optionType === 'call' ? 0.58 : -0.42,
      gamma: 0.0001,
      theta: -8,
      vega: 18,
    },
  };
}

function buildMockChain() {
  const strikes = [48000, 52000, 56000, 60000, 64000, 68000, 72000, 76000, 80000, 84000];
  const expirations = ['2026-06-19', '2026-06-26', '2026-07-31'];
  const options = expirations.flatMap(expirationDate => (
    strikes.flatMap(strike => [
      option({ expirationDate, strike, optionType: 'call' }),
      option({ expirationDate, strike, optionType: 'put' }),
    ])
  ));

  return {
    currency: 'BTC',
    underlyingPrice: SPOT,
    updatedAt: new Date(NOW).toISOString(),
    options,
    expirations,
  };
}

function assertOptionLeg(leg) {
  assert.strictEqual(leg.type, 'option');
  assert.ok(leg.instrumentName.startsWith('BTC-'));
  assert.ok(['buy', 'sell'].includes(leg.side));
  assert.ok(['call', 'put'].includes(leg.optionType));
  assert.ok(Number.isFinite(leg.strike));
  assert.ok(Number.isFinite(leg.quantity));
  assert.ok(leg.quantity > 0);
  assert.ok(Number.isFinite(leg.entryPrice));
}

async function run() {
  const catalogIds = OPTIONS_STRATEGY_CATALOG.map(strategy => strategy.id);
  const blueprintIds = listStrategyBlueprints().map(blueprint => blueprint.id);

  assert.strictEqual(catalogIds.length, 20);
  assert.deepStrictEqual([...blueprintIds].sort(), [...catalogIds].sort());

  const chain = buildMockChain();
  for (const strategyId of catalogIds) {
    const blueprint = getStrategyBlueprint(strategyId);
    assert.strictEqual(blueprint.id, strategyId);

    const setup = buildStrategySetup({
      strategyId,
      chain,
      now: NOW,
    });

    assert.strictEqual(setup.strategyId, strategyId);
    assert.ok(setup.legs.length >= 1, `${strategyId} should generate legs`);
    assert.ok(setup.controls.expirations.length >= 1);
    assert.strictEqual(setup.priceBasis, 'mark');
    assert.ok(Number.isFinite(setup.underlyingPrice));

    setup.legs.filter(leg => leg.type === 'option').forEach(assertOptionLeg);
    setup.legs
      .filter(leg => leg.type === 'option')
      .forEach(leg => {
        assert.ok(
          leg.expirationTimestamp >= NOW + MIN_DEFAULT_EXPIRATION_MS,
          `${strategyId} default option leg should expire at least two weeks out`
        );
      });

    const payoff = buildPayoffModel({
      legs: setup.legs,
      underlyingPrice: setup.underlyingPrice,
      now: NOW,
      pointCount: 81,
    });
    const spots = new Set(payoff.points.map(point => point.spot));
    assert.ok(spots.has(setup.underlyingPrice), `${strategyId} should include current BTC price`);
    setup.legs
      .filter(leg => leg.type === 'option')
      .forEach(leg => {
        assert.ok(spots.has(leg.strike), `${strategyId} should include strike ${leg.strike}`);
      });
    payoff.points.forEach(point => {
      ['expiryPnlUsd', 'expiryPnlBtc', 'currentEstimateUsd', 'currentEstimateBtc'].forEach(field => {
        assert.ok(Number.isFinite(point[field]), `${strategyId} ${field} should be finite`);
      });
    });
  }

  const ironCondor = buildStrategySetup({
    strategyId: 'iron-condor',
    chain,
    now: NOW,
  });
  assert.strictEqual(ironCondor.controls.selectedExpiration, '2026-06-26');
  assert.strictEqual(
    ironCondor.legs.every(leg => leg.expirationDate === '2026-06-26'),
    true
  );
  assert.deepStrictEqual(
    ironCondor.legs.map(leg => `${leg.side}:${leg.optionType}:${leg.strike}`),
    ['buy:put:52000', 'sell:put:60000', 'sell:call:68000', 'buy:call:76000']
  );

  const calendar = buildStrategySetup({
    strategyId: 'calendar-spread',
    chain,
    now: NOW,
  });
  assert.strictEqual(calendar.legs[0].expirationDate, '2026-06-26');
  assert.strictEqual(calendar.legs[1].expirationDate, '2026-07-31');
  assert.strictEqual(calendar.legs[0].strike, calendar.legs[1].strike);

  const selectedNearExpiryCondor = buildStrategySetup({
    strategyId: 'iron-condor',
    chain,
    now: NOW,
    expirationDate: '2026-06-19',
  });
  assert.strictEqual(selectedNearExpiryCondor.controls.selectedExpiration, '2026-06-19');
  assert.strictEqual(
    selectedNearExpiryCondor.legs.every(leg => leg.expirationDate === '2026-06-19'),
    true
  );

  const selectedExpiryCondor = buildStrategySetup({
    strategyId: 'iron-condor',
    chain,
    now: NOW,
    expirationDate: '2026-07-31',
  });
  assert.strictEqual(selectedExpiryCondor.controls.selectedExpiration, '2026-07-31');
  assert.strictEqual(
    selectedExpiryCondor.legs.every(leg => leg.expirationDate === '2026-07-31'),
    true
  );

  const collar = buildStrategySetup({
    strategyId: 'collar',
    chain,
    now: NOW,
  });
  assert.strictEqual(collar.legs[0].type, 'underlying');
  assert.strictEqual(collar.legs[0].quantity, 1);
  assert.strictEqual(collar.legs.some(leg => leg.optionType === 'put' && leg.side === 'buy'), true);
  assert.strictEqual(collar.legs.some(leg => leg.optionType === 'call' && leg.side === 'sell'), true);

  const gammaSetup = buildStrategySetup({
    strategyId: 'gamma-scalping',
    chain,
    now: NOW,
  });
  const gammaHedge = gammaSetup.legs.find(leg => leg.role === 'delta-hedge');
  assert.ok(gammaHedge);
  assert.strictEqual(gammaHedge.type, 'underlying');
  assert.strictEqual(gammaHedge.side, 'short');
  assert.strictEqual(gammaHedge.instrumentName, 'BTC-PERP / 现货对冲');
  assert.strictEqual(gammaHedge.quantity, 0.16);
  const gammaPayoff = buildPayoffModel({
    legs: gammaSetup.legs,
    underlyingPrice: gammaSetup.underlyingPrice,
    now: NOW,
    pointCount: 21,
  });
  assert.ok(Math.abs(gammaPayoff.metrics.greeks.delta) < 0.000001);

  const riskReversal = buildStrategySetup({
    strategyId: 'risk-reversal',
    chain,
    now: NOW,
  });
  assert.strictEqual(riskReversal.legs.length, 2);
  assert.strictEqual(riskReversal.legs.every(leg => leg.type === 'option'), true);
  assert.strictEqual(riskReversal.legs.some(leg => leg.optionType === 'put' && leg.side === 'sell'), true);
  assert.strictEqual(riskReversal.legs.some(leg => leg.optionType === 'call' && leg.side === 'buy'), true);

  const syntheticLong = buildStrategySetup({
    strategyId: 'synthetic-long-stock',
    chain,
    now: NOW,
  });
  assert.strictEqual(syntheticLong.legs.length, 2);
  assert.strictEqual(syntheticLong.legs.every(leg => leg.type === 'option'), true);
  assert.strictEqual(syntheticLong.legs[0].strike, syntheticLong.legs[1].strike);

  console.log('optionsStrategyBlueprints.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
