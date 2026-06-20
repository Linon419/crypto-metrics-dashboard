const DAYS_PER_YEAR = 365;
const DEFAULT_POINT_COUNT = 81;

function toNumberOr(defaultValue, value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : defaultValue;
}

function normalCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * absX);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1 + sign * erf);
}

function calculateOptionIntrinsicUsd(leg, spot) {
  const strike = toNumberOr(0, leg.strike);
  const scenarioSpot = toNumberOr(0, spot);
  if (scenarioSpot <= 0 || strike <= 0) return 0;

  if (leg.optionType === 'call') {
    return Math.max(scenarioSpot - strike, 0);
  }
  if (leg.optionType === 'put') {
    return Math.max(strike - scenarioSpot, 0);
  }
  return 0;
}

function calculateOptionIntrinsicBtc(leg, spot) {
  const scenarioSpot = toNumberOr(0, spot);
  if (scenarioSpot <= 0) return 0;
  return calculateOptionIntrinsicUsd(leg, scenarioSpot) / scenarioSpot;
}

function sideMultiplier(side) {
  if (side === 'sell' || side === 'short') return -1;
  return 1;
}

function underlyingSideMultiplier(side) {
  if (side === 'short' || side === 'sell') return -1;
  return 1;
}

function getPremiumReferenceSpot(leg, spot) {
  return toNumberOr(0, leg.underlyingPrice) || toNumberOr(0, spot);
}

function calculateEntryPremiumUsd(leg, spot) {
  return toNumberOr(0, leg.entryPrice) * getPremiumReferenceSpot(leg, spot);
}

function calculateLegExpiryPnlUsd(leg, spot) {
  const scenarioSpot = toNumberOr(0, spot);
  const quantity = toNumberOr(1, leg.quantity);
  if (leg.type === 'underlying') {
    const entryPrice = toNumberOr(scenarioSpot, leg.entryPrice);
    return underlyingSideMultiplier(leg.side) * quantity * (scenarioSpot - entryPrice);
  }

  if (leg.type !== 'option') return 0;
  const intrinsic = calculateOptionIntrinsicUsd(leg, scenarioSpot);
  const entryPremium = calculateEntryPremiumUsd(leg, scenarioSpot);
  return sideMultiplier(leg.side) * quantity * (intrinsic - entryPremium);
}

function calculateLegExpiryPnlBtc(leg, spot) {
  const scenarioSpot = toNumberOr(0, spot);
  if (scenarioSpot <= 0) return 0;
  return calculateLegExpiryPnlUsd(leg, scenarioSpot) / scenarioSpot;
}

function calculatePortfolioExpiryPnlUsd(legs, spot) {
  return legs.reduce((total, leg) => total + calculateLegExpiryPnlUsd(leg, spot), 0);
}

function calculatePortfolioExpiryPnlBtc(legs, spot) {
  return legs.reduce((total, leg) => total + calculateLegExpiryPnlBtc(leg, spot), 0);
}

function calculateBlackScholesOptionPriceUsd({
  spot,
  strike,
  timeToExpiryYears,
  volatility,
  rate = 0,
  optionType,
}) {
  const s = toNumberOr(0, spot);
  const k = toNumberOr(0, strike);
  const t = Math.max(toNumberOr(0, timeToExpiryYears), 0);
  const sigma = Math.max(toNumberOr(0, volatility), 0);
  const r = toNumberOr(0, rate);

  if (s <= 0 || k <= 0) return 0;
  if (t <= 0 || sigma <= 0) {
    return calculateOptionIntrinsicUsd({ optionType, strike: k }, s);
  }

  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(s / k) + (r + 0.5 * sigma * sigma) * t) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const callUsd = s * normalCdf(d1) - k * Math.exp(-r * t) * normalCdf(d2);
  const putUsd = k * Math.exp(-r * t) * normalCdf(-d2) - s * normalCdf(-d1);
  const usdValue = optionType === 'put' ? putUsd : callUsd;
  return Math.max(usdValue, 0);
}

