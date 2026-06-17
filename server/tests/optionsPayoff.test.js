const assert = require('assert');

const {
  buildPayoffModel,
  calculateBlackScholesOptionPriceBtc,
  calculateOptionIntrinsicBtc,
  calculatePortfolioExpiryPnlBtc,
} = require('../utils/optionsPayoff');

const EXPIRY = Date.UTC(2026, 5, 26, 8);
const NOW = Date.UTC(2026, 5, 8, 8);

function optionLeg({ id, side, optionType, strike, entryPrice, quantity = 1, expirationTimestamp = EXPIRY }) {
  return {
    id,
    role: id,
    type: 'option',
    side,
    optionType,
    strike,
    quantity,
    entryPrice,
    entryIv: 65,
    expirationTimestamp,
    underlyingPrice: 64000,
    interestRate: 0,
    greeks: {
      delta: optionType === 'call' ? 0.2 : -0.2,
      gamma: 0.0001,
      theta: -12,
      vega: 20,
    },
  };
}

async function run() {
  assert.strictEqual(calculateOptionIntrinsicBtc({
    optionType: 'call',
    strike: 60000,
  }, 66000), 6000 / 66000);
  assert.strictEqual(calculateOptionIntrinsicBtc({
    optionType: 'put',
    strike: 60000,
  }, 54000), 6000 / 54000);
  assert.strictEqual(calculateOptionIntrinsicBtc({
    optionType: 'put',
    strike: 60000,
  }, 66000), 0);

  const callPrice = calculateBlackScholesOptionPriceBtc({
    spot: 64000,
    strike: 64000,
    timeToExpiryYears: 30 / 365,
    volatility: 0.65,
    rate: 0,
    optionType: 'call',
  });
  assert.ok(callPrice > 0.07 && callPrice < 0.08);

  const ironCondor = [
    optionLeg({ id: 'long-put-wing', side: 'buy', optionType: 'put', strike: 52000, entryPrice: 0.002 }),
    optionLeg({ id: 'short-put', side: 'sell', optionType: 'put', strike: 60000, entryPrice: 0.012 }),
    optionLeg({ id: 'short-call', side: 'sell', optionType: 'call', strike: 68000, entryPrice: 0.014 }),
    optionLeg({ id: 'long-call-wing', side: 'buy', optionType: 'call', strike: 76000, entryPrice: 0.003 }),
  ];

  const centerPnl = calculatePortfolioExpiryPnlBtc(ironCondor, 64000);
  assert.strictEqual(Number(centerPnl.toFixed(6)), 0.021);

  const lowSidePnl = calculatePortfolioExpiryPnlBtc(ironCondor, 50000);
  assert.ok(lowSidePnl < -0.12);

  const payoff = buildPayoffModel({
    legs: ironCondor,
    underlyingPrice: 64000,
    now: NOW,
    pointCount: 31,
  });

  assert.strictEqual(payoff.points.length, 31);
  assert.ok(payoff.metrics.maxProfitBtc > 0.02);
  assert.ok(payoff.metrics.maxLossBtc < -0.1);
  assert.strictEqual(payoff.metrics.netPremiumBtc, 0.021);
  assert.ok(payoff.metrics.breakevens.length >= 2);
  assert.ok(payoff.scenarioLabels.includes('ivUp'));
  assert.ok(payoff.scenarioLabels.includes('tPlus3'));

  const collar = [
    {
      id: 'spot-btc',
      type: 'underlying',
      side: 'long',
      quantity: 1,
      entryPrice: 64000,
    },
    optionLeg({ id: 'protective-put', side: 'buy', optionType: 'put', strike: 60000, entryPrice: 0.02 }),
    optionLeg({ id: 'covered-call', side: 'sell', optionType: 'call', strike: 72000, entryPrice: 0.015 }),
  ];

  const collarDown = calculatePortfolioExpiryPnlBtc(collar, 50000);
  const spotOnlyDown = (50000 - 64000) / 50000;
  assert.ok(collarDown > spotOnlyDown);

  const collarModel = buildPayoffModel({
    legs: collar,
    underlyingPrice: 64000,
    now: NOW,
    pointCount: 21,
  });
  assert.ok(collarModel.metrics.maxLossBtc > -0.2);
  assert.ok(collarModel.metrics.greeks.delta > 0.5);

  const calendar = [
    optionLeg({
      id: 'near-short-call',
      side: 'sell',
      optionType: 'call',
      strike: 64000,
      entryPrice: 0.03,
      expirationTimestamp: EXPIRY,
    }),
    optionLeg({
      id: 'far-long-call',
      side: 'buy',
      optionType: 'call',
      strike: 64000,
      entryPrice: 0.05,
      expirationTimestamp: Date.UTC(2026, 6, 31, 8),
    }),
  ];
  const calendarModel = buildPayoffModel({
    legs: calendar,
    underlyingPrice: 64000,
    now: NOW,
    pointCount: 21,
  });
  const centerPoint = calendarModel.points.reduce((closest, point) => (
    Math.abs(point.spot - 64000) < Math.abs(closest.spot - 64000) ? point : closest
  ));
  assert.strictEqual(calendarModel.metrics.hasMultipleExpirations, true);
  assert.strictEqual(calendarModel.metrics.payoffHorizonLabel, '近端到期估算');
  assert.ok(centerPoint.expiryPnlBtc > -0.02);

  console.log('optionsPayoff.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
