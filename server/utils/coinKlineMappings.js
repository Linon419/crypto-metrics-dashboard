const KLINE_MARKETS = Object.freeze({
  BINANCE_USDM_PERPETUAL: 'binance_usdm_perpetual',
  BINANCE_SPOT: 'binance_spot',
  YAHOO_FINANCE: 'yahoo_finance',
  DERIBIT_BTC_DVOL: 'deribit_btc_dvol',
  CHINA_FUTURES_SINA: 'china_futures_sina',
});

const DERIBIT_BTC_DVOL_SYMBOL = 'BTC-DVOL';

const BINANCE_USDM_SYMBOL_ALIASES = Object.freeze({
  HYNIX: 'SKHYNIXUSDT',
  SAMSUNG: 'SAMSUNGUSDT',
  SK_HYNIX: 'SKHYNIXUSDT',
});

const CHINA_FUTURES_SINA_SYMBOL_ALIASES = Object.freeze({
  CN_HOG: 'LH0',
});

const YAHOO_SYMBOL_ALIASES = Object.freeze({
  A_SHARES: 'ASHR',
  A_SHARES_INDEX: 'ASHR',
  CIRCLE: 'CRCL',
  CN_AI_ETF: '159819.SZ',
  CN_INDEX: '000300.SS',
  CN_ROBOT: '562500.SS',
  ESTATE: '^HSNP',
  GOLD: 'XAU',
  NASDAO: '^IXIC',
  NASDAQ: '^IXIC',
  OIL: 'BZ=F',
  SILVER: 'SLV',
});

const YAHOO_FINANCE_COIN_SYMBOLS = new Set([
  ...Object.keys(YAHOO_SYMBOL_ALIASES),
  'AAOI',
  'AAPL',
  'AMZN',
  'AXTI',
  'BABA',
  'COIN',
  'GOOG',
  'HOOD',
  'MSFT',
  'MU',
  'NVDA',
  'ORCL',
  'PLTR',
  'SNDK',
  'TSLA',
]);

const DERIBIT_BTC_DVOL_COIN_SYMBOLS = new Set(['VEGA']);
const CHINA_FUTURES_SINA_COIN_SYMBOLS = new Set(Object.keys(CHINA_FUTURES_SINA_SYMBOL_ALIASES));
const VALID_MARKETS = new Set(Object.values(KLINE_MARKETS));
const LEGACY_YAHOO_DEFAULTS = Object.freeze({
  GOLD: 'GLD',
  OIL: 'USO',
});

function normalizeCoinSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function normalizeBinanceTradingSymbol(symbol) {
  const normalized = normalizeCoinSymbol(symbol);
  if (!normalized) return '';
  if (BINANCE_USDM_SYMBOL_ALIASES[normalized]) {
    return BINANCE_USDM_SYMBOL_ALIASES[normalized];
  }
  return normalized.endsWith('USDT') ? normalized : `${normalized}USDT`;
}

function normalizeTradingSymbolForMarket(market, tradingSymbol) {
  const trimmed = String(tradingSymbol || '').trim();
  if (!trimmed) {
    throw new Error('Trading symbol is required');
  }
  if (trimmed.length > 40) {
    throw new Error('Trading symbol must be 40 characters or fewer');
  }

  if (market === KLINE_MARKETS.BINANCE_USDM_PERPETUAL || market === KLINE_MARKETS.BINANCE_SPOT) {
    return normalizeBinanceTradingSymbol(trimmed);
  }
  if (market === KLINE_MARKETS.DERIBIT_BTC_DVOL) {
    return trimmed.toUpperCase();
  }
  if (market === KLINE_MARKETS.CHINA_FUTURES_SINA) {
    return trimmed.toUpperCase();
  }
  return trimmed;
}