function calculateBlackScholesOptionPriceBtc(params) {
  const spot = toNumberOr(0, params?.spot);
  if (spot <= 0) return 0;
  return calculateBlackScholesOptionPriceUsd(params) / spot;
}

function yearsToExpiry(expirationTimestamp, now) {
  return Math.max(0, (expirationTimestamp - now) / (DAYS_PER_YEAR * 24 * 60 * 60 * 1000));
}

function normalizedVol(leg, ivShiftPoints = 0) {
  const iv = leg.entryIv ?? leg.markIv ?? 65;
  return Math.max(0.0001, (toNumberOr(65, iv) + ivShiftPoints) / 100);
}

function calculateLegScenarioPnlBtc(leg, spot, { now, ivShiftPoints = 0, timeShiftDays = 0 } = {}) {
  const scenarioSpot = toNumberOr(0, spot);
  if (scenarioSpot <= 0) return 0;
  return calculateLegScenarioPnlUsd(leg, scenarioSpot, { now, ivShiftPoints, timeShiftDays }) / scenarioSpot;
}

function calculateLegScenarioPnlUsd(leg, spot, { now, ivShiftPoints = 0, timeShiftDays = 0 } = {}) {
  const scenarioSpot = toNumberOr(0, spot);
  const quantity = toNumberOr(1, leg.quantity);
  if (leg.type === 'underlying') {
    return calculateLegExpiryPnlUsd(leg, scenarioSpot);
  }
  if (leg.type !== 'option') return 0;

  const shiftedNow = now + timeShiftDays * 24 * 60 * 60 * 1000;
  const modelPrice = calculateBlackScholesOptionPriceUsd({
    spot: scenarioSpot,
    strike: leg.strike,
    timeToExpiryYears: yearsToExpiry(leg.expirationTimestamp, shiftedNow),
    volatility: normalizedVol(leg, ivShiftPoints),
    rate: toNumberOr(0, leg.interestRate),
    optionType: leg.optionType,
  });
  return sideMultiplier(leg.side) * quantity * (modelPrice - calculateEntryPremiumUsd(leg, scenarioSpot));
}

function calculatePortfolioScenarioPnlBtc(legs, spot, scenario) {
  return legs.reduce((total, leg) => total + calculateLegScenarioPnlBtc(leg, spot, scenario), 0);
}

function calculatePortfolioScenarioPnlUsd(legs, spot, scenario) {
  return legs.reduce((total, leg) => total + calculateLegScenarioPnlUsd(leg, spot, scenario), 0);
}

function getOptionExpirationTimestamps(legs = []) {
  return [...new Set(legs
    .filter(leg => leg.type === 'option')
    .map(leg => Number(leg.expirationTimestamp))
    .filter(Number.isFinite))]
    .sort((left, right) => left - right);
}

function getPayoffHorizon(legs = [], now = Date.now()) {
  const expirations = getOptionExpirationTimestamps(legs);
  const primaryExpirationTimestamp = expirations[0] || now;
  const hasMultipleExpirations = expirations.length > 1;
  return {
    hasMultipleExpirations,
    primaryExpirationTimestamp,
    payoffHorizonLabel: hasMultipleExpirations ? '近端到期估算' : '到期盈亏',
  };
}

function buildPriceGrid(legs, underlyingPrice, pointCount = DEFAULT_POINT_COUNT) {
  const strikes = legs
    .filter(leg => leg.type === 'option')
    .map(leg => leg.strike)
    .filter(Number.isFinite);
  const min = Math.max(1, underlyingPrice * 0.5);
  const max = Math.max(min + 1, underlyingPrice * 1.5);
  const safePointCount = Math.max(11, Math.min(201, Math.round(pointCount)));
  const step = (max - min) / (safePointCount - 1);
  const baseGrid = Array.from({ length: safePointCount }, (_, index) => min + step * index);
  const keyPrices = [
    underlyingPrice,
    ...strikes,
  ].filter(value => Number.isFinite(value) && value >= min && value <= max);

  return [...new Set([...baseGrid, ...keyPrices].map(value => Math.round(value * 100) / 100))]
    .sort((left, right) => left - right);
}

