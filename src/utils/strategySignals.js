const EARLY_ENTRY_DAYS = 3;
const STRONG_CHANGE_PERCENT = 30;

const toNumber = (value) => {
  const number = parseFloat(value);
  return Number.isFinite(number) ? number : null;
};

const getPrevData = (coin) => coin?.previousDayData || coin?.previous_day_data || null;

const getRiskNotes = (coin) => {
  const notes = coin?.riskNotes || coin?.risk_notes;
  return Array.isArray(notes) ? notes.filter(Boolean) : [];
};

const getMarketContext = (marketCoins = []) => {
  const majors = marketCoins.filter(coin => ['BTC', 'ETH'].includes(coin.symbol));
  const majorEntryCount = majors.filter(coin => coin.entryExitType === 'entry').length;
  const majorExitCount = majors.filter(coin => coin.entryExitType === 'exit').length;
  const majorOtcAbove1000Count = majors.filter(coin => toNumber(coin.otcIndex) >= 1000).length;

  return {
    longSupport: majorEntryCount > 0 || majorOtcAbove1000Count > 0,
    shortSupport: majorExitCount > 0 && majorOtcAbove1000Count === 0,
  };
};

const getLiquidityContext = (liquidity) => {
  const totalChange = toNumber(liquidity?.total_market_fund_change);
  return {
    longSupport: totalChange !== null && totalChange > 0,
    shortSupport: totalChange !== null && totalChange < 0,
  };
};

const isLongQuality = (quality) => (
  quality === '高质量进场' ||
  quality === '修复型进场' ||
  quality === '观察型进场'
);

const isShortQuality = (quality) => (
  quality === '高质量退场' ||
  quality === '修复型退场' ||
  quality === '观察型退场'
);

const isWeakQuality = (quality) => quality?.includes('低质量');

const makeSignal = ({ direction, risk, reasons, confirmations, warnings }) => {
  const confirmed = confirmations.length >= 2;
  const color = direction === 'long' ? 'success' : 'error';
  const prefix = direction === 'long' ? '做多' : '做空';
  const riskText = risk === 'low' ? '稳健' : risk === 'medium' ? '确认' : '高风险';

  return {
    direction,
    color,
    risk,
    confirmed,
    label: `${prefix}：${riskText}`,
    reasons,
    confirmations,
    warnings,
    description: [...reasons, ...confirmations].slice(0, 3).join(' / '),
  };
};

export function evaluateStrategySignal(coin, { marketCoins = [], liquidity = null } = {}) {
  const prevData = getPrevData(coin);
  const riskNotes = getRiskNotes(coin);
  if (!coin || !prevData) {
    return {
      direction: 'neutral',
      color: 'default',
      label: '数据不足',
      reasons: [],
      confirmations: [],
      warnings: ['缺少前一日数据', ...riskNotes],
    };
  }

  const prevExplosion = toNumber(prevData.explosion_index);
  const currExplosion = toNumber(coin.explosionIndex);
  const currOtc = toNumber(coin.otcIndex);
  const prevOtc = toNumber(prevData.otc_index);
  const explosionChangePercent = toNumber(coin.explosionIndexChangePercent);
  const quality = coin.period_quality;
  const market = getMarketContext(marketCoins);
  const liquidityContext = getLiquidityContext(liquidity);

  if (prevExplosion === null || currExplosion === null) {
    return {
      direction: 'neutral',
      color: 'default',
      label: '数据错误',
      reasons: [],
      confirmations: [],
      warnings: ['爆破指数缺失'],
    };
  }

  const longReasons = [];
  if (prevExplosion < 0 && currExplosion > 0) longReasons.push('爆破指数负变正');
  if (coin.entryExitType === 'entry' && (coin.entryExitDay || 0) <= EARLY_ENTRY_DAYS) longReasons.push('进场期初期');
  if (explosionChangePercent !== null && explosionChangePercent > STRONG_CHANGE_PERCENT) longReasons.push('爆破指数动能增强');

  const longConfirmations = [];
  if (currOtc !== null && currOtc >= 1000) longConfirmations.push('场外指数站上1000');
  if (currOtc !== null && prevOtc !== null && currOtc > prevOtc) longConfirmations.push('场外指数抬升');
  if (isLongQuality(quality)) longConfirmations.push(quality);
  if (market.longSupport) longConfirmations.push('BTC/ETH大盘支持');
  if (liquidityContext.longSupport) longConfirmations.push('市场流动性流入');

  const longWarnings = [];
  longWarnings.push(...riskNotes);
  if (isWeakQuality(quality)) longWarnings.push(quality);
  if (market.shortSupport) longWarnings.push('BTC/ETH大盘偏退场');
  if (liquidityContext.shortSupport) longWarnings.push('市场流动性流出');

  const shortReasons = [];
  if (prevExplosion >= 200 && currExplosion < 200) shortReasons.push('爆破指数跌破200');
  if (coin.entryExitType === 'exit' && (coin.entryExitDay || 0) === 1) shortReasons.push('退场期第一天');
  if (explosionChangePercent !== null && explosionChangePercent < -STRONG_CHANGE_PERCENT) shortReasons.push('爆破指数动能转弱');

  const shortConfirmations = [];
  if (coin.entryExitType === 'exit') shortConfirmations.push('处于退场期');
  if (currOtc !== null && currOtc < 1000) shortConfirmations.push('场外指数低于1000');
  if (currOtc !== null && prevOtc !== null && currOtc < prevOtc) shortConfirmations.push('场外指数回落');
  if (isShortQuality(quality)) shortConfirmations.push(quality);
  if (market.shortSupport) shortConfirmations.push('BTC/ETH大盘偏退场');
  if (liquidityContext.shortSupport) shortConfirmations.push('市场流动性流出');

  const shortWarnings = [];
  shortWarnings.push(...riskNotes);
  if (market.longSupport) shortWarnings.push('BTC/ETH大盘仍有支撑');
  if (liquidityContext.longSupport) shortWarnings.push('市场流动性流入');

  const longSignal = longReasons.length > 0
    ? makeSignal({
      direction: 'long',
      risk: longConfirmations.length >= 3 ? 'low' : longConfirmations.length >= 1 ? 'medium' : 'high',
      reasons: longReasons,
      confirmations: longConfirmations,
      warnings: longWarnings,
    })
    : null;

  const shortSignal = shortReasons.length > 0
    ? makeSignal({
      direction: 'short',
      risk: shortConfirmations.length >= 3 ? 'low' : shortConfirmations.length >= 1 ? 'medium' : 'high',
      reasons: shortReasons,
      confirmations: shortConfirmations,
      warnings: shortWarnings,
    })
    : null;

  if (longSignal && shortSignal) {
    return shortSignal.confirmations.length > longSignal.confirmations.length ? shortSignal : longSignal;
  }

  return longSignal || shortSignal || {
    direction: 'neutral',
    color: 'default',
    label: currExplosion >= 200 ? '观望' : '风险注意',
    reasons: [],
    confirmations: [],
    warnings: riskNotes,
  };
}

export function hasStrategyDirection(coin, direction, context) {
  const signal = evaluateStrategySignal(coin, context);
  return signal.direction === direction;
}
