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

// 期权腿与时间情景都会进入 O(legs × points × scenarios) 的同步计算，
// 不设上限时 10MB 请求体足以把事件循环阻塞上百秒
const MAX_PAYOFF_LEGS = 50;
const MAX_PAYOFF_TIME_SCENARIOS = 30;
const UNSUPPORTED_STRATEGY_PATTERN = /^Unsupported options strategy:/;
// buildPayoffModel 内部抛出的入参错误，其余异常一律按 500 处理，避免真实故障被伪装成 400
const PAYOFF_VALIDATION_MESSAGES = new Set([
  'At least one leg is required',
  'underlyingPrice is required',
]);

function sendError(res, status, error) {
  return res.status(status).json({
    success: false,
    error: error.message || String(error),
  });
}

function createValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function validatePayoffRequest({ legs, timeScenarioDays }) {
  if (!Array.isArray(legs)) {
    throw createValidationError('legs must be an array');
  }
  if (legs.length === 0) {
    throw createValidationError('At least one leg is required');
  }
  if (legs.length > MAX_PAYOFF_LEGS) {
    throw createValidationError(`legs must contain at most ${MAX_PAYOFF_LEGS} entries`);
  }
  if (timeScenarioDays !== undefined && timeScenarioDays !== null) {
    if (!Array.isArray(timeScenarioDays)) {
      throw createValidationError('timeScenarioDays must be an array');
    }
    if (timeScenarioDays.length > MAX_PAYOFF_TIME_SCENARIOS) {
      throw createValidationError(
        `timeScenarioDays must contain at most ${MAX_PAYOFF_TIME_SCENARIOS} entries`
      );
    }
  }
}

function resolvePayoffErrorStatus(error) {
  if (error.statusCode) return error.statusCode;
  return PAYOFF_VALIDATION_MESSAGES.has(error.message) ? 400 : 500;
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
      // 未知策略是调用方的问题，不该报 500
      if (UNSUPPORTED_STRATEGY_PATTERN.test(error.message || '')) {
        return sendError(res, 404, error);
      }
      console.error('Error building BTC option strategy setup:', error);
      return sendError(res, 500, error);
    }
  });

  router.post('/btc/payoff', async (req, res) => {
    try {
      const { legs, underlyingPrice, pointCount, ivShiftPoints, timeScenarioDays } = req.body || {};
      validatePayoffRequest({ legs, timeScenarioDays });
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
      const status = resolvePayoffErrorStatus(error);
      if (status >= 500) console.error('Error calculating BTC option payoff:', error);
      return sendError(res, status, error);
    }
  });

  return router;
}

const router = createOptionsRouter();
router.createOptionsRouter = createOptionsRouter;

module.exports = router;
module.exports.createOptionsRouter = createOptionsRouter;
