const assert = require('assert');

const {
  buildBtcVolatilitySnapshot,
  calculateAtr,
  calculateDailyIvFromDvol,
  calculateDailyRv,
  classifyVolatilityComparison,
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

  console.log('btcVolatility.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
