const assert = require('assert');

const {
  KLINE_MARKETS,
  buildDefaultKlineMappingsForCoins,
  getDefaultKlineMappingForSymbol,
  normalizeKlineMappingInput,
  resolveDisplayedKlineMapping,
  resolveEffectiveKlineMapping,
} = require('../utils/coinKlineMappings');

async function run() {
  assert.deepStrictEqual(Object.keys(KLINE_MARKETS).sort(), [
    'BINANCE_SPOT',
    'BINANCE_USDM_PERPETUAL',
    'DERIBIT_BTC_DVOL',
    'YAHOO_FINANCE',
  ]);

  assert.deepStrictEqual(normalizeKlineMappingInput({
    market: 'binance_usdm_perpetual',
    trading_symbol: 'btc',
    enabled: true,
    notes: ' core ',
  }), {
    market: 'binance_usdm_perpetual',
    trading_symbol: 'BTCUSDT',
    enabled: true,
    notes: 'core',
  });

  assert.deepStrictEqual(normalizeKlineMappingInput({
    market: 'yahoo_finance',
    tradingSymbol: '159819.SZ',
    enabled: false,
  }), {
    market: 'yahoo_finance',
    trading_symbol: '159819.SZ',
    enabled: false,
    notes: null,
  });

  assert.throws(() => normalizeKlineMappingInput({
    market: 'unknown_source',
    trading_symbol: 'BTCUSDT',
  }), /Unsupported kline market/);

  assert.throws(() => normalizeKlineMappingInput({
    market: 'yahoo_finance',
    trading_symbol: '',
  }), /Trading symbol is required/);

  assert.deepStrictEqual(getDefaultKlineMappingForSymbol('CN_AI_ETF'), {
    market: 'yahoo_finance',
    trading_symbol: '159819.SZ',
    enabled: true,
    notes: '默认映射',
  });

  assert.deepStrictEqual(getDefaultKlineMappingForSymbol('GOLD'), {
    market: 'yahoo_finance',
    trading_symbol: 'XAU',
    enabled: true,
    notes: '默认映射',
  });

  assert.deepStrictEqual(getDefaultKlineMappingForSymbol('OIL'), {
    market: 'yahoo_finance',
    trading_symbol: 'BZ=F',
    enabled: true,
    notes: '默认映射',
  });

  const legacyGoldDefault = {
    market: 'yahoo_finance',
    trading_symbol: 'GLD',
    enabled: true,
    notes: '默认映射',
  };
  assert.deepStrictEqual(resolveEffectiveKlineMapping(
    { symbol: 'GOLD' },
    legacyGoldDefault
  ), {
    market: 'yahoo_finance',
    trading_symbol: 'XAU',
    enabled: true,
    notes: '默认映射',
  });
  assert.deepStrictEqual(resolveDisplayedKlineMapping(
    { symbol: 'GOLD' },
    legacyGoldDefault
  ), {
    market: 'yahoo_finance',
    trading_symbol: 'XAU',
    enabled: true,
    notes: '默认映射',
  });

  const legacyOilDefault = {
    market: 'yahoo_finance',
    trading_symbol: 'USO',
    enabled: true,
    notes: '默认映射',
  };
  assert.deepStrictEqual(resolveEffectiveKlineMapping(
    { symbol: 'OIL' },
    legacyOilDefault
  ), {
    market: 'yahoo_finance',
    trading_symbol: 'BZ=F',
    enabled: true,
    notes: '默认映射',
  });
  assert.deepStrictEqual(resolveDisplayedKlineMapping(
    { symbol: 'OIL' },
    legacyOilDefault
  ), {
    market: 'yahoo_finance',
    trading_symbol: 'BZ=F',
    enabled: true,
    notes: '默认映射',
  });

  ['ESTATE'].forEach(symbol => {
    assert.deepStrictEqual(getDefaultKlineMappingForSymbol(symbol), {
      market: 'yahoo_finance',
      trading_symbol: '^HSNP',
      enabled: true,
      notes: '默认映射',
    });
  });

  assert.deepStrictEqual(getDefaultKlineMappingForSymbol('VEGA'), {
    market: 'deribit_btc_dvol',
    trading_symbol: 'BTC-DVOL',
    enabled: true,
    notes: '默认映射',
  });

  assert.deepStrictEqual(getDefaultKlineMappingForSymbol('BTC'), {
    market: 'binance_usdm_perpetual',
    trading_symbol: 'BTCUSDT',
    enabled: true,
    notes: '默认映射',
  });

  assert.deepStrictEqual(resolveEffectiveKlineMapping(
    { symbol: 'CN_AI_ETF' },
    { market: 'yahoo_finance', trading_symbol: '159819.SZ', enabled: true, notes: 'custom' }
  ), {
    market: 'yahoo_finance',
    trading_symbol: '159819.SZ',
    enabled: true,
    notes: 'custom',
  });

  assert.deepStrictEqual(resolveEffectiveKlineMapping(
    { symbol: 'CN_AI_ETF' },
    { market: 'yahoo_finance', trading_symbol: 'BAD', enabled: false }
  ), {
    market: 'yahoo_finance',
    trading_symbol: '159819.SZ',
    enabled: true,
    notes: '默认映射',
  });

  const defaults = buildDefaultKlineMappingsForCoins([
    { id: 1, symbol: 'CN_AI_ETF' },
    { id: 2, symbol: 'BTC' },
    { id: 3, symbol: 'AXTI' },
  ], [
    { coin_id: 2, market: 'binance_usdm_perpetual', trading_symbol: 'BTCUSDT' },
  ]);

  assert.deepStrictEqual(defaults, [
    {
      coin_id: 1,
      coin_symbol: 'CN_AI_ETF',
      market: 'yahoo_finance',
      trading_symbol: '159819.SZ',
      enabled: true,
      notes: '默认映射',
    },
    {
      coin_id: 3,
      coin_symbol: 'AXTI',
      market: 'yahoo_finance',
      trading_symbol: 'AXTI',
      enabled: true,
      notes: '默认映射',
    },
  ]);

  console.log('coinKlineMappings tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