function normalizeKlineMappingInput(input = {}) {
  const market = String(input.market || '').trim();
  if (!VALID_MARKETS.has(market)) {
    throw new Error(`Unsupported kline market: ${input.market}`);
  }

  const rawTradingSymbol = input.trading_symbol ?? input.tradingSymbol;
  return {
    market,
    trading_symbol: normalizeTradingSymbolForMarket(market, rawTradingSymbol),
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    notes: input.notes ? String(input.notes).trim() : null,
  };
}

function getYahooTradingSymbol(symbol) {
  const normalized = normalizeCoinSymbol(symbol);
  return YAHOO_SYMBOL_ALIASES[normalized] || normalized;
}

function shouldUseYahooFinance(symbol) {
  return YAHOO_FINANCE_COIN_SYMBOLS.has(normalizeCoinSymbol(symbol));
}

function shouldUseDeribitBtcDvol(symbol) {
  return DERIBIT_BTC_DVOL_COIN_SYMBOLS.has(normalizeCoinSymbol(symbol));
}

function getChinaFuturesSinaTradingSymbol(symbol) {
  const normalized = normalizeCoinSymbol(symbol);
  return CHINA_FUTURES_SINA_SYMBOL_ALIASES[normalized] || normalized;
}

function shouldUseChinaFuturesSina(symbol) {
  return CHINA_FUTURES_SINA_COIN_SYMBOLS.has(normalizeCoinSymbol(symbol));
}

function getDefaultKlineMappingForSymbol(symbol) {
  const normalized = normalizeCoinSymbol(symbol);
  if (!normalized) return null;

  if (shouldUseDeribitBtcDvol(normalized)) {
    return {
      market: KLINE_MARKETS.DERIBIT_BTC_DVOL,
      trading_symbol: DERIBIT_BTC_DVOL_SYMBOL,
      enabled: true,
      notes: '默认映射',
    };
  }

  if (shouldUseChinaFuturesSina(normalized)) {
    return {
      market: KLINE_MARKETS.CHINA_FUTURES_SINA,
      trading_symbol: getChinaFuturesSinaTradingSymbol(normalized),
      enabled: true,
      notes: '默认映射',
    };
  }

  if (shouldUseYahooFinance(normalized)) {
    return {
      market: KLINE_MARKETS.YAHOO_FINANCE,
      trading_symbol: getYahooTradingSymbol(normalized),
      enabled: true,
      notes: '默认映射',
    };
  }

  return {
    market: KLINE_MARKETS.BINANCE_USDM_PERPETUAL,
    trading_symbol: normalizeBinanceTradingSymbol(normalized),
    enabled: true,
    notes: '默认映射',
  };
}

function toPlainMapping(mapping) {
  if (!mapping) return null;
  if (typeof mapping.get === 'function') return mapping.get({ plain: true });
  return mapping;
}

function isLegacyDefaultKlineMapping(coin, mapping, currentDefault) {
  const coinSymbol = normalizeCoinSymbol(coin?.symbol ?? mapping?.coin_symbol);
  const legacyTradingSymbol = LEGACY_YAHOO_DEFAULTS[coinSymbol];
  return Boolean(
    legacyTradingSymbol
    && mapping?.market === KLINE_MARKETS.YAHOO_FINANCE
    && String(mapping?.trading_symbol || '').trim().toUpperCase() === legacyTradingSymbol
    && currentDefault?.market === KLINE_MARKETS.YAHOO_FINANCE
    && currentDefault?.trading_symbol !== legacyTradingSymbol
    && (!mapping?.notes || mapping.notes === '默认映射')
  );
}

function resolveDisplayedKlineMapping(coin, mapping) {
  const rawMapping = toPlainMapping(mapping);
  const currentDefault = getDefaultKlineMappingForSymbol(coin?.symbol ?? rawMapping?.coin_symbol);
  if (rawMapping && isLegacyDefaultKlineMapping(coin, rawMapping, currentDefault)) {
    return currentDefault;
  }
  return rawMapping || currentDefault;
}

