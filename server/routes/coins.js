// server/routes/coins.js
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize'); // 添加这一行
const { Coin, DailyMetric, CoinKline, CoinKlineMapping } = require('../models');
const dataRouter = require('./data');
const {
  attachPeriodQualityToMetrics,
  getQualityLookbackStartDate,
} = require('../utils/periodQualityTimeline');
const {
  findStoredCoinKlines,
  findCoinKlineBackfillGaps,
  buildCoinKlineBackfillChunks,
  getPreferredKlineMarket,
  MAX_LIMIT,
  normalizeInterval,
  serializeCoinKline,
  shouldRefreshStoredCoinKlines,
  syncCoinKlines,
  YAHOO_FINANCE_SYNC_MIN_INTERVAL_MS,
} = require('../utils/coinKlines');
const { resolveEffectiveKlineMapping } = require('../utils/coinKlineMappings');

const KLINE_BACKFILL_DEFAULT_INTERVAL = '4h';
const KLINE_BACKFILL_DEFAULT_INTERVALS = ['15m', '1h', '4h', '1d'];
const KLINE_BACKFILL_DEFAULT_DELAY_MS = 5000;
const KLINE_BACKFILL_MIN_DELAY_MS = 3000;
const KLINE_BACKFILL_MAX_LOGS = 30;
const BINANCE_BACKFILL_WEIGHT_LIMIT_PER_MINUTE = 2400;
const BINANCE_BACKFILL_SOFT_WEIGHT_RATIO = 0.7;
const BINANCE_BACKFILL_HARD_WEIGHT_RATIO = 0.85;
const KLINE_BACKFILL_RATE_LIMIT_RETRIES = 2;

let activeKlineBackfillJob = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function normalizeBackfillIntervals(body = {}) {
  const rawIntervals = Array.isArray(body.intervals) && body.intervals.length > 0
    ? body.intervals
    : (body.interval ? [body.interval] : KLINE_BACKFILL_DEFAULT_INTERVALS);
  const normalized = rawIntervals.map(interval => normalizeInterval(interval));
  return [...new Set(normalized)];
}

function normalizeBackfillOptions(body = {}) {
  const intervals = normalizeBackfillIntervals(body);
  return {
    interval: intervals[0] || KLINE_BACKFILL_DEFAULT_INTERVAL,
    intervals,
    limit: clampNumber(body.limit, MAX_LIMIT, 1, MAX_LIMIT),
    delayMs: clampNumber(
      body.delayMs,
      KLINE_BACKFILL_DEFAULT_DELAY_MS,
      KLINE_BACKFILL_MIN_DELAY_MS,
      60 * 1000
    ),
    maxChunksPerCoin: clampNumber(body.maxChunksPerCoin, 40, 1, 200),
  };
}

function createBackfillJob(options) {
  const now = new Date().toISOString();
  return {
    id: `kline-backfill-${Date.now()}`,
    status: 'queued',
    options,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    totalCoins: 0,
    plannedCoins: 0,
    totalChunks: 0,
    completedChunks: 0,
    completedCoins: 0,
    failedCoins: 0,
    skippedCovered: 0,
    skippedNoMetrics: 0,
    skippedInvalidMetrics: 0,
    skippedStaleMetrics: 0,
    fetched: 0,
    saved: 0,
    currentInterval: null,
    currentCoin: null,
    currentChunk: null,
    intervalStats: options.intervals.map(interval => ({
      interval,
      totalCoins: 0,
      plannedCoins: 0,
      totalChunks: 0,
      completedChunks: 0,
      completedCoins: 0,
      failedCoins: 0,
      skippedCovered: 0,
      skippedNoMetrics: 0,
      skippedInvalidMetrics: 0,
      skippedStaleMetrics: 0,
      fetched: 0,
      saved: 0,
    })),
    logs: [],
    error: null,
  };
}

function pushBackfillLog(job, entry) {
  job.logs.push({
    time: new Date().toISOString(),
    ...entry,
  });
  if (job.logs.length > KLINE_BACKFILL_MAX_LOGS) {
    job.logs = job.logs.slice(-KLINE_BACKFILL_MAX_LOGS);
  }
}

function isBackfillRateLimitError(error) {
  return error?.status === 429 || error?.status === 418;
}