function normalizeLegsForPayoff(legs, spot) {
  return legs.map(leg => {
    if (leg.type !== 'option') return leg;
    const underlyingPrice = toNumberOr(0, leg.underlyingPrice);
    if (underlyingPrice > 0) return leg;
    return {
      ...leg,
      underlyingPrice: spot,
    };
  });
}

function findBreakevens(points) {
  const breakevens = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const previousPnl = previous.expiryPnlUsd ?? previous.expiryPnlBtc;
    const currentPnl = current.expiryPnlUsd ?? current.expiryPnlBtc;
    if (previousPnl === 0) {
      breakevens.push(previous.spot);
    }
    if ((previousPnl < 0 && currentPnl > 0) ||
        (previousPnl > 0 && currentPnl < 0)) {
      const ratio = Math.abs(previousPnl) /
        (Math.abs(previousPnl) + Math.abs(currentPnl));
      breakevens.push(previous.spot + (current.spot - previous.spot) * ratio);
    }
  }
  return breakevens.map(value => Math.round(value * 100) / 100);
}

function calculateNetPremiumBtc(legs) {
  return legs.reduce((total, leg) => {
    if (leg.type !== 'option') return total;
    return total - sideMultiplier(leg.side) * toNumberOr(1, leg.quantity) * toNumberOr(0, leg.entryPrice);
  }, 0);
}

function calculateNetPremiumUsd(legs, spot) {
  return legs.reduce((total, leg) => {
    if (leg.type !== 'option') return total;
    return total - sideMultiplier(leg.side) * toNumberOr(1, leg.quantity) * calculateEntryPremiumUsd(leg, spot);
  }, 0);
}

function aggregateGreeks(legs) {
  return legs.reduce((total, leg) => {
    if (leg.type === 'underlying') {
      return {
        ...total,
        delta: total.delta + underlyingSideMultiplier(leg.side) * toNumberOr(1, leg.quantity),
      };
    }
    const greeks = leg.greeks || {};
    const multiplier = sideMultiplier(leg.side) * toNumberOr(1, leg.quantity);
    return {
      delta: total.delta + multiplier * toNumberOr(0, greeks.delta),
      gamma: total.gamma + multiplier * toNumberOr(0, greeks.gamma),
      theta: total.theta + multiplier * toNumberOr(0, greeks.theta),
      vega: total.vega + multiplier * toNumberOr(0, greeks.vega),
    };
  }, { delta: 0, gamma: 0, theta: 0, vega: 0 });
}