async function findLatestMetricDate(DailyMetricModel) {
  if (!DailyMetricModel?.findOne) return null;

  const row = await DailyMetricModel.findOne({
    attributes: ['date'],
    order: [['date', 'DESC'], ['timestamp', 'DESC'], ['id', 'DESC']],
    raw: true,
  });
  return toPlainMapping(row)?.date || null;
}

async function findActiveMetricCoinIds(DailyMetricModel, latestMetricDate) {
  if (!DailyMetricModel?.findAll || !latestMetricDate) return null;

  const rows = await DailyMetricModel.findAll({
    attributes: ['coin_id'],
    where: { date: latestMetricDate },
    raw: true,
  });

  return new Set(
    rows
      .map(row => Number(toPlainMapping(row)?.coin_id))
      .filter(Number.isFinite)
  );
}

async function filterCoinsWithLatestMetrics(coins = [], DailyMetricModel) {
  const latestMetricDate = await findLatestMetricDate(DailyMetricModel);
  if (!latestMetricDate) {
    return {
      coins,
      latestMetricDate: null,
      skippedStaleMetrics: 0,
    };
  }

  const activeCoinIds = await findActiveMetricCoinIds(DailyMetricModel, latestMetricDate);
  if (!activeCoinIds) {
    return {
      coins,
      latestMetricDate,
      skippedStaleMetrics: 0,
    };
  }

  const activeCoins = coins.filter(coin => {
    const plainCoin = toPlainMapping(coin);
    return activeCoinIds.has(Number(plainCoin?.id));
  });

  return {
    coins: activeCoins,
    latestMetricDate,
    skippedStaleMetrics: Math.max(0, coins.length - activeCoins.length),
  };
}

function resolveEffectiveKlineMapping(coin, mapping) {
  const rawMapping = toPlainMapping(mapping);
  if (rawMapping?.enabled) {
    try {
      const currentDefault = getDefaultKlineMappingForSymbol(coin?.symbol ?? rawMapping.coin_symbol);
      if (isLegacyDefaultKlineMapping(coin, rawMapping, currentDefault)) {
        return currentDefault;
      }
      return normalizeKlineMappingInput(rawMapping);
    } catch (error) {
      return getDefaultKlineMappingForSymbol(coin?.symbol);
    }
  }
  return getDefaultKlineMappingForSymbol(coin?.symbol);
}

function buildDefaultKlineMappingsForCoins(coins = [], existingMappings = []) {
  const existingCoinIds = new Set(
    existingMappings
      .map(mapping => Number(mapping?.coin_id ?? mapping?.coinId))
      .filter(Number.isFinite)
  );

  return coins.reduce((rows, coin) => {
    const coinId = Number(coin?.id);
    const coinSymbol = normalizeCoinSymbol(coin?.symbol);
    if (!Number.isFinite(coinId) || !coinSymbol || existingCoinIds.has(coinId)) {
      return rows;
    }

    const mapping = getDefaultKlineMappingForSymbol(coinSymbol);
    if (!mapping) return rows;

    rows.push({
      coin_id: coinId,
      coin_symbol: coinSymbol,
      ...mapping,
    });
    return rows;
  }, []);
}

module.exports = {
  BINANCE_USDM_SYMBOL_ALIASES,
  DERIBIT_BTC_DVOL_SYMBOL,
  KLINE_MARKETS,
  CHINA_FUTURES_SINA_SYMBOL_ALIASES,
  YAHOO_SYMBOL_ALIASES,
  buildDefaultKlineMappingsForCoins,
  filterCoinsWithLatestMetrics,
  findActiveMetricCoinIds,
  findLatestMetricDate,
  getDefaultKlineMappingForSymbol,
  getChinaFuturesSinaTradingSymbol,
  getYahooTradingSymbol,
  normalizeBinanceTradingSymbol,
  normalizeCoinSymbol,
  normalizeKlineMappingInput,
  resolveDisplayedKlineMapping,
  resolveEffectiveKlineMapping,
  shouldUseChinaFuturesSina,
  shouldUseDeribitBtcDvol,
  shouldUseYahooFinance,
};