function resolveBackfillPauseMs(rateLimit, baseDelayMs) {
  const retryAfterMs = Number(rateLimit?.retryAfterMs);
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.max(baseDelayMs, retryAfterMs);
  }

  const usedWeight1m = Number(rateLimit?.usedWeight1m);
  if (!Number.isFinite(usedWeight1m)) return baseDelayMs;

  const ratio = usedWeight1m / BINANCE_BACKFILL_WEIGHT_LIMIT_PER_MINUTE;
  if (ratio >= BINANCE_BACKFILL_HARD_WEIGHT_RATIO) {
    return Math.max(baseDelayMs, 60 * 1000);
  }
  if (ratio >= BINANCE_BACKFILL_SOFT_WEIGHT_RATIO) {
    return Math.max(baseDelayMs, 20 * 1000);
  }

  return baseDelayMs;
}

async function syncBackfillChunkWithProtection({ job, item, chunk }) {
  let attempt = 0;

  while (attempt <= KLINE_BACKFILL_RATE_LIMIT_RETRIES) {
    try {
      return await syncCoinKlines({
        coin: { id: item.coinId, symbol: item.coinSymbol },
        interval: item.interval,
        limit: job.options.limit,
        startTime: chunk.startTime,
        endTime: chunk.endTime,
        force: true,
        minSyncIntervalMs: 0,
        CoinKlineModel: CoinKline,
        klineMapping: item.klineMapping,
      });
    } catch (error) {
      if (!isBackfillRateLimitError(error) || attempt >= KLINE_BACKFILL_RATE_LIMIT_RETRIES) {
        throw error;
      }

      const pauseMs = resolveBackfillPauseMs(
        { ...(error.rateLimit || {}), retryAfterMs: error.retryAfterMs },
        error.status === 418 ? 5 * 60 * 1000 : 2 * 60 * 1000
      );
      pushBackfillLog(job, {
        level: 'warn',
        coin: item.coinSymbol,
        message: `${item.coinSymbol} 触发 ${error.status}，暂停 ${Math.ceil(pauseMs / 1000)} 秒后重试`,
      });
      await sleep(pauseMs);
      attempt += 1;
    }
  }

  throw new Error(`${item.coinSymbol} rate limit retry exhausted`);
}

function serializeBackfillJob(job) {
  if (!job) return null;
  const progress = job.totalChunks > 0
    ? Math.round((job.completedChunks / job.totalChunks) * 100)
    : (job.status === 'completed' ? 100 : 0);

  return {
    id: job.id,
    status: job.status,
    options: job.options,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    totalCoins: job.totalCoins,
    plannedCoins: job.plannedCoins,
    totalChunks: job.totalChunks,
    completedChunks: job.completedChunks,
    completedCoins: job.completedCoins,
    failedCoins: job.failedCoins,
    skippedCovered: job.skippedCovered,
    skippedNoMetrics: job.skippedNoMetrics,
    skippedInvalidMetrics: job.skippedInvalidMetrics,
    skippedStaleMetrics: job.skippedStaleMetrics,
    fetched: job.fetched,
    saved: job.saved,
    currentInterval: job.currentInterval,
    currentCoin: job.currentCoin,
    currentChunk: job.currentChunk,
    intervalStats: job.intervalStats,
    progress,
    logs: job.logs,
    error: job.error,
  };
}

function findIntervalStat(job, interval) {
  return job.intervalStats.find(stat => stat.interval === interval);
}

async function buildBackfillPlanForIntervals(job) {
  const intervalPlans = [];

  for (const interval of job.options.intervals) {
    const plan = await findCoinKlineBackfillGaps({
      interval,
      CoinModel: Coin,
      DailyMetricModel: DailyMetric,
      CoinKlineModel: CoinKline,
      CoinKlineMappingModel: CoinKlineMapping,
    });
    const plannedItems = plan.items.map(item => ({
      item,
      chunks: buildCoinKlineBackfillChunks({
        startTime: item.startTime,
        endTime: item.endTime,
        interval: item.interval,
        limit: job.options.limit,
        maxChunks: job.options.maxChunksPerCoin,
      }),
    }));
    const stat = findIntervalStat(job, interval);
    stat.totalCoins = plan.totalCoins;
    stat.plannedCoins = plannedItems.length;
    stat.skippedCovered = plan.skippedCovered;
    stat.skippedNoMetrics = plan.skippedNoMetrics;
    stat.skippedInvalidMetrics = plan.skippedInvalidMetrics;
    stat.skippedStaleMetrics = plan.skippedStaleMetrics;
    stat.totalChunks = plannedItems.reduce((total, entry) => total + entry.chunks.length, 0);

    intervalPlans.push({
      interval,
      plannedItems,
    });
  }

  return intervalPlans;
}