function round(value, digits = 8) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildPayoffModel({
  legs,
  underlyingPrice,
  now = Date.now(),
  pointCount = DEFAULT_POINT_COUNT,
  ivShiftPoints = 10,
  timeScenarioDays = [1, 3, 7],
} = {}) {
  if (!Array.isArray(legs) || legs.length === 0) {
    throw new Error('At least one leg is required');
  }
  const spot = toNumberOr(0, underlyingPrice || legs.find(leg => leg.underlyingPrice)?.underlyingPrice);
  if (spot <= 0) {
    throw new Error('underlyingPrice is required');
  }

  const normalizedLegs = normalizeLegsForPayoff(legs, spot);
  const grid = buildPriceGrid(normalizedLegs, spot, pointCount);
  const payoffHorizon = getPayoffHorizon(normalizedLegs, now);
  const strikes = [...new Set(normalizedLegs
    .filter(leg => leg.type === 'option')
    .map(leg => Number(leg.strike))
    .filter(Number.isFinite))]
    .sort((left, right) => left - right);
  const points = grid.map(price => {
    const expiryPnlUsd = payoffHorizon.hasMultipleExpirations
      ? calculatePortfolioScenarioPnlUsd(normalizedLegs, price, {
        now: payoffHorizon.primaryExpirationTimestamp,
      })
      : calculatePortfolioExpiryPnlUsd(normalizedLegs, price);
    const expiryPnlBtc = price > 0 ? expiryPnlUsd / price : 0;
    const currentEstimateUsd = calculatePortfolioScenarioPnlUsd(normalizedLegs, price, { now });
    const ivDownUsd = calculatePortfolioScenarioPnlUsd(normalizedLegs, price, { now, ivShiftPoints: -ivShiftPoints });
    const ivUpUsd = calculatePortfolioScenarioPnlUsd(normalizedLegs, price, { now, ivShiftPoints });
    const point = {
      spot: round(price, 2),
      expiryPnlBtc: round(expiryPnlBtc),
      expiryPnlUsd: round(expiryPnlUsd, 2),
      currentEstimateBtc: round(currentEstimateUsd / price),
      currentEstimateUsd: round(currentEstimateUsd, 2),
      ivDownBtc: round(ivDownUsd / price),
      ivDownUsd: round(ivDownUsd, 2),
      ivUpBtc: round(ivUpUsd / price),
      ivUpUsd: round(ivUpUsd, 2),
    };

    timeScenarioDays.forEach(days => {
      const tPlusUsd = calculatePortfolioScenarioPnlUsd(normalizedLegs, price, {
        now,
        timeShiftDays: days,
      });
      point[`tPlus${days}Btc`] = round(tPlusUsd / price);
      point[`tPlus${days}Usd`] = round(tPlusUsd, 2);
    });
    return point;
  });

  const expiryValues = points.map(point => point.expiryPnlBtc);
  const expiryUsdValues = points.map(point => point.expiryPnlUsd);
  const maxProfitBtc = Math.max(...expiryValues);
  const maxLossBtc = Math.min(...expiryValues);
  const maxProfitUsd = Math.max(...expiryUsdValues);
  const maxLossUsd = Math.min(...expiryUsdValues);
  const scenarioLabels = [
    'expiry',
    'currentEstimate',
    'ivDown',
    'ivUp',
    ...timeScenarioDays.map(days => `tPlus${days}`),
  ];

  return {
    points,
    scenarioLabels,
    metrics: {
      underlyingPrice: spot,
      netPremiumBtc: round(calculateNetPremiumBtc(normalizedLegs)),
      netPremiumUsd: round(calculateNetPremiumUsd(normalizedLegs, spot), 2),
      maxProfitBtc: round(maxProfitBtc),
      maxProfitUsd: round(maxProfitUsd, 2),
      maxLossBtc: round(maxLossBtc),
      maxLossUsd: round(maxLossUsd, 2),
      breakevens: findBreakevens(points),
      strikes,
      greeks: Object.fromEntries(Object.entries(aggregateGreeks(normalizedLegs)).map(([key, value]) => [key, round(value, 6)])),
      generatedAt: new Date(now).toISOString(),
      hasMultipleExpirations: payoffHorizon.hasMultipleExpirations,
      payoffHorizonLabel: payoffHorizon.payoffHorizonLabel,
      payoffHorizonAt: new Date(payoffHorizon.primaryExpirationTimestamp).toISOString(),
    },
  };
}

module.exports = {
  DAYS_PER_YEAR,
  aggregateGreeks,
  buildPayoffModel,
  calculateBlackScholesOptionPriceBtc,
  calculateBlackScholesOptionPriceUsd,
  calculateEntryPremiumUsd,
  calculateLegExpiryPnlBtc,
  calculateLegExpiryPnlUsd,
  calculateOptionIntrinsicBtc,
  calculateOptionIntrinsicUsd,
  calculatePortfolioExpiryPnlBtc,
  calculatePortfolioExpiryPnlUsd,
  calculatePortfolioScenarioPnlBtc,
  calculatePortfolioScenarioPnlUsd,
  getPayoffHorizon,
  normalCdf,
};
