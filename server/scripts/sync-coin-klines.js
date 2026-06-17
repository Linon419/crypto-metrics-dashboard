#!/usr/bin/env node

const { Coin, CoinKline, sequelize } = require('../models');
const { sleep } = require('../utils/binanceFuturesPrice');
const { syncCoinKlines } = require('../utils/coinKlines');

sequelize.options.logging = false;

function parseArgs(argv) {
  const options = {
    interval: '1d',
    limit: 365,
    symbols: null,
    concurrency: 4,
    batchDelayMs: 300,
  };

  argv.forEach((arg) => {
    if (arg.startsWith('--interval=')) options.interval = arg.split('=')[1] || '1d';
    if (arg.startsWith('--limit=')) options.limit = Number(arg.split('=')[1]) || 365;
    if (arg.startsWith('--symbols=')) {
      options.symbols = arg.split('=')[1]
        .split(',')
        .map(symbol => symbol.trim().toUpperCase())
        .filter(Boolean);
    }
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

async function loadCoins(symbols) {
  const where = Array.isArray(symbols) && symbols.length > 0
    ? { symbol: symbols }
    : undefined;

  return Coin.findAll({
    where,
    order: [['symbol', 'ASC']],
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  await CoinKline.sync();
  const coins = await loadCoins(options.symbols);
  const batches = chunk(coins, options.concurrency);
  const results = [];
  const errors = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const batchResults = await Promise.all(batch.map(async (coin) => {
      try {
        const result = await syncCoinKlines({
          coin,
          interval: options.interval,
          limit: options.limit,
          CoinKlineModel: CoinKline,
        });
        return { ok: true, result };
      } catch (error) {
        return {
          ok: false,
          error: {
            symbol: coin.symbol,
            message: error.message,
          },
        };
      }
    }));

    batchResults.forEach((item) => {
      if (item.ok) {
        results.push(item.result);
      } else {
        errors.push(item.error);
      }
    });

    console.log(`Batch ${batchIndex + 1}/${batches.length}: savedSymbols=${results.length}, errors=${errors.length}`);
    if (batchIndex < batches.length - 1 && options.batchDelayMs > 0) {
      await sleep(options.batchDelayMs);
    }
  }

  console.log(JSON.stringify({
    interval: options.interval,
    limit: options.limit,
    coinCount: coins.length,
    savedSymbols: results.length,
    savedKlines: results.reduce((total, result) => total + result.saved, 0),
    errors: errors.slice(0, 20),
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