async function runKlineBackfillJob(job) {
  job.status = 'running';
  job.updatedAt = new Date().toISOString();

  try {
    await CoinKline.sync();
    const intervalPlans = await buildBackfillPlanForIntervals(job);

    job.totalCoins = job.intervalStats.reduce((total, stat) => total + stat.totalCoins, 0);
    job.plannedCoins = job.intervalStats.reduce((total, stat) => total + stat.plannedCoins, 0);
    job.skippedCovered = job.intervalStats.reduce((total, stat) => total + stat.skippedCovered, 0);
    job.skippedNoMetrics = job.intervalStats.reduce((total, stat) => total + stat.skippedNoMetrics, 0);
    job.skippedInvalidMetrics = job.intervalStats.reduce((total, stat) => total + stat.skippedInvalidMetrics, 0);
    job.skippedStaleMetrics = job.intervalStats.reduce((total, stat) => total + stat.skippedStaleMetrics, 0);
    job.totalChunks = job.intervalStats.reduce((total, stat) => total + stat.totalChunks, 0);
    job.updatedAt = new Date().toISOString();

    pushBackfillLog(job, {
      level: 'info',
      message: `扫描完成：${job.options.intervals.join('/')} 共 ${job.plannedCoins} 个币种周期需要回补，${job.totalChunks} 个请求段`,
    });

    if (job.totalChunks === 0) {
      job.status = 'completed';
      job.finishedAt = new Date().toISOString();
      job.updatedAt = job.finishedAt;
      return;
    }

    for (let planIndex = 0; planIndex < intervalPlans.length; planIndex += 1) {
      const { interval, plannedItems } = intervalPlans[planIndex];
      const stat = findIntervalStat(job, interval);
      job.currentInterval = interval;

      pushBackfillLog(job, {
        level: 'info',
        message: `开始回补 ${interval}：${plannedItems.length} 个币种，${stat.totalChunks} 个请求段`,
      });

      for (let itemIndex = 0; itemIndex < plannedItems.length; itemIndex += 1) {
        const { item, chunks } = plannedItems[itemIndex];
        let coinFailed = false;
        job.currentCoin = item.coinSymbol;

        for (let index = 0; index < chunks.length; index += 1) {
          const chunk = chunks[index];
          let pauseMs = job.options.delayMs;
          job.currentChunk = `${index + 1}/${chunks.length}`;
          job.updatedAt = new Date().toISOString();

          try {
            const syncResult = await syncBackfillChunkWithProtection({
              job,
              item,
              chunk,
            });

            const fetched = syncResult?.fetched || 0;
            const saved = syncResult?.saved || 0;
            job.fetched += fetched;
            job.saved += saved;
            stat.fetched += fetched;
            stat.saved += saved;
            pauseMs = resolveBackfillPauseMs(syncResult?.rateLimit, job.options.delayMs);
            pushBackfillLog(job, {
              level: 'info',
              coin: item.coinSymbol,
              message: `${item.coinSymbol} ${item.interval} ${index + 1}/${chunks.length} 保存 ${saved} 根`,
            });
            if (pauseMs > job.options.delayMs) {
              const used = syncResult?.rateLimit?.usedWeight1m;
              pushBackfillLog(job, {
                level: 'warn',
                coin: item.coinSymbol,
                message: `Binance 权重 ${used || '-'}，下一次请求延迟 ${Math.ceil(pauseMs / 1000)} 秒`,
              });
            }
          } catch (error) {
            coinFailed = true;
            pushBackfillLog(job, {
              level: 'error',
              coin: item.coinSymbol,
              message: `${item.coinSymbol} 回补失败：${error.message}`,
            });
          } finally {
            job.completedChunks += 1;
            stat.completedChunks += 1;
            job.updatedAt = new Date().toISOString();
          }

          const isLastChunk = index === chunks.length - 1;
          const isLastItem = itemIndex === plannedItems.length - 1;
          const isLastInterval = planIndex === intervalPlans.length - 1;
          if (!(isLastChunk && isLastItem && isLastInterval)) {
            await sleep(pauseMs);
          }
        }

        if (coinFailed) {
          job.failedCoins += 1;
          stat.failedCoins += 1;
        } else {
          job.completedCoins += 1;
          stat.completedCoins += 1;
        }
      }
    }

    job.status = job.failedCoins > 0 ? 'completed_with_errors' : 'completed';
    job.finishedAt = new Date().toISOString();
    job.updatedAt = job.finishedAt;
    job.currentInterval = null;
    job.currentCoin = null;
    job.currentChunk = null;
  } catch (error) {
    job.status = 'failed';
    job.error = error.message;
    job.finishedAt = new Date().toISOString();
    job.updatedAt = job.finishedAt;
    pushBackfillLog(job, {
      level: 'error',
      message: `任务失败：${error.message}`,
    });
  }
}

