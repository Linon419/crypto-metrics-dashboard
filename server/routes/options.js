const express = require('express');
const {
  getBtcOptionChain,
  getBtcOptionTicker,
} = require('../utils/deribitOptions');
const {
  buildStrategySetup,
  rebalanceStrategySetupHedges,
} = require('../utils/optionsStrategyBlueprints');
const { buildPayoffModel } = require('../utils/optionsPayoff');

function sendError(res, status, error) {
  return res.status(status).json({
    success: false,
    error: error.message || String(error),
  });
}

function hasAnyGreekValue(greeks = {}) {
  return ['delta', 'gamma', 'theta', 'vega'].some(key => Number.isFinite(Number(greeks[key])));
}

function mergeTickerIntoLeg(leg, ticker) {
  if (!ticker) return leg;

  return {
    ...leg,
    entryIv: ticker.markIv ?? leg.entryIv,
    underlyingPrice: ticker.underlyingPrice ?? leg.underlyingPrice,
    interestRate: ticker.interestRate ?? leg.interestRate,
    greeks: hasAnyGreekValue(ticker.greeks) ? ticker.greeks : leg.greeks,
  };
}

async function enrichSetupWithTickerGreeks(setup, {
  getTicker,
  forceRefresh = false,
  now = Date.now(),
}) {
  const warnings = [...(setup.warnings || [])];
  const tickerByInstrument = new Map();

  const instrumentNames = [...new Set(setup.legs
    .filter(leg => leg.type === 'option' && leg.instrumentName)
    .map(leg => leg.instrumentName))];

  await Promise.all(instrumentNames
    .map(async instrumentName => {
      try {
        const ticker = await getTicker({
          instrumentName,
          forceRefresh,
          now,
        });
        tickerByInstrument.set(instrumentName, ticker);
      } catch (error) {
        tickerByInstrument.set(instrumentName, null);
        warnings.push(`Greeks unavailable for ${instrumentName}: ${error.message || error}`);
      }
    }));

  return rebalanceStrategySetupHedges({
    ...setup,
    legs: setup.legs.map(leg => mergeTickerIntoLeg(leg, tickerByInstrument.get(leg.instrumentName))),
    warnings,
  });
}

function createOptionsRouter({
  getBtcOptionChain: getChain = getBtcOptionChain,
  getBtcOptionTicker: getTicker = getBtcOptionTicker,
  buildStrategySetup: buildSetup = buildStrategySetup,
  buildPayoffModel: buildPayoff = buildPayoffModel,
  nowProvider = Date.now,
} = {}) {
  const router = express.Router();

  router.get('/btc/chain', async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const data = await getChain({
        forceRefresh,
        now: nowProvider(),
      });
      return res.json({ success: true, data });
    } catch (error) {
      console.error('Error fetching BTC option chain:', error);
      return sendError(res, 500, error);
    }
  });

  router.get('/btc/ticker', async (req, res) => {
    try {
      const instrumentName = req.query.instrument_name || req.query.instrumentName;
      if (!instrumentName) {
        return sendError(res, 400, new Error('instrument_name is required'));
      }

      const data = await getTicker({
        instrumentName,
        forceRefresh: req.query.refresh === '1' || req.query.refresh === 'true',
        now: nowProvider(),
      });
      return res.json({ success: true, data });
    } catch (error) {
      console.error('Error fetching BTC option ticker:', error);
      return sendError(res, 500, error);
    }
  });

  router.get('/btc/strategies/:strategyId/setup', async (req, res) => {
    try {
      const now = nowProvider();
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const chain = await getChain({
        forceRefresh,
        now,
      });
      const setup = buildSetup({
        strategyId: req.params.strategyId,
        chain,
        now,
        priceBasis: req.query.priceBasis || 'mark',
        expirationDate: req.query.expirationDate || null,
      });
      const data = await enrichSetupWithTickerGreeks(setup, {
        getTicker,
        forceRefresh,
        now,
      });
      return res.json({ success: true, data });
    } catch (error) {
      console.error('Error building BTC option strategy setup:', error);
      return sendError(res, 500, error);
    }
  });

  router.post('/btc/payoff', async (req, res) => {
    try {
      const { legs, underlyingPrice, pointCount, ivShiftPoints, timeScenarioDays } = req.body || {};
      const data = buildPayoff({
        legs,
        underlyingPrice,
        pointCount,
        ivShiftPoints,
        timeScenarioDays,
        now: nowProvider(),
      });
      return res.json({ success: true, data });
    } catch (error) {
      console.error('Error calculating BTC option payoff:', error);
      return sendError(res, 400, error);
    }
  });

  return router;
}

const router = createOptionsRouter();
router.createOptionsRouter = createOptionsRouter;

module.exports = router;
module.exports.createOptionsRouter = createOptionsRouter;
