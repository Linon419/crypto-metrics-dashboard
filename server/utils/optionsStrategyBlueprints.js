const { OPTIONS_STRATEGY_CATALOG } = require('../../scripts/optionsStrategyCatalog');

const DEFAULT_PRICE_BASIS = 'mark';

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

function getExpirations(chain, now = Date.now()) {
  return [...new Set(chain.options
    .filter(option => option.state === 'open' && option.expirationTimestamp > now)
    .sort((left, right) => left.expirationTimestamp - right.expirationTimestamp)
    .map(option => option.expirationDate))];
}

function chooseExpiration(chain, now, mode = 'primary') {
  const expirations = getExpirations(chain, now);
  if (expirations.length === 0) {
    throw new Error('No BTC option expirations are available');
  }
  if (mode === 'far') {
    return expirations[Math.min(1, expirations.length - 1)];
  }
  return expirations[0];
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

function underlyingLeg(role, side, quantity, entryPrice) {
  return {
    id: role,
    role,
    type: 'underlying',
    side,
    quantity,
    entryPrice,
    underlyingPrice: entryPrice,
  };
}

function buildCommonSetup({ strategyId, chain, now = Date.now(), priceBasis = DEFAULT_PRICE_BASIS }, buildLegs) {
  const blueprint = getStrategyBlueprint(strategyId);
  const underlyingPrice = getUnderlyingPrice(chain);
  const legs = buildLegs({ chain, now, priceBasis, underlyingPrice });
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

function sameExpiry(chain, now) {
  return chooseExpiration(chain, now, 'primary');
}

function makeStraddle(side) {
  return ({ chain, now, priceBasis }) => {
    const expiration = sameExpiry(chain, now);
    return [
      optionLeg(`${side}-atm-call`, side, chooseAtm(chain, expiration, 'call'), 1, priceBasis),
      optionLeg(`${side}-atm-put`, side, chooseAtm(chain, expiration, 'put'), 1, priceBasis),
    ];
  };
}

function makeStrangle(side) {
  return ({ chain, now, priceBasis }) => {
    const expiration = sameExpiry(chain, now);
    return [
      optionLeg(`${side}-otm-call`, side, chooseOffset(chain, expiration, 'call', 1), 1, priceBasis),
      optionLeg(`${side}-otm-put`, side, chooseOffset(chain, expiration, 'put', -1), 1, priceBasis),
    ];
  };
}

function ironCondor({ chain, now, priceBasis }) {
  const expiration = sameExpiry(chain, now);
  return [
    optionLeg('long-put-wing', 'buy', chooseOffset(chain, expiration, 'put', -3), 1, priceBasis),
    optionLeg('short-put', 'sell', chooseOffset(chain, expiration, 'put', -1), 1, priceBasis),
    optionLeg('short-call', 'sell', chooseOffset(chain, expiration, 'call', 1), 1, priceBasis),
    optionLeg('long-call-wing', 'buy', chooseOffset(chain, expiration, 'call', 3), 1, priceBasis),
  ];
}

function calendarSpread({ chain, now, priceBasis }) {
  const near = chooseExpiration(chain, now, 'primary');
  const far = chooseExpiration(chain, now, 'far');
  const nearCall = chooseAtm(chain, near, 'call');
  const farCall = chooseByStrike(chain, far, 'call', nearCall.strike);
  return [
    optionLeg('near-short-call', 'sell', nearCall, 1, priceBasis),
    optionLeg('far-long-call', 'buy', farCall, 1, priceBasis),
  ];
}

function diagonalSpread({ chain, now, priceBasis }) {
  const near = chooseExpiration(chain, now, 'primary');
  const far = chooseExpiration(chain, now, 'far');
  return [
    optionLeg('far-long-call', 'buy', chooseAtm(chain, far, 'call'), 1, priceBasis),
    optionLeg('near-short-call', 'sell', chooseOffset(chain, near, 'call', 1), 1, priceBasis),
  ];
}

function butterfly({ chain, now, priceBasis }) {
  const expiration = sameExpiry(chain, now);
  return [
    optionLeg('long-low-call', 'buy', chooseOffset(chain, expiration, 'call', -1), 1, priceBasis),
    optionLeg('short-middle-call', 'sell', chooseAtm(chain, expiration, 'call'), 2, priceBasis),
    optionLeg('long-high-call', 'buy', chooseOffset(chain, expiration, 'call', 1), 1, priceBasis),
  ];
}

function collar({ chain, now, priceBasis, underlyingPrice }) {
  const expiration = sameExpiry(chain, now);
  return [
    underlyingLeg('spot-btc', 'long', 1, underlyingPrice),
    optionLeg('protective-put', 'buy', chooseOffset(chain, expiration, 'put', -1), 1, priceBasis),
    optionLeg('covered-call', 'sell', chooseOffset(chain, expiration, 'call', 1), 1, priceBasis),
  ];
}

function putSpreadCollar({ chain, now, priceBasis, underlyingPrice }) {
  const expiration = sameExpiry(chain, now);
  return [
    underlyingLeg('spot-btc', 'long', 1, underlyingPrice),
    optionLeg('long-protective-put', 'buy', chooseOffset(chain, expiration, 'put', -1), 1, priceBasis),
    optionLeg('short-lower-put', 'sell', chooseOffset(chain, expiration, 'put', -2), 1, priceBasis),
    optionLeg('covered-call', 'sell', chooseOffset(chain, expiration, 'call', 1), 1, priceBasis),
  ];
}

function gammaScalping({ chain, now, priceBasis }) {
  const expiration = sameExpiry(chain, now);
  return [
    optionLeg('long-gamma-call', 'buy', chooseAtm(chain, expiration, 'call'), 1, priceBasis),
    optionLeg('long-gamma-put', 'buy', chooseAtm(chain, expiration, 'put'), 1, priceBasis),
  ];
}

function bullCallSpread({ chain, now, priceBasis }) {
  const expiration = sameExpiry(chain, now);
  return [
    optionLeg('long-lower-call', 'buy', chooseAtm(chain, expiration, 'call'), 1, priceBasis),
    optionLeg('short-higher-call', 'sell', chooseOffset(chain, expiration, 'call', 1), 1, priceBasis),
  ];
}

function bullPutSpread({ chain, now, priceBasis }) {
  const expiration = sameExpiry(chain, now);
  return [
    optionLeg('short-higher-put', 'sell', chooseOffset(chain, expiration, 'put', -1), 1, priceBasis),
    optionLeg('long-lower-put', 'buy', chooseOffset(chain, expiration, 'put', -2), 1, priceBasis),
  ];
}

function bearPutSpread({ chain, now, priceBasis }) {
  const expiration = sameExpiry(chain, now);
  return [
    optionLeg('long-higher-put', 'buy', chooseAtm(chain, expiration, 'put'), 1, priceBasis),
    optionLeg('short-lower-put', 'sell', chooseOffset(chain, expiration, 'put', -1), 1, priceBasis),
  ];
}

function riskReversal({ chain, now, priceBasis }) {
  const expiration = sameExpiry(chain, now);
  return [
    optionLeg('short-put', 'sell', chooseOffset(chain, expiration, 'put', -1), 1, priceBasis),
    optionLeg('long-call', 'buy', chooseOffset(chain, expiration, 'call', 1), 1, priceBasis),
  ];
}

function syntheticLongStock({ chain, now, priceBasis }) {
  const expiration = sameExpiry(chain, now);
  const call = chooseAtm(chain, expiration, 'call');
  return [
    optionLeg('long-call', 'buy', call, 1, priceBasis),
    optionLeg('short-put', 'sell', chooseByStrike(chain, expiration, 'put', call.strike), 1, priceBasis),
  ];
}

function bullishCrab({ chain, now, priceBasis }) {
  const expiration = sameExpiry(chain, now);
  return [
    optionLeg('long-low-call', 'buy', chooseOffset(chain, expiration, 'call', -1), 1, priceBasis),
    optionLeg('short-middle-call', 'sell', chooseAtm(chain, expiration, 'call'), 1, priceBasis),
    optionLeg('short-upper-call', 'sell', chooseOffset(chain, expiration, 'call', 1), 1, priceBasis),
    optionLeg('long-far-call', 'buy', chooseOffset(chain, expiration, 'call', 3), 1, priceBasis),
  ];
}

function ratioSpread({ chain, now, priceBasis }) {
  const expiration = sameExpiry(chain, now);
  return [
    optionLeg('short-lower-call', 'sell', chooseAtm(chain, expiration, 'call'), 1, priceBasis),
    optionLeg('long-higher-calls', 'buy', chooseOffset(chain, expiration, 'call', 1), 2, priceBasis),
  ];
}

function bullThreeLeg({ chain, now, priceBasis }) {
  const expiration = sameExpiry(chain, now);
  return [
    optionLeg('short-lower-put', 'sell', chooseOffset(chain, expiration, 'put', -1), 1, priceBasis),
    optionLeg('long-middle-call', 'buy', chooseAtm(chain, expiration, 'call'), 1, priceBasis),
    optionLeg('short-upper-call', 'sell', chooseOffset(chain, expiration, 'call', 1), 1, priceBasis),
  ];
}

function alligatorStrategy({ chain, now, priceBasis }) {
  const expiration = sameExpiry(chain, now);
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

function buildStrategySetup({ strategyId, chain, now = Date.now(), priceBasis = DEFAULT_PRICE_BASIS }) {
  if (!chain || !Array.isArray(chain.options)) {
    throw new Error('A normalized BTC option chain is required');
  }

  const blueprint = getStrategyBlueprint(strategyId);
  return buildCommonSetup({ strategyId, chain, now, priceBasis }, blueprint.buildLegs);
}

module.exports = {
  DEFAULT_PRICE_BASIS,
  buildStrategySetup,
  getPrice,
  getStrategyBlueprint,
  listStrategyBlueprints,
  __testUtils: {
    chooseAtm,
    chooseOffset,
    inferStep,
  },
};