// 获取所有币种
router.get('/', async (req, res) => {
  try {
    const coins = await Coin.findAll({
      attributes: ['id', 'symbol', 'name', 'current_price', 'logo_url']
    });
    res.json(coins);
  } catch (error) {
    console.error('Error fetching coins:', error);
    res.status(500).json({ error: 'Failed to fetch coins' });
  }
});

router.post('/klines/backfill', async (req, res) => {
  try {
    if (activeKlineBackfillJob && activeKlineBackfillJob.status === 'running') {
      return res.status(202).json({
        success: true,
        reused: true,
        job: serializeBackfillJob(activeKlineBackfillJob),
      });
    }

    const options = normalizeBackfillOptions(req.body || {});
    activeKlineBackfillJob = createBackfillJob(options);
    runKlineBackfillJob(activeKlineBackfillJob).catch(error => {
      activeKlineBackfillJob.status = 'failed';
      activeKlineBackfillJob.error = error.message;
      activeKlineBackfillJob.finishedAt = new Date().toISOString();
      activeKlineBackfillJob.updatedAt = activeKlineBackfillJob.finishedAt;
    });

    res.status(202).json({
      success: true,
      reused: false,
      job: serializeBackfillJob(activeKlineBackfillJob),
    });
  } catch (error) {
    console.error('Error starting kline backfill:', error);
    res.status(500).json({ error: error.message || 'Failed to start kline backfill' });
  }
});

router.get('/klines/backfill/status', (req, res) => {
  res.json({
    success: true,
    job: serializeBackfillJob(activeKlineBackfillJob),
  });
});

// 获取单个币种信息
router.get('/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const coin = await Coin.findOne({
      where: { symbol: symbol.toUpperCase() },
      attributes: ['id', 'symbol', 'name', 'current_price', 'logo_url']
    });
    
    if (!coin) {
      return res.status(404).json({ error: 'Coin not found' });
    }
    
    res.json(coin);
  } catch (error) {
    console.error(`Error fetching coin ${req.params.symbol}:`, error);
    res.status(500).json({ error: 'Failed to fetch coin' });
  }
});

