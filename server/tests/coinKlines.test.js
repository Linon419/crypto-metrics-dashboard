const assert = require('assert');

const {
  DERIBIT_BTC_DVOL_MARKET,
  DERIBIT_BTC_DVOL_SYMBOL,
  YAHOO_FINANCE_MARKET,
  YAHOO_FINANCE_SYNC_MIN_INTERVAL_MS,
  buildCoinKlineBackfillChunks,
  buildBinanceUsdmKlinesUrl,
  buildYahooFinanceChartUrl,
  clearYahooSyncCache,
  fetchBinanceUsdmKlines,
  findCoinKlineBackfillGaps,
  findStoredCoinKlines,
  getPreferredKlineMarket,
  parseBinanceKlineRow,
  resolveYahooSymbol,
  shouldRefreshStoredCoinKlines,
  syncCoinKlines,
} = require('../utils/coinKlines');
const coinsRouter = require('../routes/coins');

async function run() {
  const defaultBackfillOptions = coinsRouter.__test.normalizeBackfillOptions({});
  assert.deepStrictEqual(defaultBackfillOptions.intervals, ['15m', '1h', '4h', '1d']);
  assert.strictEqual(defaultBackfillOptions.interval, '15m');
  assert.strictEqual(defaultBackfillOptions.limit, 1500);

  const legacyBackfillOptions = coinsRouter.__test.normalizeBackfillOptions({
    interval: '4h',
    limit: 2000,
    delayMs: 100,
    maxChunksPerCoin: 300,
  });
  assert.deepStrictEqual(legacyBackfillOptions.intervals, ['4h']);
  assert.strictEqual(legacyBackfillOptions.limit, 1500);
  assert.strictEqual(legacyBackfillOptions.delayMs, 3000);
  assert.strictEqual(legacyBackfillOptions.maxChunksPerCoin, 200);

  const multiBackfillOptions = coinsRouter.__test.normalizeBackfillOptions({
    intervals: ['4h', '1h', '4h', '1d'],
  });
  assert.deepStrictEqual(multiBackfillOptions.intervals, ['4h', '1h', '1d']);

  const row = [
    Date.UTC(2026, 0, 1),
    '100.5',
    '111.25',
    '95.75',
    '108.125',
    '1234.5',
    Date.UTC(2026, 0, 1, 23, 59, 59, 999),
    '130000',
    2500,
    '620.2',
    '65500',
    '0',
  ];

  const parsed = parseBinanceKlineRow(row, {
    coinId: 7,
    coinSymbol: 'BTC',
    tradingSymbol: 'BTCUSDT',
    interval: '1d',
  });

  assert.deepStrictEqual(parsed, {
    coin_id: 7,
    coin_symbol: 'BTC',
    trading_symbol: 'BTCUSDT',
    market: 'binance_usdm_perpetual',
    interval: '1d',
    open_time: new Date(Date.UTC(2026, 0, 1)),
    close_time: new Date(Date.UTC(2026, 0, 1, 23, 59, 59, 999)),
    open_price: 100.5,
    high_price: 111.25,
    low_price: 95.75,
    close_price: 108.125,
    volume: 1234.5,
    quote_volume: 130000,
    trade_count: 2500,
  });

  const url = buildBinanceUsdmKlinesUrl({
    symbol: 'ETHUSDT',
    interval: '4h',
    limit: 300,
    startTime: Date.UTC(2026, 0, 1),
    endTime: Date.UTC(2026, 1, 1),
  });

  assert.match(url, /\/fapi\/v1\/klines\?/);
  assert.match(url, /symbol=ETHUSDT/);
  assert.match(url, /interval=4h/);
  assert.match(url, /limit=300/);
  assert.match(url, /startTime=1767225600000/);
  assert.match(url, /endTime=1769904000000/);

  const maxLimitUrl = buildBinanceUsdmKlinesUrl({
    symbol: 'BTC',
    interval: '4h',
    limit: 9999,
  });
  assert.match(maxLimitUrl, /limit=1500/);

  assert.strictEqual(shouldRefreshStoredCoinKlines({
    rows: [{
      open_time: new Date(Date.UTC(2026, 5, 8)),
      close_time: new Date(Date.UTC(2026, 5, 8, 23, 59, 59, 999)),
    }],
    interval: '1d',
    now: Date.UTC(2026, 5, 17, 9),
  }), true);

  assert.strictEqual(shouldRefreshStoredCoinKlines({
    rows: [{
      open_time: new Date(Date.UTC(2026, 5, 17, 8)),
      close_time: new Date(Date.UTC(2026, 5, 17, 11, 59, 59, 999)),
    }],
    interval: '4h',
    now: Date.UTC(2026, 5, 17, 9),
  }), false);

  assert.strictEqual(shouldRefreshStoredCoinKlines({
    rows: [{
      open_time: new Date(Date.UTC(2026, 5, 8)),
      close_time: new Date(Date.UTC(2026, 5, 8, 23, 59, 59, 999)),
    }],
    interval: '1d',
    endTime: Date.UTC(2026, 5, 9) - 1,
    now: Date.UTC(2026, 5, 17, 9),
  }), false);

  const upserted = [];
  const fakeModel = {
    async upsert(payload) {
      upserted.push(payload);
    },
  };
  const fetchImpl = async () => ({
    ok: true,
    json: async () => [row],
  });

  const result = await syncCoinKlines({
    coin: { id: 7, symbol: 'BTC' },
    interval: '1d',
    limit: 1,
    fetchImpl,
    CoinKlineModel: fakeModel,
  });

  assert.strictEqual(result.saved, 1);
  assert.strictEqual(result.tradingSymbol, 'BTCUSDT');
  assert.strictEqual(upserted.length, 1);
  assert.strictEqual(upserted[0].open_price, 100.5);
  assert.strictEqual(upserted[0].close_price, 108.125);

  const rateLimitUpserted = [];
  const rateLimitFetchImpl = async () => ({
    ok: true,
    headers: {
      get(name) {
        const headers = {
          'x-mbx-used-weight-1m': '1234',
          'retry-after': '7',
        };
        return headers[String(name).toLowerCase()] || null;
      },
    },
    json: async () => [row],
  });
  const rateLimitResult = await syncCoinKlines({
    coin: { id: 70, symbol: 'BTC' },
    interval: '1d',
    limit: 1,
    fetchImpl: rateLimitFetchImpl,
    CoinKlineModel: {
      async upsert(payload) {
        rateLimitUpserted.push(payload);
      },
    },
  });

  assert.strictEqual(rateLimitResult.rateLimit.usedWeight1m, 1234);
  assert.strictEqual(rateLimitResult.rateLimit.retryAfterMs, 7000);
  assert.strictEqual(rateLimitUpserted.length, 1);

  let rateLimitError = null;
  try {
    await fetchBinanceUsdmKlines({
      symbol: 'BTC',
      interval: '1d',
      limit: 1,
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        headers: {
          get(name) {
            const headers = {
              'x-mbx-used-weight-1m': '2401',
              'retry-after': '11',
            };
            return headers[String(name).toLowerCase()] || null;
          },
        },
        text: async () => '{"code":-1003,"msg":"Too many requests"}',
      }),
    });
  } catch (error) {
    rateLimitError = error;
  }
  assert.strictEqual(rateLimitError.status, 429);
  assert.strictEqual(rateLimitError.retryAfterMs, 11000);
  assert.strictEqual(rateLimitError.rateLimit.usedWeight1m, 2401);

  const fallbackUrls = [];
  const spotUpserted = [];
  const spotModel = {
    async upsert(payload) {
      spotUpserted.push(payload);
    },
  };
  const fallbackFetchImpl = async (url) => {
    fallbackUrls.push(String(url));
    if (String(url).includes('/fapi/')) {
      return {
        ok: false,
        text: async () => '{"code":-1121,"msg":"Invalid symbol."}',
      };
    }
    return {
      ok: true,
      json: async () => [row],
    };
  };

  const fallbackResult = await syncCoinKlines({
    coin: { id: 8, symbol: 'AIOZ' },
    interval: '1d',
    limit: 1,
    fetchImpl: fallbackFetchImpl,
    CoinKlineModel: spotModel,
  });

  assert.strictEqual(fallbackResult.market, 'binance_spot');
  assert.match(fallbackUrls[0], /fapi\/v1\/klines/);
  assert.match(fallbackUrls[1], /api\/v3\/klines/);
  assert.strictEqual(spotUpserted[0].market, 'binance_spot');

  assert.strictEqual(resolveYahooSymbol('CIRCLE'), 'CRCL');
  assert.strictEqual(resolveYahooSymbol('NASDAQ'), '^IXIC');
  assert.strictEqual(resolveYahooSymbol('CN_AI_ETF'), '159819.SZ');
  assert.strictEqual(resolveYahooSymbol('CN_INDEX'), '000300.SS');
  assert.strictEqual(resolveYahooSymbol('CN_ROBOT'), '562500.SS');
  assert.strictEqual(getPreferredKlineMarket('VEGA'), DERIBIT_BTC_DVOL_MARKET);
  assert.strictEqual(getPreferredKlineMarket('AXTI'), YAHOO_FINANCE_MARKET);
  assert.strictEqual(getPreferredKlineMarket('BTC'), null);
  const yahooUrl = buildYahooFinanceChartUrl({ symbol: 'CRCL', interval: '1d', range: '1y' });
  assert.match(yahooUrl, /query1\.finance\.yahoo\.com\/v8\/finance\/chart\/CRCL/);
  assert.match(yahooUrl, /interval=1d/);
  assert.match(yahooUrl, /range=1y/);

  const yahooUrls = [];
  const yahooUpserted = [];
  const yahooModel = {
    async upsert(payload) {
      yahooUpserted.push(payload);
    },
  };
  const yahooFetchImpl = async (url) => {
    yahooUrls.push(String(url));
    return {
      ok: true,
      json: async () => ({
        chart: {
          result: [{
            meta: { symbol: 'CRCL' },
            timestamp: [Date.UTC(2026, 0, 2) / 1000],
            indicators: {
              quote: [{
                open: [70],
                high: [74],
                low: [66],
                close: [72],
                volume: [987654],
              }],
            },
          }],
          error: null,
        },
      }),
    };
  };

  const yahooResult = await syncCoinKlines({
    coin: { id: 9, symbol: 'CIRCLE' },
    interval: '1d',
    limit: 1,
    fetchImpl: yahooFetchImpl,
    CoinKlineModel: yahooModel,
  });

  assert.strictEqual(yahooResult.market, 'yahoo_finance');
  assert.strictEqual(yahooResult.tradingSymbol, 'CRCL');
  assert.strictEqual(yahooUrls.length, 1);
  assert.match(yahooUrls[0], /finance\/chart\/CRCL/);
  assert.strictEqual(yahooUpserted.length, 1);
  assert.strictEqual(yahooUpserted[0].market, 'yahoo_finance');
  assert.strictEqual(yahooUpserted[0].trading_symbol, 'CRCL');
  assert.strictEqual(yahooUpserted[0].close_price, 72);

  const stockUrls = [];
  const stockUpserted = [];
  const stockFetchImpl = async (url) => {
    stockUrls.push(String(url));
    if (!String(url).includes('/v8/finance/chart/AXTI')) {
      throw new Error(`Unexpected non-Yahoo stock URL: ${url}`);
    }
    return {
      ok: true,
      json: async () => ({
        chart: {
          result: [{
            meta: { symbol: 'AXTI' },
            timestamp: [Date.UTC(2026, 0, 2) / 1000],
            indicators: {
              quote: [{
                open: [2.1],
                high: [2.3],
                low: [2.0],
                close: [2.2],
                volume: [123456],
              }],
            },
          }],
          error: null,
        },
      }),
    };
  };

  const stockResult = await syncCoinKlines({
    coin: { id: 11, symbol: 'AXTI' },
    interval: '4h',
    limit: 1,
    fetchImpl: stockFetchImpl,
    CoinKlineModel: {
      async upsert(payload) {
        stockUpserted.push(payload);
      },
    },
  });

  assert.strictEqual(stockResult.market, YAHOO_FINANCE_MARKET);
  assert.strictEqual(stockResult.tradingSymbol, 'AXTI');
  assert.strictEqual(stockUrls.length, 1);
  assert.strictEqual(stockUpserted[0].market, YAHOO_FINANCE_MARKET);
  assert.strictEqual(stockUpserted[0].close_price, 2.2);

  const mappedYahooUrls = [];
  const mappedYahooFetchImpl = async (url) => {
    mappedYahooUrls.push(String(url));
    if (!String(url).includes('/v8/finance/chart/159819.SZ')) {
      throw new Error(`Unexpected mapped Yahoo URL: ${url}`);
    }
    return {
      ok: true,
      json: async () => ({
        chart: {
          result: [{
            meta: { symbol: '159819.SZ' },
            timestamp: [Date.UTC(2026, 0, 2) / 1000],
            indicators: {
              quote: [{
                open: [1.1],
                high: [1.2],
                low: [1.0],
                close: [1.15],
                volume: [345678],
              }],
            },
          }],
          error: null,
        },
      }),
    };
  };
  const mappedYahooUpserted = [];
  const mappedYahooResult = await syncCoinKlines({
    coin: { id: 13, symbol: 'CUSTOM_AI' },
    klineMapping: {
      market: YAHOO_FINANCE_MARKET,
      trading_symbol: '159819.SZ',
      enabled: true,
    },
    interval: '1d',
    limit: 1,
    fetchImpl: mappedYahooFetchImpl,
    CoinKlineModel: {
      async upsert(payload) {
        mappedYahooUpserted.push(payload);
      },
    },
  });

  assert.strictEqual(mappedYahooResult.market, YAHOO_FINANCE_MARKET);
  assert.strictEqual(mappedYahooResult.tradingSymbol, '159819.SZ');
  assert.strictEqual(mappedYahooUrls.length, 1);
  assert.strictEqual(mappedYahooUpserted[0].trading_symbol, '159819.SZ');

  clearYahooSyncCache();
  const throttledUrls = [];
  const throttledFetchImpl = async (url) => {
    throttledUrls.push(String(url));
    return {
      ok: true,
      json: async () => ({
        chart: {
          result: [{
            meta: { symbol: 'AXTI' },
            timestamp: [Date.UTC(2026, 0, 3) / 1000],
            indicators: {
              quote: [{
                open: [2.2],
                high: [2.4],
                low: [2.1],
                close: [2.3],
                volume: [234567],
              }],
            },
          }],
          error: null,
        },
      }),
    };
  };
  const throttledModel = { async upsert() {} };
  const syncAt = Date.UTC(2026, 0, 3, 0, 0, 0);

  const firstThrottledSync = await syncCoinKlines({
    coin: { id: 12, symbol: 'AXTI' },
    interval: '4h',
    limit: 1,
    fetchImpl: throttledFetchImpl,
    CoinKlineModel: throttledModel,
    minSyncIntervalMs: YAHOO_FINANCE_SYNC_MIN_INTERVAL_MS,
    now: syncAt,
  });
  const secondThrottledSync = await syncCoinKlines({
    coin: { id: 12, symbol: 'AXTI' },
    interval: '4h',
    limit: 1,
    fetchImpl: throttledFetchImpl,
    CoinKlineModel: throttledModel,
    minSyncIntervalMs: YAHOO_FINANCE_SYNC_MIN_INTERVAL_MS,
    now: syncAt + 60 * 1000,
  });
  const forcedThrottledSync = await syncCoinKlines({
    coin: { id: 12, symbol: 'AXTI' },
    interval: '4h',
    limit: 1,
    fetchImpl: throttledFetchImpl,
    CoinKlineModel: throttledModel,
    minSyncIntervalMs: YAHOO_FINANCE_SYNC_MIN_INTERVAL_MS,
    force: true,
    now: syncAt + 2 * 60 * 1000,
  });

  assert.strictEqual(firstThrottledSync.skipped, false);
  assert.strictEqual(secondThrottledSync.skipped, true);
  assert.strictEqual(forcedThrottledSync.skipped, false);
  assert.strictEqual(throttledUrls.length, 2);

  const dvolUrls = [];
  const dvolUpserted = [];
  const dvolModel = {
    async upsert(payload) {
      dvolUpserted.push(payload);
    },
  };
  const dvolFetchImpl = async (url) => {
    dvolUrls.push(String(url));
    return {
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: {
          data: [
            [Date.UTC(2026, 0, 2, 0), 36, 38, 35, 37],
            [Date.UTC(2026, 0, 2, 1), 37, 39, 36, 38],
          ],
        },
      }),
    };
  };

  const dvolResult = await syncCoinKlines({
    coin: { id: 10, symbol: 'VEGA' },
    interval: '1h',
    limit: 2,
    fetchImpl: dvolFetchImpl,
    CoinKlineModel: dvolModel,
  });

  assert.strictEqual(dvolResult.market, DERIBIT_BTC_DVOL_MARKET);
  assert.strictEqual(dvolResult.tradingSymbol, DERIBIT_BTC_DVOL_SYMBOL);
  assert.match(dvolUrls[0], /deribit\.com\/api\/v2\/public\/get_volatility_index_data/);
  assert.match(dvolUrls[0], /currency=BTC/);
  assert.strictEqual(dvolUpserted.length, 2);
  assert.strictEqual(dvolUpserted[0].coin_symbol, 'VEGA');
  assert.strictEqual(dvolUpserted[0].market, DERIBIT_BTC_DVOL_MARKET);
  assert.strictEqual(dvolUpserted[0].trading_symbol, DERIBIT_BTC_DVOL_SYMBOL);
  assert.strictEqual(dvolUpserted[1].close_price, 38);

  let storedWhere = null;
  await findStoredCoinKlines({
    coinId: 10,
    interval: '1h',
    market: DERIBIT_BTC_DVOL_MARKET,
    limit: 2,
    CoinKlineModel: {
      async findAll(options) {
        storedWhere = options.where;
        return [];
      },
    },
  });
  assert.strictEqual(storedWhere.market, DERIBIT_BTC_DVOL_MARKET);

  const fakeCoins = [
    { id: 21, symbol: 'BTC', name: 'Bitcoin' },
    { id: 22, symbol: 'ETH', name: 'Ethereum' },
    { id: 23, symbol: 'AXTI', name: 'AXTI' },
    { id: 24, symbol: 'EMPTY', name: 'Empty' },
    { id: 25, symbol: 'NOKLINE', name: 'No Kline' },
    { id: 26, symbol: 'STALE', name: 'Stale' },
  ];
  const fakeMetricByCoinId = new Map([
    [21, {
      coin_id: 21,
      date: '2026-01-01',
      timestamp: null,
    }],
    [22, {
      coin_id: 22,
      date: '2026-01-01',
      timestamp: null,
    }],
    [23, {
      coin_id: 23,
      date: '2026-01-01',
      timestamp: new Date(Date.UTC(2026, 0, 1, 10, 53)).toISOString(),
    }],
    [25, {
      coin_id: 25,
      date: '2026-01-01',
      timestamp: null,
    }],
    [26, {
      coin_id: 26,
      date: '2025-12-01',
      timestamp: null,
    }],
  ]);
  const fakeLatestMetricByCoinId = new Map([
    [21, {
      coin_id: 21,
      date: '2026-01-05',
      timestamp: null,
    }],
    [22, {
      coin_id: 22,
      date: '2026-01-05',
      timestamp: null,
    }],
    [23, {
      coin_id: 23,
      date: '2026-01-05',
      timestamp: new Date(Date.UTC(2026, 0, 5, 10, 53)).toISOString(),
    }],
    [25, {
      coin_id: 25,
      date: '2026-01-05',
      timestamp: null,
    }],
    [26, fakeMetricByCoinId.get(26)],
  ]);
  const fakeEarliestKlineByCoinId = new Map([
    [21, {
      coin_id: 21,
      interval: '4h',
      open_time: new Date(Date.UTC(2026, 4, 1)),
    }],
    [22, {
      coin_id: 22,
      interval: '4h',
      open_time: new Date(Date.UTC(2026, 0, 1)),
    }],
    [23, {
      coin_id: 23,
      interval: '4h',
      open_time: new Date(Date.UTC(2026, 0, 2)),
      market: YAHOO_FINANCE_MARKET,
    }],
  ]);

  const backfillPlan = await findCoinKlineBackfillGaps({
    interval: '4h',
    CoinModel: {
      async findAll() {
        return fakeCoins;
      },
    },
    DailyMetricModel: {
      async findOne(options) {
        if (!options.where?.coin_id) {
          return { date: '2026-01-05' };
        }
        if (options.order?.[0]?.[1] === 'DESC') {
          return fakeLatestMetricByCoinId.get(options.where.coin_id) || null;
        }
        return fakeMetricByCoinId.get(options.where.coin_id) || null;
      },
      async findAll(options) {
        if (options.where?.date === '2026-01-05') {
          return [
            { coin_id: 21 },
            { coin_id: 22 },
            { coin_id: 23 },
            { coin_id: 25 },
          ];
        }
        return [];
      },
    },
    CoinKlineModel: {
      async findOne(options) {
        return fakeEarliestKlineByCoinId.get(options.where.coin_id) || null;
      },
    },
  });

  assert.strictEqual(backfillPlan.interval, '4h');
  assert.strictEqual(backfillPlan.totalCoins, 6);
  assert.strictEqual(backfillPlan.items.length, 3);
  assert.strictEqual(backfillPlan.skippedCovered, 1);
  assert.strictEqual(backfillPlan.skippedNoMetrics, 1);
  assert.strictEqual(backfillPlan.skippedStaleMetrics, 1);
  assert.deepStrictEqual(backfillPlan.items[0], {
    coinId: 21,
    coinSymbol: 'BTC',
    coinName: 'Bitcoin',
    market: null,
    interval: '4h',
    startTime: Date.UTC(2026, 0, 1),
    endTime: Date.UTC(2026, 4, 1) - 1,
    metricStartTime: Date.UTC(2026, 0, 1),
    earliestKlineTime: Date.UTC(2026, 4, 1),
  });
  assert.strictEqual(backfillPlan.items[1].coinSymbol, 'AXTI');
  assert.strictEqual(backfillPlan.items[1].market, YAHOO_FINANCE_MARKET);
  assert.strictEqual(backfillPlan.items[1].startTime, Date.UTC(2026, 0, 1, 8));
  assert.strictEqual(backfillPlan.items[1].endTime, Date.UTC(2026, 0, 2) - 1);
  assert.strictEqual(backfillPlan.items[2].coinSymbol, 'NOKLINE');
  assert.strictEqual(backfillPlan.items[2].startTime, Date.UTC(2026, 0, 1));
  assert.strictEqual(backfillPlan.items[2].endTime, Date.UTC(2026, 0, 5, 4) - 1);

  const backfillChunks = buildCoinKlineBackfillChunks({
    startTime: Date.UTC(2026, 0, 1),
    endTime: Date.UTC(2026, 0, 11) - 1,
    interval: '1d',
    limit: 3,
  });
  assert.deepStrictEqual(backfillChunks, [
    {
      startTime: Date.UTC(2026, 0, 1),
      endTime: Date.UTC(2026, 0, 4) - 1,
    },
    {
      startTime: Date.UTC(2026, 0, 4),
      endTime: Date.UTC(2026, 0, 7) - 1,
    },
    {
      startTime: Date.UTC(2026, 0, 7),
      endTime: Date.UTC(2026, 0, 10) - 1,
    },
    {
      startTime: Date.UTC(2026, 0, 10),
      endTime: Date.UTC(2026, 0, 11) - 1,
    },
  ]);

  console.log('coinKlines.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
