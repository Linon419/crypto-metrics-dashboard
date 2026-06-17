const assert = require('assert');

const {
  buildBtcVolatilityHistory,
  buildBtcVolatilitySnapshot,
  calculateAtr,
  calculateDailyIvFromDvol,
  calculateDailyRv,
  classifyVolatilityComparison,
  parseDeribitDvolCandle,
} = require('../utils/btcVolatility');

function buildKline(index) {
  const close = 100 + index;
  return {
    openTime: new Date(Date.UTC(2026, 0, index + 1)),
    open: close - 1,
    high: close + 4,
    low: close - 6,
    close,
    closeTime: new Date(Date.UTC(2026, 0, index + 1, 23, 59, 59)),
  };
}

async function run() {
  const klines = Array.from({ length: 15 }, (_, index) => buildKline(index));
  const atr = calculateAtr(klines, 14);
  assert.strictEqual(atr, 10);
  assert.strictEqual(calculateDailyRv({ atr, currentPrice: 200 }), 0.05);

  const dailyIv = calculateDailyIvFromDvol(57.2957795);
  assert.ok(Math.abs(dailyIv - 0.029984) < 0.00001);

  const ivPremium = classifyVolatilityComparison({ dailyRv: 0.02, dailyIv: 0.03 });
  assert.strictEqual(ivPremium.label, 'IV溢价');
  assert.strictEqual(ivPremium.bias, 'iv_premium');
  assert.ok(Math.abs(ivPremium.spread - 0.01) < 0.000001);
  assert.strictEqual(ivPremium.ratio, 1.5);

  assert.strictEqual(
    classifyVolatilityComparison({ dailyRv: 0.03, dailyIv: 0.02 }).label,
    'RV高于IV'
  );

  assert.strictEqual(
    classifyVolatilityComparison({ dailyRv: 0.03, dailyIv: 0.031 }).label,
    '接近'
  );

  const binanceRows = Array.from({ length: 15 }, (_, index) => {
    const openTime = Date.UTC(2026, 0, index + 1);
    const close = 100 + index;
    return [
      openTime,
      String(close - 1),
      String(close + 4),
      String(close - 6),
      String(close),
      '1',
      openTime + 24 * 60 * 60 * 1000 - 1,
    ];
  });

  const deribitPayload = {
    jsonrpc: '2.0',
    result: {
      data: [
        [Date.UTC(2026, 0, 15, 12), 50, 52, 49, 57.2957795],
      ],
    },
  };

  const fetchImpl = async (url) => ({
    ok: true,
    json: async () => (String(url).includes('deribit') ? deribitPayload : binanceRows),
  });

  const snapshot = await buildBtcVolatilitySnapshot({
    fetchImpl,
    now: Date.UTC(2026, 0, 15, 12),
  });

  assert.strictEqual(snapshot.symbol, 'BTC');
  assert.strictEqual(snapshot.period, 14);
  assert.strictEqual(snapshot.currentPrice, 114);
  assert.strictEqual(snapshot.atr, 10);
  assert.ok(Math.abs(snapshot.dailyRv - (10 / 114)) < 0.000001);
  assert.ok(Math.abs(snapshot.dailyIv - 0.029984) < 0.00001);
  assert.strictEqual(snapshot.comparison.label, 'RV高于IV');
  assert.strictEqual(snapshot.timestamps.dvolTimestamp, '2026-01-15T12:00:00.000Z');

  const parsedDvol = parseDeribitDvolCandle([Date.UTC(2026, 0, 15, 12), 50, 52, 49, 51]);
  assert.strictEqual(parsedDvol.timestamp, '2026-01-15T12:00:00.000Z');
  assert.strictEqual(parsedDvol.open, 50);
  assert.strictEqual(parsedDvol.high, 52);
  assert.strictEqual(parsedDvol.low, 49);
  assert.strictEqual(parsedDvol.close, 51);

  const historyFetchImpl = async () => ({
    ok: true,
    json: async () => ({
      jsonrpc: '2.0',
      result: {
        data: [
          [Date.UTC(2026, 0, 15, 10), 48, 51, 47, 50],
          [Date.UTC(2026, 0, 15, 11), 50, 53, 49, 52],
        ],
      },
    }),
  });

  const history = await buildBtcVolatilityHistory({
    fetchImpl: historyFetchImpl,
    now: Date.UTC(2026, 0, 15, 12),
    lookbackHours: 2,
    resolution: '60',
  });

  assert.strictEqual(history.symbol, 'BTC');
  assert.strictEqual(history.resolution, '60');
  assert.strictEqual(history.candles.length, 2);
  assert.strictEqual(history.candles[1].close, 52);
  assert.strictEqual(history.timestamps.generatedAt, '2026-01-15T12:00:00.000Z');

  const aggregateUrls = [];
  const aggregateFetchImpl = async (url) => {
    aggregateUrls.push(String(url));
    return {
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: {
          data: [
            [Date.UTC(2026, 0, 15, 10, 0), 10, 12, 9, 11],
            [Date.UTC(2026, 0, 15, 10, 1), 11, 13, 10, 12],
            [Date.UTC(2026, 0, 15, 10, 14), 12, 14, 8, 9],
            [Date.UTC(2026, 0, 15, 10, 15), 9, 15, 7, 14],
            [Date.UTC(2026, 0, 15, 10, 29), 14, 16, 13, 15],
          ],
        },
      }),
    };
  };

  const fifteenMinuteHistory = await buildBtcVolatilityHistory({
    fetchImpl: aggregateFetchImpl,
    now: Date.UTC(2026, 0, 15, 12),
    lookbackHours: 2,
    resolution: '900',
  });

  assert.match(aggregateUrls[0], /resolution=60/);
  assert.strictEqual(fifteenMinuteHistory.resolution, '900');
  assert.strictEqual(fifteenMinuteHistory.sourceResolution, '60');
  assert.strictEqual(fifteenMinuteHistory.candles.length, 2);
  assert.deepStrictEqual(fifteenMinuteHistory.candles[0], {
    timestamp: '2026-01-15T10:00:00.000Z',
    open: 10,
    high: 14,
    low: 8,
    close: 9,
  });
  assert.deepStrictEqual(fifteenMinuteHistory.candles[1], {
    timestamp: '2026-01-15T10:15:00.000Z',
    open: 9,
    high: 16,
    low: 7,
    close: 15,
  });

  const fourHourUrls = [];
  const fourHourFetchImpl = async (url) => {
    fourHourUrls.push(String(url));
    return {
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: {
          data: [
            [Date.UTC(2026, 0, 15, 0), 40, 42, 39, 41],
            [Date.UTC(2026, 0, 15, 1), 41, 43, 40, 42],
            [Date.UTC(2026, 0, 15, 2), 42, 44, 38, 39],
            [Date.UTC(2026, 0, 15, 3), 39, 45, 37, 44],
            [Date.UTC(2026, 0, 15, 4), 44, 46, 43, 45],
          ],
        },
      }),
    };
  };

  const fourHourHistory = await buildBtcVolatilityHistory({
    fetchImpl: fourHourFetchImpl,
    now: Date.UTC(2026, 0, 15, 12),
    lookbackHours: 12,
    resolution: '14400',
  });

  assert.match(fourHourUrls[0], /resolution=3600/);
  assert.strictEqual(fourHourHistory.resolution, '14400');
  assert.strictEqual(fourHourHistory.sourceResolution, '3600');
  assert.strictEqual(fourHourHistory.candles.length, 2);
  assert.deepStrictEqual(fourHourHistory.candles[0], {
    timestamp: '2026-01-15T00:00:00.000Z',
    open: 40,
    high: 45,
    low: 37,
    close: 44,
  });

  console.log('btcVolatility.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