// 获取币种的指标数据
router.get('/:symbol/metrics', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { startDate, endDate } = req.query;
    
    // 查找币种ID
    const coin = await Coin.findOne({
      where: { symbol: symbol.toUpperCase() }
    });
    
    if (!coin) {
      return res.status(404).json({ error: 'Coin not found' });
    }
    
    // 构建查询条件
    const where = { coin_id: coin.id };
    if (startDate) where.date = { [Op.gte]: startDate };
    if (endDate) where.date = { ...where.date, [Op.lte]: endDate };
    
    const metrics = await DailyMetric.findAll({
      where,
      order: [['date', 'ASC'], ['timestamp', 'ASC'], ['id', 'ASC']],
      raw: true,
    });

    if (metrics.length === 0) {
      return res.json([]);
    }

    const visibleStartDate = metrics[0].date;
    const visibleEndDate = metrics[metrics.length - 1].date;
    const historyStartDate = getQualityLookbackStartDate(visibleStartDate);
    const historyWhere = {
      coin_id: coin.id,
      date: { [Op.lte]: visibleEndDate },
    };

    if (historyStartDate) {
      historyWhere.date = {
        ...historyWhere.date,
        [Op.gte]: historyStartDate,
      };
    }

    const historicalMetrics = await DailyMetric.findAll({
      where: historyWhere,
      order: [['date', 'ASC'], ['timestamp', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    const calculatePeriodQualityForDate = dataRouter.__qualityTestUtils?.calculatePeriodQualityForDate;
    const metricsWithQuality = await attachPeriodQualityToMetrics(metrics, {
      coinId: coin.id,
      historicalMetrics,
      calculatePeriodQualityForDate,
    });

    res.json(metricsWithQuality);
  } catch (error) {
    console.error(`Error fetching metrics for ${req.params.symbol}:`, error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

router.get('/:symbol/klines', async (req, res) => {
  try {
    const { symbol } = req.params;
    const {
      interval = '1d',
      limit = 365,
      startTime,
      endTime,
      refresh,
    } = req.query;

    const coin = await Coin.findOne({
      where: { symbol: symbol.toUpperCase() }
    });

    if (!coin) {
      return res.status(404).json({ error: 'Coin not found' });
    }

    await CoinKline.sync();
    await CoinKlineMapping?.sync?.();
    const klineMapping = CoinKlineMapping?.findOne
      ? await CoinKlineMapping.findOne({
        where: { coin_id: coin.id },
        raw: true,
      })
      : null;
    const effectiveKlineMapping = resolveEffectiveKlineMapping(coin, klineMapping);
    const preferredMarket = getPreferredKlineMarket(coin.symbol, effectiveKlineMapping);
    const preferredTradingSymbol = effectiveKlineMapping?.trading_symbol || null;
    const shouldRefresh = refresh === '1' || refresh === 'true';

    let syncResult = null;
    let rows = await findStoredCoinKlines({
      coinId: coin.id,
      interval,
      limit,
      market: preferredMarket,
      tradingSymbol: preferredTradingSymbol,
      startTime,
      endTime,
      CoinKlineModel: CoinKline,
    });

    const storedRowsStale = shouldRefreshStoredCoinKlines({
      rows,
      interval,
      endTime,
    });

    if (shouldRefresh || rows.length === 0 || storedRowsStale) {
      syncResult = await syncCoinKlines({
        coin,
        interval,
        limit,
        startTime,
        endTime,
        force: rows.length === 0,
        minSyncIntervalMs: YAHOO_FINANCE_SYNC_MIN_INTERVAL_MS,
        CoinKlineModel: CoinKline,
        klineMapping,
      });

      if (!syncResult?.skipped) {
        rows = await findStoredCoinKlines({
          coinId: coin.id,
          interval,
          limit,
          market: preferredMarket,
          tradingSymbol: preferredTradingSymbol,
          startTime,
          endTime,
          CoinKlineModel: CoinKline,
        });
      }
    }

    if (rows.length === 0) {
      syncResult = await syncCoinKlines({
        coin,
        interval,
        limit,
        startTime,
        endTime,
        force: true,
        CoinKlineModel: CoinKline,
        klineMapping,
      });
      rows = await findStoredCoinKlines({
        coinId: coin.id,
        interval,
        limit,
        market: preferredMarket,
        tradingSymbol: preferredTradingSymbol,
        startTime,
        endTime,
        CoinKlineModel: CoinKline,
      });
    }

    rows.reverse();
    const markets = Array.from(new Set(rows.map(row => row.market).filter(Boolean)));
    const tradingSymbols = Array.from(new Set(rows.map(row => row.trading_symbol).filter(Boolean)));

    res.json({
      symbol: coin.symbol,
      interval,
      market: markets[0] || syncResult?.market || null,
      markets,
      tradingSymbols,
      source: 'CoinKlines',
      sync: syncResult,
      klines: rows.map(serializeCoinKline),
    });
  } catch (error) {
    console.error(`Error fetching klines for ${req.params.symbol}:`, error);
    res.status(500).json({ error: error.message || 'Failed to fetch klines' });
  }
});

// 创建新币种
router.post('/', async (req, res) => {
  try {
    const { symbol, name, current_price, logo_url } = req.body;
    
    // 验证必要字段
    if (!symbol || !name) {
      return res.status(400).json({ error: 'Symbol and name are required' });
    }
    
    // 检查是否已存在
    const existingCoin = await Coin.findOne({
      where: { symbol: symbol.toUpperCase() }
    });
    
    if (existingCoin) {
      return res.status(409).json({ error: 'Coin already exists' });
    }
    
    // 创建新币种
    const newCoin = await Coin.create({
      symbol: symbol.toUpperCase(),
      name,
      current_price,
      logo_url
    });
    
    res.status(201).json(newCoin);
  } catch (error) {
    console.error('Error creating coin:', error);
    res.status(500).json({ error: 'Failed to create coin' });
  }
});

// 更新币种信息
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, current_price, logo_url } = req.body;
    
    const coin = await Coin.findByPk(id);
    if (!coin) {
      return res.status(404).json({ error: 'Coin not found' });
    }
    
    // 更新币种
    await coin.update({
      name: name || coin.name,
      current_price: current_price !== undefined ? current_price : coin.current_price,
      logo_url: logo_url || coin.logo_url
    });
    
    res.json(coin);
  } catch (error) {
    console.error(`Error updating coin ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to update coin' });
  }
});

// 删除币种
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const coin = await Coin.findByPk(id);
    if (!coin) {
      return res.status(404).json({ error: 'Coin not found' });
    }
    
    // 删除币种
    await coin.destroy();
    
    res.json({ message: 'Coin deleted successfully' });
  } catch (error) {
    console.error(`Error deleting coin ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to delete coin' });
  }
});

router.__test = {
  normalizeBackfillOptions,
};

module.exports = router;
