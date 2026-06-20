const assert = require('assert');

const {
  buildPayoffModel,
  calculateBlackScholesOptionPriceBtc,
  calculateOptionIntrinsicBtc,
  calculatePortfolioExpiryPnlUsd,
  calculatePortfolioExpiryPnlBtc,
} = require('../utils/optionsPayoff');

const EXPIRY = Date.UTC(2026, 5, 26, 8);
const NOW = Date.UTC(2026, 5, 8, 8);

function optionLeg({
  id,
  side,
  optionType,
  strike,
  entryPrice,
  quantity = 1,
  expirationTimestamp = EXPIRY,
  underlyingPrice = 64000,
}) {
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
    underlyingPrice,
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

  const longStraddle = [
    optionLeg({
      id: 'straddle-call',
      side: 'buy',
      optionType: 'call',
      strike: 100,
      entryPrice: 0.05,
      underlyingPrice: 100,
    }),
    optionLeg({
      id: 'straddle-put',
      side: 'buy',
      optionType: 'put',
      strike: 100,
      entryPrice: 0.04,
      underlyingPrice: 100,
    }),
  ];
  const straddleModel = buildPayoffModel({
    legs: longStraddle,
    underlyingPrice: 100,
    now: NOW,
    pointCount: 15,
  });
  const straddleAt50 = straddleModel.points.find(point => point.spot === 50);
  const straddleAt100 = straddleModel.points.find(point => point.spot === 100);
  const straddleAt150 = straddleModel.points.find(point => point.spot === 150);
  assert.strictEqual(straddleModel.points[0].spot, 50);
  assert.strictEqual(straddleModel.points[straddleModel.points.length - 1].spot, 150);
  assert.strictEqual(straddleAt50.expiryPnlUsd, 41);
  assert.strictEqual(straddleAt100.expiryPnlUsd, -9);
  assert.strictEqual(straddleAt150.expiryPnlUsd, 41);
  assert.deepStrictEqual(straddleModel.metrics.breakevens, [91, 109]);
  assert.deepStrictEqual(straddleModel.metrics.strikes, [100]);

  const longStrangle = [
    optionLeg({
      id: 'strangle-put',
      side: 'buy',
      optionType: 'put',
      strike: 90,
      entryPrice: 0.03,
      underlyingPrice: 100,
    }),
    optionLeg({
      id: 'strangle-call',
      side: 'buy',
      optionType: 'call',
      strike: 110,
      entryPrice: 0.04,
      underlyingPrice: 100,
    }),
  ];
  const strangleModel = buildPayoffModel({
    legs: longStrangle,
    underlyingPrice: 100,
    now: NOW,
    pointCount: 61,
  });
  const strangleAt130 = strangleModel.points.find(point => point.spot === 130);
  assert.strictEqual(strangleModel.points[0].spot, 50);
  assert.strictEqual(strangleModel.points[strangleModel.points.length - 1].spot, 150);
  assert.strictEqual(strangleAt130.expiryPnlUsd, 13);
  assert.deepStrictEqual(strangleModel.metrics.breakevens, [83, 117]);
  assert.deepStrictEqual(strangleModel.metrics.strikes, [90, 110]);

  const missingUnderlyingReferenceLegs = [
    optionLeg({
      id: 'fixed-premium-call',
      side: 'buy',
      optionType: 'call',
      strike: 100,
      entryPrice: 0.1,
      underlyingPrice: null,
    }),
  ];
  assert.strictEqual(
    calculatePortfolioExpiryPnlUsd(missingUnderlyingReferenceLegs, 150),
    35,
  );
  const fixedPremiumModel = buildPayoffModel({
    legs: missingUnderlyingReferenceLegs,
    underlyingPrice: 100,
    now: NOW,
    pointCount: 11,
  });
  assert.strictEqual(
    fixedPremiumModel.points.find(point => point.spot === 150).expiryPnlUsd,
    40,
  );

  const narrowBtcStrangle = [
    optionLeg({
      id: 'narrow-btc-call',
      side: 'buy',
      optionType: 'call',
      strike: 63000,
      entryPrice: 0.00305,
      underlyingPrice: 62491,
    }),
    optionLeg({
      id: 'narrow-btc-put',
      side: 'buy',
      optionType: 'put',
      strike: 62000,
      entryPrice: 0.00442,
      underlyingPrice: 62491,
    }),
  ];
  const narrowBtcStrangleModel = buildPayoffModel({
    legs: narrowBtcStrangle,
    underlyingPrice: 62491,
    now: NOW,
    pointCount: 81,
  });
  const lowerStrikePoint = narrowBtcStrangleModel.points.find(point => point.spot === 62000);
  const upperStrikePoint = narrowBtcStrangleModel.points.find(point => point.spot === 63000);
  assert.ok(lowerStrikePoint);
  assert.ok(upperStrikePoint);
  assert.strictEqual(lowerStrikePoint.expiryPnlUsd, -466.81);
  assert.strictEqual(upperStrikePoint.expiryPnlUsd, -466.81);

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

  assert.ok(payoff.points.length >= 31);
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
