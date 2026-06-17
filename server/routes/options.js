const express = require('express');
const {
  getBtcOptionChain,
  getBtcOptionTicker,
} = require('../utils/deribitOptions');
const { buildStrategySetup } = require('../utils/optionsStrategyBlueprints');
const { buildPayoffModel } = require('../utils/optionsPayoff');

function sendError(res, status, error) {
  return res.status(status).json({
    success: false,
    error: error.message || String(error),
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
      const chain = await getChain({
        forceRefresh: req.query.refresh === '1' || req.query.refresh === 'true',
        now,
      });
      const data = buildSetup({
        strategyId: req.params.strategyId,
        chain,
        now,
        priceBasis: req.query.priceBasis || 'mark',
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
