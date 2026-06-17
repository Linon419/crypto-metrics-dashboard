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

function calculateOptionIntrinsicBtc(leg, spot) {
  const strike = toNumberOr(0, leg.strike);
  const scenarioSpot = toNumberOr(0, spot);
  if (scenarioSpot <= 0 || strike <= 0) return 0;

  if (leg.optionType === 'call') {
    return Math.max(scenarioSpot - strike, 0) / scenarioSpot;
  }
  if (leg.optionType === 'put') {
    return Math.max(strike - scenarioSpot, 0) / scenarioSpot;
  }
  return 0;
}

function sideMultiplier(side) {
  if (side === 'sell' || side === 'short') return -1;
  return 1;
}

function underlyingSideMultiplier(side) {
  if (side === 'short' || side === 'sell') return -1;
  return 1;
}

function calculateLegExpiryPnlBtc(leg, spot) {
  const quantity = toNumberOr(1, leg.quantity);
  if (leg.type === 'underlying') {
    const entryPrice = toNumberOr(spot, leg.entryPrice);
    return underlyingSideMultiplier(leg.side) * quantity * ((spot - entryPrice) / spot);
  }

  if (leg.type !== 'option') return 0;
  const intrinsic = calculateOptionIntrinsicBtc(leg, spot);
  const entryPremium = toNumberOr(0, leg.entryPrice);
  return sideMultiplier(leg.side) * quantity * (intrinsic - entryPremium);
}

function calculatePortfolioExpiryPnlBtc(legs, spot) {
  return legs.reduce((total, leg) => total + calculateLegExpiryPnlBtc(leg, spot), 0);
}

function calculateBlackScholesOptionPriceBtc({
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
    return calculateOptionIntrinsicBtc({ optionType, strike: k }, s);
  }

  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(s / k) + (r + 0.5 * sigma * sigma) * t) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const callUsd = s * normalCdf(d1) - k * Math.exp(-r * t) * normalCdf(d2);
  const putUsd = k * Math.exp(-r * t) * normalCdf(-d2) - s * normalCdf(-d1);
  const usdValue = optionType === 'put' ? putUsd : callUsd;
  return Math.max(usdValue, 0) / s;
}

function yearsToExpiry(expirationTimestamp, now) {
  return Math.max(0, (expirationTimestamp - now) / (DAYS_PER_YEAR * 24 * 60 * 60 * 1000));
}

function normalizedVol(leg, ivShiftPoints = 0) {
  const iv = leg.entryIv ?? leg.markIv ?? 65;
  return Math.max(0.0001, (toNumberOr(65, iv) + ivShiftPoints) / 100);
}

function calculateLegScenarioPnlBtc(leg, spot, { now, ivShiftPoints = 0, timeShiftDays = 0 } = {}) {
  const quantity = toNumberOr(1, leg.quantity);
  if (leg.type === 'underlying') {
    return calculateLegExpiryPnlBtc(leg, spot);
  }
  if (leg.type !== 'option') return 0;

  const shiftedNow = now + timeShiftDays * 24 * 60 * 60 * 1000;
  const modelPrice = calculateBlackScholesOptionPriceBtc({
    spot,
    strike: leg.strike,
    timeToExpiryYears: yearsToExpiry(leg.expirationTimestamp, shiftedNow),
    volatility: normalizedVol(leg, ivShiftPoints),
    rate: toNumberOr(0, leg.interestRate),
    optionType: leg.optionType,
  });
  return sideMultiplier(leg.side) * quantity * (modelPrice - toNumberOr(0, leg.entryPrice));
}

function calculatePortfolioScenarioPnlBtc(legs, spot, scenario) {
  return legs.reduce((total, leg) => total + calculateLegScenarioPnlBtc(leg, spot, scenario), 0);
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
  const minStrike = Math.min(...strikes, underlyingPrice * 0.75);
  const maxStrike = Math.max(...strikes, underlyingPrice * 1.25);
  const min = Math.max(1, Math.min(minStrike * 0.9, underlyingPrice * 0.7));
  const max = Math.max(maxStrike * 1.1, underlyingPrice * 1.3);
  const safePointCount = Math.max(11, Math.min(201, Math.round(pointCount)));
  const step = (max - min) / (safePointCount - 1);
  return Array.from({ length: safePointCount }, (_, index) => min + step * index);
}

function findBreakevens(points) {
  const breakevens = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous.expiryPnlBtc === 0) {
      breakevens.push(previous.spot);
    }
    if ((previous.expiryPnlBtc < 0 && current.expiryPnlBtc > 0) ||
        (previous.expiryPnlBtc > 0 && current.expiryPnlBtc < 0)) {
      const ratio = Math.abs(previous.expiryPnlBtc) /
        (Math.abs(previous.expiryPnlBtc) + Math.abs(current.expiryPnlBtc));
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

  const grid = buildPriceGrid(legs, spot, pointCount);
  const payoffHorizon = getPayoffHorizon(legs, now);
  const points = grid.map(price => {
    const expiryPnlBtc = calculatePortfolioScenarioPnlBtc(legs, price, {
      now: payoffHorizon.primaryExpirationTimestamp,
    });
    const point = {
      spot: round(price, 2),
      expiryPnlBtc: round(expiryPnlBtc),
      expiryPnlUsd: round(expiryPnlBtc * price, 2),
      currentEstimateBtc: round(calculatePortfolioScenarioPnlBtc(legs, price, { now })),
      ivDownBtc: round(calculatePortfolioScenarioPnlBtc(legs, price, { now, ivShiftPoints: -ivShiftPoints })),
      ivUpBtc: round(calculatePortfolioScenarioPnlBtc(legs, price, { now, ivShiftPoints })),
    };

    timeScenarioDays.forEach(days => {
      point[`tPlus${days}Btc`] = round(calculatePortfolioScenarioPnlBtc(legs, price, {
        now,
        timeShiftDays: days,
      }));
    });
    return point;
  });

  const expiryValues = points.map(point => point.expiryPnlBtc);
  const maxProfitBtc = Math.max(...expiryValues);
  const maxLossBtc = Math.min(...expiryValues);
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
      netPremiumBtc: round(calculateNetPremiumBtc(legs)),
      maxProfitBtc: round(maxProfitBtc),
      maxProfitUsd: round(maxProfitBtc * spot, 2),
      maxLossBtc: round(maxLossBtc),
      maxLossUsd: round(maxLossBtc * spot, 2),
      breakevens: findBreakevens(points),
      greeks: Object.fromEntries(Object.entries(aggregateGreeks(legs)).map(([key, value]) => [key, round(value, 6)])),
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
  calculateLegExpiryPnlBtc,
  calculateOptionIntrinsicBtc,
  calculatePortfolioExpiryPnlBtc,
  calculatePortfolioScenarioPnlBtc,
  getPayoffHorizon,
  normalCdf,
};
