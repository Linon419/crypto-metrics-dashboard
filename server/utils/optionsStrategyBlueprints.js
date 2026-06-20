const { OPTIONS_STRATEGY_CATALOG } = require('../../scripts/optionsStrategyCatalog');

const DEFAULT_PRICE_BASIS = 'mark';
const MIN_DEFAULT_EXPIRATION_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function asTimestamp(dateLike) {
  const timestamp = typeof dateLike === 'number' ? dateLike : Date.parse(dateLike);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function compareByDistance(target, key = value => value) {
  return (left, right) => (
    Math.abs(key(left) - target) - Math.abs(key(right) - target) ||
    key(left) - key(right)
  );
}

function getPrice(option, priceBasis = DEFAULT_PRICE_BASIS) {
  if (!option) return null;
  const fieldByBasis = {
    mark: 'markPrice',
    mid: 'midPrice',
    bid: 'bidPrice',
    ask: 'askPrice',
  };
  const preferred = option[fieldByBasis[priceBasis] || 'markPrice'];
  return preferred ?? option.markPrice ?? option.midPrice ?? option.askPrice ?? option.bidPrice ?? 0;
}

function getUnderlyingPrice(chain) {
  return chain.underlyingPrice ||
    chain.options.find(option => option.underlyingPrice)?.underlyingPrice ||
    0;
}

function getExpirationEntries(chain, now = Date.now()) {
  const nowTimestamp = asTimestamp(now);
  const byDate = new Map();
  chain.options
    .filter(option => option.state === 'open' && option.expirationTimestamp > nowTimestamp)
    .sort((left, right) => left.expirationTimestamp - right.expirationTimestamp)
    .forEach(option => {
      if (!byDate.has(option.expirationDate)) {
        byDate.set(option.expirationDate, {
          date: option.expirationDate,
          timestamp: option.expirationTimestamp,
        });
      }
    });
  return [...byDate.values()];
}

function getExpirations(chain, now = Date.now()) {
  return getExpirationEntries(chain, now).map(entry => entry.date);
}

function chooseDefaultPrimaryExpirationIndex(expirationEntries, now) {
  const nowTimestamp = asTimestamp(now);
  const minimumTimestamp = nowTimestamp + MIN_DEFAULT_EXPIRATION_DAYS * MS_PER_DAY;
  const index = expirationEntries.findIndex(entry => entry.timestamp >= minimumTimestamp);
  return index >= 0 ? index : 0;
}

function chooseExpiration(chain, now, mode = 'primary', selectedExpiration = null) {
  const expirationEntries = getExpirationEntries(chain, now);
  if (expirationEntries.length === 0) {
    throw new Error('No BTC option expirations are available');
  }
  const expirations = expirationEntries.map(entry => entry.date);
  const selectedIndex = selectedExpiration ? expirations.indexOf(selectedExpiration) : -1;
  const primaryIndex = selectedIndex >= 0
    ? selectedIndex
    : chooseDefaultPrimaryExpirationIndex(expirationEntries, now);
  if (mode === 'far') {
    return expirations[Math.min(primaryIndex + 1, expirations.length - 1)];
  }
  return expirations[primaryIndex];
}

function optionsFor(chain, expirationDate, optionType) {
  return chain.options
    .filter(option => option.expirationDate === expirationDate && option.optionType === optionType && option.state === 'open')
    .sort((left, right) => left.strike - right.strike);
}

function chooseByStrike(chain, expirationDate, optionType, targetStrike) {
  const candidates = optionsFor(chain, expirationDate, optionType);
  if (candidates.length === 0) {
    throw new Error(`No ${optionType} options for ${expirationDate}`);
  }
  return [...candidates].sort(compareByDistance(targetStrike, option => option.strike))[0];
}

function chooseAtm(chain, expirationDate, optionType) {
  return chooseByStrike(chain, expirationDate, optionType, getUnderlyingPrice(chain));
}

function uniqueStrikes(chain, expirationDate) {
  return [...new Set(chain.options
    .filter(option => option.expirationDate === expirationDate)
    .map(option => option.strike))]
    .sort((left, right) => left - right);
}

function inferStep(chain, expirationDate) {
  const strikes = uniqueStrikes(chain, expirationDate);
  const diffs = [];
  for (let index = 1; index < strikes.length; index += 1) {
    diffs.push(strikes[index] - strikes[index - 1]);
  }
  return diffs.sort((left, right) => left - right)[0] || Math.max(getUnderlyingPrice(chain) * 0.05, 1000);
}

function chooseOffset(chain, expirationDate, optionType, offsetSteps) {
  const spot = getUnderlyingPrice(chain);
  const step = inferStep(chain, expirationDate);
  return chooseByStrike(chain, expirationDate, optionType, spot + offsetSteps * step);
}

function optionLeg(role, side, option, quantity = 1, priceBasis = DEFAULT_PRICE_BASIS) {
  return {
    id: role,
    role,
    type: 'option',
    side,
    instrumentName: option.instrumentName,
    optionType: option.optionType,
    expirationDate: option.expirationDate,
    expirationTimestamp: option.expirationTimestamp,
    strike: option.strike,
    quantity,
    entryPrice: getPrice(option, priceBasis),
    entryIv: option.markIv ?? null,
    underlyingPrice: option.underlyingPrice ?? null,
    interestRate: option.interestRate ?? 0,
    greeks: option.greeks || null,
    priceBasis,
  };
}

function underlyingLeg(role, side, quantity, entryPrice, extra = {}) {
  return {
    id: role,
    role,
    type: 'underlying',
    side,
    quantity,
    entryPrice,
    underlyingPrice: entryPrice,
    ...extra,
  };
}

function legSideMultiplier(side) {
  return side === 'sell' || side === 'short' ? -1 : 1;
}

function getLegDelta(leg) {
  const greekDelta = Number(leg?.greeks?.delta);
  if (Number.isFinite(greekDelta)) return greekDelta;
  if (leg?.optionType === 'call') return 0.5;
  if (leg?.optionType === 'put') return -0.5;
  return 0;
}

function calculateOptionNetDelta(legs = []) {
  return legs
    .filter(leg => leg.type === 'option')
    .reduce((total, leg) => (
      total + legSideMultiplier(leg.side) * (Number(leg.quantity) || 1) * getLegDelta(leg)
    ), 0);
}

function buildDeltaHedgeLeg(optionNetDelta, underlyingPrice) {
  return underlyingLeg(
    'delta-hedge',
    optionNetDelta >= 0 ? 'short' : 'long',
    Number(Math.abs(optionNetDelta).toFixed(6)),
    underlyingPrice,
    {
      instrumentName: 'BTC-PERP / 现货对冲',
      hedgePurpose: 'delta-neutral',
    }
  );
}

function withGammaScalpingDeltaHedge(legs, underlyingPrice) {
  const optionLegs = legs.filter(leg => leg.type === 'option');
  const otherLegs = legs.filter(leg => leg.type !== 'option' && leg.role !== 'delta-hedge');
  const optionNetDelta = calculateOptionNetDelta(optionLegs);
  return [
    ...optionLegs,
    buildDeltaHedgeLeg(optionNetDelta, underlyingPrice),
    ...otherLegs,
  ];
}

function buildCommonSetup({
  strategyId,
  chain,
  now = Date.now(),
  priceBasis = DEFAULT_PRICE_BASIS,
  selectedExpiration = null,
}, buildLegs) {
  const blueprint = getStrategyBlueprint(strategyId);
  const underlyingPrice = getUnderlyingPrice(chain);
  const legs = buildLegs({ chain, now, priceBasis, underlyingPrice, selectedExpiration });
  const optionLegs = legs.filter(leg => leg.type === 'option');
  const expirations = getExpirations(chain, now);

  return {
    strategyId,
    nameZh: blueprint.nameZh,
    nameEn: blueprint.nameEn,
    description: blueprint.description,
    priceBasis,
    underlyingPrice,
    generatedAt: new Date(now).toISOString(),
    source: 'Deribit public API',
    legs,
    controls: {
      expirations,
      selectedExpiration: optionLegs[0]?.expirationDate || expirations[0] || null,
      priceBasisOptions: ['mark', 'mid', 'bid', 'ask'],
      quantityStep: 0.1,
    },
    rationale: blueprint.rationale,
    riskLabel: blueprint.riskLabel,
  };
}

function sameExpiry(chain, now, selectedExpiration = null) {
  return chooseExpiration(chain, now, 'primary', selectedExpiration);
}

function makeStraddle(side) {
  return ({ chain, now, priceBasis, selectedExpiration }) => {
    const expiration = sameExpiry(chain, now, selectedExpiration);
    return [
      optionLeg(`${side}-atm-call`, side, chooseAtm(chain, expiration, 'call'), 1, priceBasis),
      optionLeg(`${side}-atm-put`, side, chooseAtm(chain, expiration, 'put'), 1, priceBasis),
    ];
  };
}

function makeStrangle(side) {
  return ({ chain, now, priceBasis, selectedExpiration }) => {
    const expiration = sameExpiry(chain, now, selectedExpiration);
    return [
      optionLeg(`${side}-otm-call`, side, chooseOffset(chain, expiration, 'call', 1), 1, priceBasis),
      optionLeg(`${side}-otm-put`, side, chooseOffset(chain, expiration, 'put', -1), 1, priceBasis),
    ];
  };
}

function ironCondor({ chain, now, priceBasis, selectedExpiration }) {
  const expiration = sameExpiry(chain, now, selectedExpiration);
  return [
    optionLeg('long-put-wing', 'buy', chooseOffset(chain, expiration, 'put', -3), 1, priceBasis),
    optionLeg('short-put', 'sell', chooseOffset(chain, expiration, 'put', -1), 1, priceBasis),
    optionLeg('short-call', 'sell', chooseOffset(chain, expiration, 'call', 1), 1, priceBasis),
    optionLeg('long-call-wing', 'buy', chooseOffset(chain, expiration, 'call', 3), 1, priceBasis),
  ];
}

function calendarSpread({ chain, now, priceBasis, selectedExpiration }) {
  const near = chooseExpiration(chain, now, 'primary', selectedExpiration);
  const far = chooseExpiration(chain, now, 'far', selectedExpiration);
  const nearCall = chooseAtm(chain, near, 'call');
  const farCall = chooseByStrike(chain, far, 'call', nearCall.strike);
  return [
    optionLeg('near-short-call', 'sell', nearCall, 1, priceBasis),
    optionLeg('far-long-call', 'buy', farCall, 1, priceBasis),
  ];
}

function diagonalSpread({ chain, now, priceBasis, selectedExpiration }) {
  const near = chooseExpiration(chain, now, 'primary', selectedExpiration);
  const far = chooseExpiration(chain, now, 'far', selectedExpiration);
  return [
    optionLeg('far-long-call', 'buy', chooseAtm(chain, far, 'call'), 1, priceBasis),
    optionLeg('near-short-call', 'sell', chooseOffset(chain, near, 'call', 1), 1, priceBasis),
  ];
}

function butterfly({ chain, now, priceBasis, selectedExpiration }) {
  const expiration = sameExpiry(chain, now, selectedExpiration);
  return [
    optionLeg('long-low-call', 'buy', chooseOffset(chain, expiration, 'call', -1), 1, priceBasis),
    optionLeg('short-middle-call', 'sell', chooseAtm(chain, expiration, 'call'), 2, priceBasis),
    optionLeg('long-high-call', 'buy', chooseOffset(chain, expiration, 'call', 1), 1, priceBasis),
  ];
}

function collar({ chain, now, priceBasis, underlyingPrice, selectedExpiration }) {
  const expiration = sameExpiry(chain, now, selectedExpiration);
  return [
    underlyingLeg('spot-btc', 'long', 1, underlyingPrice),
    optionLeg('protective-put', 'buy', chooseOffset(chain, expiration, 'put', -1), 1, priceBasis),
    optionLeg('covered-call', 'sell', chooseOffset(chain, expiration, 'call', 1), 1, priceBasis),
  ];
}

function putSpreadCollar({ chain, now, priceBasis, underlyingPrice, selectedExpiration }) {
  const expiration = sameExpiry(chain, now, selectedExpiration);
  return [
    underlyingLeg('spot-btc', 'long', 1, underlyingPrice),
    optionLeg('long-protective-put', 'buy', chooseOffset(chain, expiration, 'put', -1), 1, priceBasis),
    optionLeg('short-lower-put', 'sell', chooseOffset(chain, expiration, 'put', -2), 1, priceBasis),
    optionLeg('covered-call', 'sell', chooseOffset(chain, expiration, 'call', 1), 1, priceBasis),
  ];
}

function gammaScalping({ chain, now, priceBasis, underlyingPrice, selectedExpiration }) {
  const expiration = sameExpiry(chain, now, selectedExpiration);
  const optionLegs = [
    optionLeg('long-gamma-call', 'buy', chooseAtm(chain, expiration, 'call'), 1, priceBasis),
    optionLeg('long-gamma-put', 'buy', chooseAtm(chain, expiration, 'put'), 1, priceBasis),
  ];
  return withGammaScalpingDeltaHedge(optionLegs, underlyingPrice);
}

function bullCallSpread({ chain, now, priceBasis, selectedExpiration }) {
  const expiration = sameExpiry(chain, now, selectedExpiration);
  return [
    optionLeg('long-lower-call', 'buy', chooseAtm(chain, expiration, 'call'), 1, priceBasis),
    optionLeg('short-higher-call', 'sell', chooseOffset(chain, expiration, 'call', 1), 1, priceBasis),
  ];
}

function bullPutSpread({ chain, now, priceBasis, selectedExpiration }) {
  const expiration = sameExpiry(chain, now, selectedExpiration);
  return [
    optionLeg('short-higher-put', 'sell', chooseOffset(chain, expiration, 'put', -1), 1, priceBasis),
    optionLeg('long-lower-put', 'buy', chooseOffset(chain, expiration, 'put', -2), 1, priceBasis),
  ];
}

function bearPutSpread({ chain, now, priceBasis, selectedExpiration }) {
  const expiration = sameExpiry(chain, now, selectedExpiration);
  return [
    optionLeg('long-higher-put', 'buy', chooseAtm(chain, expiration, 'put'), 1, priceBasis),
    optionLeg('short-lower-put', 'sell', chooseOffset(chain, expiration, 'put', -1), 1, priceBasis),
  ];
}

function riskReversal({ chain, now, priceBasis, selectedExpiration }) {
  const expiration = sameExpiry(chain, now, selectedExpiration);
  return [
    optionLeg('short-put', 'sell', chooseOffset(chain, expiration, 'put', -1), 1, priceBasis),
    optionLeg('long-call', 'buy', chooseOffset(chain, expiration, 'call', 1), 1, priceBasis),
  ];
}

function syntheticLongStock({ chain, now, priceBasis, selectedExpiration }) {
  const expiration = sameExpiry(chain, now, selectedExpiration);
  const call = chooseAtm(chain, expiration, 'call');
  return [
    optionLeg('long-call', 'buy', call, 1, priceBasis),
    optionLeg('short-put', 'sell', chooseByStrike(chain, expiration, 'put', call.strike), 1, priceBasis),
  ];
}

function bullishCrab({ chain, now, priceBasis, selectedExpiration }) {
  const expiration = sameExpiry(chain, now, selectedExpiration);
  return [
    optionLeg('long-low-call', 'buy', chooseOffset(chain, expiration, 'call', -1), 1, priceBasis),
    optionLeg('short-middle-call', 'sell', chooseAtm(chain, expiration, 'call'), 1, priceBasis),
    optionLeg('short-upper-call', 'sell', chooseOffset(chain, expiration, 'call', 1), 1, priceBasis),
    optionLeg('long-far-call', 'buy', chooseOffset(chain, expiration, 'call', 3), 1, priceBasis),
  ];
}

function ratioSpread({ chain, now, priceBasis, selectedExpiration }) {
  const expiration = sameExpiry(chain, now, selectedExpiration);
  return [
    optionLeg('short-lower-call', 'sell', chooseAtm(chain, expiration, 'call'), 1, priceBasis),
    optionLeg('long-higher-calls', 'buy', chooseOffset(chain, expiration, 'call', 1), 2, priceBasis),
  ];
}

function bullThreeLeg({ chain, now, priceBasis, selectedExpiration }) {
  const expiration = sameExpiry(chain, now, selectedExpiration);
  return [
    optionLeg('short-lower-put', 'sell', chooseOffset(chain, expiration, 'put', -1), 1, priceBasis),
    optionLeg('long-middle-call', 'buy', chooseAtm(chain, expiration, 'call'), 1, priceBasis),
    optionLeg('short-upper-call', 'sell', chooseOffset(chain, expiration, 'call', 1), 1, priceBasis),
  ];
}

function alligatorStrategy({ chain, now, priceBasis, selectedExpiration }) {
  const expiration = sameExpiry(chain, now, selectedExpiration);
  return [
    optionLeg('long-lower-call', 'buy', chooseAtm(chain, expiration, 'call'), 1, priceBasis),
    optionLeg('short-higher-call', 'sell', chooseOffset(chain, expiration, 'call', 1), 1, priceBasis),
    optionLeg('extra-long-call', 'buy', chooseOffset(chain, expiration, 'call', 2), 1, priceBasis),
  ];
}

const buildById = {
  'long-straddle': makeStraddle('buy'),
  'long-strangle': makeStrangle('buy'),
  'short-straddle': makeStraddle('sell'),
  'short-strangle': makeStrangle('sell'),
  'calendar-spread': calendarSpread,
  'diagonal-spread': diagonalSpread,
  butterfly,
  collar,
  'put-spread-collar': putSpreadCollar,
  'gamma-scalping': gammaScalping,
  'iron-condor': ironCondor,
  'bull-call-spread': bullCallSpread,
  'bull-put-spread': bullPutSpread,
  'bear-put-spread': bearPutSpread,
  'risk-reversal': riskReversal,
  'synthetic-long-stock': syntheticLongStock,
  'bullish-crab': bullishCrab,
  'ratio-spread': ratioSpread,
  'bull-three-leg': bullThreeLeg,
  'alligator-strategy': alligatorStrategy,
};

const blueprints = OPTIONS_STRATEGY_CATALOG.map(strategy => ({
  id: strategy.id,
  nameZh: strategy.nameZh,
  nameEn: strategy.nameEn,
  description: strategy.whenToUse,
  rationale: strategy.setup,
  riskLabel: strategy.risks?.[0] || '策略风险',
  buildLegs: buildById[strategy.id],
}));

function listStrategyBlueprints() {
  return blueprints.map(({ buildLegs, ...blueprint }) => blueprint);
}

function getStrategyBlueprint(strategyId) {
  const blueprint = blueprints.find(item => item.id === strategyId);
  if (!blueprint || typeof blueprint.buildLegs !== 'function') {
    throw new Error(`Unsupported options strategy: ${strategyId}`);
  }
  return blueprint;
}

function buildStrategySetup({
  strategyId,
  chain,
  now = Date.now(),
  priceBasis = DEFAULT_PRICE_BASIS,
  expirationDate = null,
  selectedExpiration = expirationDate,
}) {
  if (!chain || !Array.isArray(chain.options)) {
    throw new Error('A normalized BTC option chain is required');
  }

  const blueprint = getStrategyBlueprint(strategyId);
  return buildCommonSetup({ strategyId, chain, now, priceBasis, selectedExpiration }, blueprint.buildLegs);
}

function rebalanceStrategySetupHedges(setup) {
  if (setup?.strategyId !== 'gamma-scalping') return setup;
  return {
    ...setup,
    legs: withGammaScalpingDeltaHedge(setup.legs || [], setup.underlyingPrice),
  };
}

module.exports = {
  DEFAULT_PRICE_BASIS,
  buildStrategySetup,
  getPrice,
  getStrategyBlueprint,
  listStrategyBlueprints,
  rebalanceStrategySetupHedges,
  __testUtils: {
    calculateOptionNetDelta,
    chooseAtm,
    chooseOffset,
    inferStep,
  },
};
