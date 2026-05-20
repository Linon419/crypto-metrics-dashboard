#!/usr/bin/env node

const { Coin, DailyMetric, BtcPricePoint, sequelize } = require('../models');
const {
  DEFAULT_SYMBOL,
  fetchBinanceUsdmPerpetualMinuteClose,
  sleep,
} = require('../utils/binanceFuturesPrice');

sequelize.options.logging = false;

function parseArgs(argv) {
  const options = {
    symbol: DEFAULT_SYMBOL,
    limit: null,
    force: false,
    dryRun: false,
    concurrency: 8,
    batchDelayMs: 200,
  };

  argv.forEach((arg) => {
    if (arg === '--force') options.force = true;
    if (arg === '--dry-run') options.dryRun = true;
    if (arg.startsWith('--symbol=')) options.symbol = arg.split('=')[1] || DEFAULT_SYMBOL;
    if (arg.startsWith('--limit=')) options.limit = Number(arg.split('=')[1]);
    if (arg.startsWith('--concurrency=')) options.concurrency = Math.max(1, Number(arg.split('=')[1]) || 1);
    if (arg.startsWith('--batch-delay-ms=')) options.batchDelayMs = Math.max(0, Number(arg.split('=')[1]) || 0);
  });

  return options;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function loadTargetMetrics({ force, limit }) {
  const btcCoin = await Coin.findOne({ where: { symbol: 'BTC' } });
  if (!btcCoin) {
    throw new Error('BTC coin is missing from database');
  }

  await BtcPricePoint.sync();

  const metrics = await DailyMetric.findAll({
    where: { coin_id: btcCoin.id },
    order: [['date', 'ASC'], ['timestamp', 'ASC'], ['id', 'ASC']],
    raw: true,
  });
  const metricsWithTimestamp = metrics.filter(metric => metric.timestamp);
  const metricIds = metricsWithTimestamp.map(metric => metric.id);
  const existing = await BtcPricePoint.findAll({
    where: { daily_metric_id: metricIds },
    raw: true,
  });
  const existingIds = new Set(existing.map(point => point.daily_metric_id));
  const targetMetrics = metricsWithTimestamp
    .filter(metric => force || !existingIds.has(metric.id))
    .slice(0, Number.isFinite(limit) && limit > 0 ? limit : undefined);

  return {
    btcCoin,
    metricsTotal: metrics.length,
    metricsWithTimestamp: metricsWithTimestamp.length,
    existingPricePoints: existing.length,
    targetMetrics,
  };
}

async function backfillMetric(metric, btcCoin, symbol) {
  const pricePoint = await fetchBinanceUsdmPerpetualMinuteClose({
    symbol,
    timestamp: metric.timestamp,
  });

  await BtcPricePoint.upsert({
    daily_metric_id: metric.id,
    coin_id: btcCoin.id,
    symbol: pricePoint.symbol,
    market: pricePoint.market,
    published_at: pricePoint.published_at,
    kline_open_time: pricePoint.kline_open_time,
    kline_close_time: pricePoint.kline_close_time,
    close_price: pricePoint.close_price,
  });

  return {
    metricId: metric.id,
    date: metric.date,
    timestamp: metric.timestamp,
    closePrice: pricePoint.close_price,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const loaded = await loadTargetMetrics(options);

  if (options.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      symbol: options.symbol,
      metricsTotal: loaded.metricsTotal,
      metricsWithTimestamp: loaded.metricsWithTimestamp,
      existingPricePoints: loaded.existingPricePoints,
      targetCount: loaded.targetMetrics.length,
      firstTarget: loaded.targetMetrics[0] || null,
      lastTarget: loaded.targetMetrics[loaded.targetMetrics.length - 1] || null,
    }, null, 2));
    return;
  }

  let insertedOrUpdated = 0;
  const errors = [];
  const batches = chunk(loaded.targetMetrics, options.concurrency);

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const results = await Promise.all(batch.map(async (metric) => {
      try {
        const result = await backfillMetric(metric, loaded.btcCoin, options.symbol);
        return { ok: true, result };
      } catch (error) {
        return {
          ok: false,
          error: {
            metricId: metric.id,
            date: metric.date,
            timestamp: metric.timestamp,
            message: error.message,
          },
        };
      }
    }));

    results.forEach((item) => {
      if (item.ok) {
        insertedOrUpdated += 1;
      } else {
        errors.push(item.error);
      }
    });

    console.log(`Batch ${batchIndex + 1}/${batches.length}: saved=${insertedOrUpdated}, errors=${errors.length}`);
    if (batchIndex < batches.length - 1 && options.batchDelayMs > 0) {
      await sleep(options.batchDelayMs);
    }
  }

  console.log(JSON.stringify({
    symbol: options.symbol,
    metricsTotal: loaded.metricsTotal,
    metricsWithTimestamp: loaded.metricsWithTimestamp,
    existingPricePoints: loaded.existingPricePoints,
    targetCount: loaded.targetMetrics.length,
    insertedOrUpdated,
    errors: errors.slice(0, 10),
    errorCount: errors.length,
    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
  }, null, 2));

  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
