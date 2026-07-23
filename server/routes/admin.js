// server/routes/admin.js
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Op } = require('sequelize');
const router = express.Router();
const {
  AppSetting,
  BtcPricePoint,
  Coin,
  CoinKline,
  CoinKlineMapping,
  DailyMetric,
  DatabasePatchLog,
  LiquidityOverview,
  TrendingCoin,
  User,
  UserFavorite,
  sequelize,
} = require('../models');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { getSystemSettings, updateSystemSettings } = require('../utils/settings');
const {
  getOpenAIPromptSettings,
  resetOpenAIPromptSettings,
  updateOpenAIPromptSettings,
} = require('../utils/openaiPromptSettings');
const {
  getOpenAIModelSettingsResponse,
  resetOpenAIModelSettings,
  resolveOpenAIModelSettings,
  updateOpenAIModelSettings,
  validateOpenAIModelSettings,
} = require('../utils/openaiModelSettings');
const { listAvailableAIModels } = require('../services/aiModelCatalogService');
const {
  __testUtils: {
    DEFAULT_SYSTEM_PROMPT,
    getDefaultPromptTemplate,
  },
} = require('../services/openaiService');
const {
  PatchValidationError,
  runDatabasePatch,
  validateDatabasePatch,
} = require('../utils/databasePatch');
const {
  AdminDateRecordError,
  deleteDateRecords,
  getDateRecordSummary,
  updateDateRecordTime,
} = require('../utils/adminDateRecords');
const {
  buildDefaultKlineMappingsForCoins,
  filterCoinsWithLatestMetrics,
  findLatestMetricDate,
  getDefaultKlineMappingForSymbol,
  normalizeKlineMappingInput,
  resolveDisplayedKlineMapping,
} = require('../utils/coinKlineMappings');

const KLINE_CLEANUP_INTERVALS = new Set(['15m', '1h', '4h', '1d']);

// 管理员中间件 - 验证是否为管理员
router.use(verifyToken);
router.use(requireAdmin);

const patchModels = {
  Coin,
  DailyMetric,
  LiquidityOverview,
  TrendingCoin,
};

function toPlainRow(row) {
  if (!row) return null;
  if (typeof row.get === 'function') return row.get({ plain: true });
  return row;
}

function createStatusError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function buildOpenAIPromptSettingsResponse({
  AppSettingModel = AppSetting,
} = {}) {
  const savedSettings = await getOpenAIPromptSettings({ AppSettingModel });
  const envSystemPrompt = process.env.OPENAI_SYSTEM_PROMPT || null;
  const envUserPromptTemplate = process.env.OPENAI_PROMPT || null;
  const defaultUserPromptTemplate = getDefaultPromptTemplate();

  return {
    systemPrompt: savedSettings.systemPrompt || envSystemPrompt || DEFAULT_SYSTEM_PROMPT,
    userPromptTemplate: savedSettings.userPromptTemplate || envUserPromptTemplate || defaultUserPromptTemplate,
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    defaultUserPromptTemplate,
    sources: {
      systemPrompt: savedSettings.systemPrompt ? 'database' : (envSystemPrompt ? 'env' : 'default'),
      userPromptTemplate: savedSettings.userPromptTemplate ? 'database' : (envUserPromptTemplate ? 'env' : 'default'),
    },
  };
}

async function buildOpenAIModelSettingsResponse({
  AppSettingModel = AppSetting,
  env = process.env,
} = {}) {
  return getOpenAIModelSettingsResponse({ AppSettingModel, env });
}

async function buildOpenAIModelCatalogResponse({
  AppSettingModel = AppSetting,
  env = process.env,
  listModels = listAvailableAIModels,
} = {}, payload = {}) {
  const currentSettings = await resolveOpenAIModelSettings({ AppSettingModel, env });
  const overrides = validateOpenAIModelSettings(payload);
  const models = await listModels({
    provider: overrides.provider || currentSettings.provider,
    baseURL: overrides.baseURL || currentSettings.baseURL,
    apiKey: overrides.apiKey || currentSettings.apiKey,
  });

  return { models };
}

function parseOptionalDate(value, boundary) {
  if (!value) return null;
  const trimmed = String(value).trim();
  const isoValue = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T${boundary === 'end' ? '23:59:59.999' : '00:00:00.000'}Z`
    : trimmed;
  const date = new Date(isoValue);
  if (!Number.isFinite(date.getTime())) {
    throw createStatusError(`${boundary === 'end' ? 'endDate' : 'startDate'} is invalid`, 400);
  }
  return date;
}

function normalizeKlineCleanupFilters(payload = {}) {
  const coinSymbol = String(payload.coinSymbol || payload.coin_symbol || '').trim().toUpperCase();
  const tradingSymbol = String(payload.tradingSymbol || payload.trading_symbol || '').trim();
  const market = String(payload.market || '').trim();
  const interval = String(payload.interval || '').trim();
  const startDate = parseOptionalDate(payload.startDate || payload.start_date, 'start');
  const endDate = parseOptionalDate(payload.endDate || payload.end_date, 'end');

  if (!coinSymbol && !tradingSymbol) {
    throw createStatusError('coinSymbol or tradingSymbol is required', 400);
  }
  if (interval && !KLINE_CLEANUP_INTERVALS.has(interval)) {
    throw createStatusError('interval is invalid', 400);
  }
  if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
    throw createStatusError('startDate must be before endDate', 400);
  }

  return {
    coinSymbol,
    tradingSymbol,
    market,
    interval,
    startDate,
    endDate,
  };
}

function buildKlineCleanupWhere(filters) {
  const where = {};
  if (filters.coinSymbol) where.coin_symbol = filters.coinSymbol;
  if (filters.tradingSymbol) where.trading_symbol = filters.tradingSymbol;
  if (filters.market) where.market = filters.market;
  if (filters.interval) where.interval = filters.interval;
  if (filters.startDate || filters.endDate) {
    where.open_time = {};
    if (filters.startDate) where.open_time[Op.gte] = filters.startDate;
    if (filters.endDate) where.open_time[Op.lte] = filters.endDate;
  }
  return where;
}

function serializeKlineCleanupFilters(filters) {
  return {
    coinSymbol: filters.coinSymbol || null,
    tradingSymbol: filters.tradingSymbol || null,
    market: filters.market || null,
    interval: filters.interval || null,
    startDate: filters.startDate ? filters.startDate.toISOString() : null,
    endDate: filters.endDate ? filters.endDate.toISOString() : null,
  };
}

async function previewKlineCleanup({
  CoinKlineModel = CoinKline,
} = {}, payload = {}) {
  const filters = normalizeKlineCleanupFilters(payload);
  const where = buildKlineCleanupWhere(filters);
  const count = await CoinKlineModel.count({ where });

  return {
    count,
    filters: serializeKlineCleanupFilters(filters),
  };
}

async function deleteKlinesByCleanupFilters({
  CoinKlineModel = CoinKline,
} = {}, payload = {}) {
  const preview = await previewKlineCleanup({ CoinKlineModel }, payload);
  if (!payload.confirm) {
    throw createStatusError('confirm is required', 400);
  }
  const where = buildKlineCleanupWhere({
    ...preview.filters,
    startDate: preview.filters.startDate ? new Date(preview.filters.startDate) : null,
    endDate: preview.filters.endDate ? new Date(preview.filters.endDate) : null,
  });
  const deleted = await CoinKlineModel.destroy({ where });

  return {
    deleted,
    filters: preview.filters,
  };
}

function serializeAdminCoin(coin, metricStatus = {}) {
  const plain = toPlainRow(coin);
  if (!plain) return null;

  return {
    id: plain.id,
    symbol: String(plain.symbol || '').toUpperCase(),
    name: plain.name || '',
    current_price: plain.current_price ?? null,
    logo_url: plain.logo_url || null,
    latestMetricDate: metricStatus.latestMetricDate || null,
    globalLatestMetricDate: metricStatus.globalLatestMetricDate || null,
    isLatestMetricMissing: Boolean(metricStatus.isLatestMetricMissing),
    createdAt: plain.createdAt || plain.created_at || null,
    updatedAt: plain.updatedAt || plain.updated_at || null,
  };
}

function normalizeAdminCoinPayload(payload = {}, { partial = false } = {}) {
  const normalized = {};
  const rawSymbol = payload.symbol;
  const rawName = payload.name;

  if (!partial || rawSymbol !== undefined) {
    const symbol = String(rawSymbol || '').trim().toUpperCase();
    if (!symbol) throw createStatusError('币种代码为必填项', 400);
    if (symbol.length > 30) throw createStatusError('币种代码最多30个字符', 400);
    normalized.symbol = symbol;
  }

  if (!partial || rawName !== undefined) {
    const name = String(rawName || '').trim();
    if (!name) throw createStatusError('币种名称为必填项', 400);
    if (name.length > 100) throw createStatusError('币种名称最多100个字符', 400);
    normalized.name = name;
  }

  if (!partial || payload.current_price !== undefined) {
    const rawPrice = payload.current_price ?? payload.currentPrice;
    if (rawPrice === undefined || rawPrice === null || rawPrice === '') {
      normalized.current_price = null;
    } else {
      const price = Number(rawPrice);
      if (!Number.isFinite(price)) throw createStatusError('当前价格必须是数字', 400);
      normalized.current_price = price;
    }
  }

  if (!partial || payload.logo_url !== undefined || payload.logoUrl !== undefined) {
    const rawLogoUrl = payload.logo_url ?? payload.logoUrl;
    const logoUrl = rawLogoUrl === undefined || rawLogoUrl === null
      ? ''
      : String(rawLogoUrl).trim();
    if (logoUrl.length > 500) throw createStatusError('Logo URL最多500个字符', 400);
    normalized.logo_url = logoUrl || null;
  }

  return normalized;
}

async function buildCoinMetricStatusById(DailyMetricModel, globalLatestMetricDate) {
  const statusByCoinId = new Map();
  if (!DailyMetricModel?.findAll) return statusByCoinId;

  const rows = await DailyMetricModel.findAll({
    attributes: ['coin_id', 'date'],
    order: [['coin_id', 'ASC'], ['date', 'DESC'], ['timestamp', 'DESC'], ['id', 'DESC']],
    raw: true,
  });

  rows.forEach(row => {
    const plain = toPlainRow(row);
    const coinId = Number(plain?.coin_id);
    if (!Number.isFinite(coinId) || statusByCoinId.has(coinId)) return;
    statusByCoinId.set(coinId, {
      latestMetricDate: plain.date || null,
      globalLatestMetricDate,
      isLatestMetricMissing: Boolean(globalLatestMetricDate && plain.date !== globalLatestMetricDate),
    });
  });

  return statusByCoinId;
}

async function listAdminCoins({
  CoinModel = Coin,
  DailyMetricModel = DailyMetric,
} = {}) {
  const coins = await CoinModel.findAll({
    attributes: ['id', 'symbol', 'name', 'current_price', 'logo_url', 'createdAt', 'updatedAt'],
    order: [['symbol', 'ASC']],
  });
  const globalLatestMetricDate = await findLatestMetricDate(DailyMetricModel);
  const metricStatusByCoinId = await buildCoinMetricStatusById(DailyMetricModel, globalLatestMetricDate);

  return {
    latestMetricDate: globalLatestMetricDate,
    coins: coins.map(coin => {
      const plainCoin = toPlainRow(coin);
      const metricStatus = metricStatusByCoinId.get(Number(plainCoin?.id)) || {
        latestMetricDate: null,
        globalLatestMetricDate,
        isLatestMetricMissing: Boolean(globalLatestMetricDate),
      };
      return serializeAdminCoin(coin, metricStatus);
    }),
  };
}

async function ensureUniqueCoinSymbol(CoinModel, symbol, excludeId) {
  if (!symbol) return;
  const where = { symbol };
  if (excludeId) {
    where.id = { [Op.ne]: Number(excludeId) };
  }
  const existing = await CoinModel.findOne({ where });
  if (existing) {
    throw createStatusError('币种代码已存在', 400);
  }
}

async function createAdminCoin({ CoinModel = Coin } = {}, payload = {}) {
  const normalized = normalizeAdminCoinPayload(payload);
  await ensureUniqueCoinSymbol(CoinModel, normalized.symbol);
  const coin = await CoinModel.create(normalized);

  return {
    coin: serializeAdminCoin(coin),
  };
}

async function updateSymbolRows(Model, values, where, transaction) {
  if (!Model?.update) return;
  await Model.update(values, { where, transaction });
}

async function syncCoinSymbolReferences(models, {
  coinId,
  oldSymbol,
  newSymbol,
  transaction,
}) {
  const {
    CoinKlineModel = CoinKline,
    CoinKlineMappingModel = CoinKlineMapping,
    UserFavoriteModel = UserFavorite,
  } = models;

  await Promise.all([
    updateSymbolRows(CoinKlineModel, { coin_symbol: newSymbol }, { coin_id: coinId }, transaction),
    updateSymbolRows(CoinKlineMappingModel, { coin_symbol: newSymbol }, { coin_id: coinId }, transaction),
    updateSymbolRows(UserFavoriteModel, { symbol: newSymbol }, { symbol: oldSymbol }, transaction),
  ]);
}

async function updateAdminCoin({
  CoinModel = Coin,
  CoinKlineModel = CoinKline,
  CoinKlineMappingModel = CoinKlineMapping,
  UserFavoriteModel = UserFavorite,
  SequelizeInstance = sequelize,
} = {}, coinId, payload = {}) {
  const coin = await CoinModel.findByPk(coinId);
  if (!coin) {
    throw createStatusError('币种不存在', 404);
  }

  const normalized = normalizeAdminCoinPayload(payload, { partial: true });
  const oldSymbol = String(coin.symbol || '').toUpperCase();
  const newSymbol = normalized.symbol || oldSymbol;
  if (normalized.symbol && newSymbol !== oldSymbol) {
    await ensureUniqueCoinSymbol(CoinModel, normalized.symbol, coin.id);
  }

  let updated;
  await runInTransaction(SequelizeInstance, async (transaction) => {
    updated = await coin.update(normalized, { transaction });
    if (newSymbol !== oldSymbol) {
      await syncCoinSymbolReferences({
        CoinKlineModel,
        CoinKlineMappingModel,
        UserFavoriteModel,
      }, {
        coinId: Number(coin.id),
        oldSymbol,
        newSymbol,
        transaction,
      });
    }
  });

  return {
    coin: serializeAdminCoin(updated),
  };
}

async function countModelRows(Model, where) {
  if (!Model?.count) return 0;
  return Model.count({ where });
}

async function getCoinDependencyCounts({
  DailyMetricModel = DailyMetric,
  CoinKlineModel = CoinKline,
  CoinKlineMappingModel = CoinKlineMapping,
  UserFavoriteModel = UserFavorite,
  BtcPricePointModel = BtcPricePoint,
} = {}, coin) {
  const coinId = Number(coin.id);
  const symbol = String(coin.symbol || '').toUpperCase();
  const [
    dailyMetrics,
    coinKlines,
    coinKlineMappings,
    userFavorites,
    btcPricePoints,
  ] = await Promise.all([
    countModelRows(DailyMetricModel, { coin_id: coinId }),
    countModelRows(CoinKlineModel, { coin_id: coinId }),
    countModelRows(CoinKlineMappingModel, { coin_id: coinId }),
    countModelRows(UserFavoriteModel, { symbol }),
    countModelRows(BtcPricePointModel, { coin_id: coinId }),
  ]);
  const total = dailyMetrics + coinKlines + coinKlineMappings + userFavorites + btcPricePoints;

  return {
    dailyMetrics,
    otcAndExplosionMetrics: dailyMetrics,
    coinKlines,
    coinKlineMappings,
    userFavorites,
    btcPricePoints,
    total,
  };
}

async function destroyRows(Model, where, transaction) {
  if (!Model?.destroy) return 0;
  return Model.destroy({ where, transaction });
}

async function deleteCoinDependencies(models, coin, transaction) {
  const {
    DailyMetricModel = DailyMetric,
    CoinKlineModel = CoinKline,
    CoinKlineMappingModel = CoinKlineMapping,
    UserFavoriteModel = UserFavorite,
    BtcPricePointModel = BtcPricePoint,
  } = models;
  const coinId = Number(coin.id);
  const symbol = String(coin.symbol || '').toUpperCase();

  await destroyRows(BtcPricePointModel, { coin_id: coinId }, transaction);
  await destroyRows(CoinKlineModel, { coin_id: coinId }, transaction);
  await destroyRows(CoinKlineMappingModel, { coin_id: coinId }, transaction);
  await destroyRows(UserFavoriteModel, { symbol }, transaction);
  await destroyRows(DailyMetricModel, { coin_id: coinId }, transaction);
}

async function runInTransaction(SequelizeInstance, callback) {
  if (!SequelizeInstance?.transaction) {
    return callback(undefined);
  }

  if (callback.length <= 1) {
    return SequelizeInstance.transaction(callback);
  }

  const transaction = await SequelizeInstance.transaction();
  try {
    const result = await callback(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function deleteAdminCoin({
  CoinModel = Coin,
  DailyMetricModel = DailyMetric,
  CoinKlineModel = CoinKline,
  CoinKlineMappingModel = CoinKlineMapping,
  UserFavoriteModel = UserFavorite,
  BtcPricePointModel = BtcPricePoint,
  SequelizeInstance = sequelize,
} = {}, coinId, { force = false } = {}) {
  const coin = await CoinModel.findByPk(coinId);
  if (!coin) {
    throw createStatusError('币种不存在', 404);
  }

  const plainCoin = toPlainRow(coin);
  const dependencyModels = {
    DailyMetricModel,
    CoinKlineModel,
    CoinKlineMappingModel,
    UserFavoriteModel,
    BtcPricePointModel,
  };
  const dependencies = await getCoinDependencyCounts(dependencyModels, plainCoin);
  if (dependencies.total > 0 && !force) {
    const error = createStatusError('该币种已有历史数据，需要二次确认后删除', 409);
    error.dependencies = dependencies;
    error.coin = serializeAdminCoin(plainCoin);
    throw error;
  }

  await runInTransaction(SequelizeInstance, async (transaction) => {
    if (force) {
      await deleteCoinDependencies(dependencyModels, plainCoin, transaction);
    }
    await coin.destroy({ transaction });
  });

  return {
    deleted: true,
    coin: serializeAdminCoin(plainCoin),
    dependencies,
  };
}

function serializeKlineMapping(coin, mapping) {
  const plainCoin = toPlainRow(coin);
  const plainMapping = toPlainRow(mapping);
  const displayMapping = resolveDisplayedKlineMapping(plainCoin, plainMapping);

  return {
    coinId: plainCoin.id,
    coinSymbol: String(plainCoin.symbol || '').toUpperCase(),
    coinName: plainCoin.name || String(plainCoin.symbol || '').toUpperCase(),
    mappingId: plainMapping?.id || null,
    market: displayMapping?.market || null,
    tradingSymbol: displayMapping?.trading_symbol || null,
    enabled: displayMapping?.enabled !== false,
    notes: plainMapping?.notes || displayMapping?.notes || null,
    updatedAt: plainMapping?.updatedAt || plainMapping?.updated_at || null,
    isDefault: !plainMapping,
  };
}

async function listKlineMappings({
  CoinModel = Coin,
  CoinKlineMappingModel = CoinKlineMapping,
  DailyMetricModel = DailyMetric,
} = {}) {
  const allCoins = await CoinModel.findAll({
    attributes: ['id', 'symbol', 'name'],
    order: [['symbol', 'ASC']],
    raw: true,
  });
  const { coins } = await filterCoinsWithLatestMetrics(allCoins, DailyMetricModel);
  const mappings = CoinKlineMappingModel?.findAll
    ? await CoinKlineMappingModel.findAll({ raw: false })
    : [];
  const mappingByCoinId = new Map(
    mappings.map(mapping => {
      const plain = toPlainRow(mapping);
      return [Number(plain.coin_id), mapping];
    })
  );

  return coins.map(coin => serializeKlineMapping(coin, mappingByCoinId.get(Number(coin.id))));
}

async function updateKlineMapping({
  CoinModel = Coin,
  CoinKlineMappingModel = CoinKlineMapping,
} = {}, {
  coinId,
  payload,
} = {}) {
  const coin = await CoinModel.findByPk(coinId);
  const plainCoin = toPlainRow(coin);
  if (!plainCoin) {
    throw createStatusError('Coin not found', 404);
  }

  let normalized;
  try {
    normalized = normalizeKlineMappingInput(payload || {});
  } catch (error) {
    throw createStatusError(error.message, 400);
  }

  const rowPayload = {
    coin_id: plainCoin.id,
    coin_symbol: String(plainCoin.symbol || '').toUpperCase(),
    ...normalized,
  };
  const existing = await CoinKlineMappingModel.findOne({
    where: { coin_id: plainCoin.id },
  });
  const row = existing
    ? await existing.update(rowPayload)
    : await CoinKlineMappingModel.create(rowPayload);

  return serializeKlineMapping(plainCoin, row);
}

async function seedDefaultKlineMappings({
  CoinModel = Coin,
  CoinKlineMappingModel = CoinKlineMapping,
  DailyMetricModel = DailyMetric,
} = {}) {
  const allCoins = await CoinModel.findAll({
    attributes: ['id', 'symbol'],
    order: [['symbol', 'ASC']],
    raw: true,
  });
  const { coins } = await filterCoinsWithLatestMetrics(allCoins, DailyMetricModel);
  const existingMappings = await CoinKlineMappingModel.findAll({ raw: true });
  const rows = buildDefaultKlineMappingsForCoins(coins, existingMappings);
  if (rows.length > 0) {
    await CoinKlineMappingModel.bulkCreate(rows);
  }

  return {
    created: rows.length,
    rows,
  };
}

function getPatchActor(req) {
  if (!req.user) return null;
  return req.user.username || String(req.user.id || '');
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({ error: 'JSON serialization failed', message: error.message });
  }
}

async function createPatchLog({
  patchId,
  mode,
  status,
  reason,
  patch,
  result,
  error,
  req,
  transaction,
}) {
  if (!DatabasePatchLog) return null;

  return DatabasePatchLog.create({
    patch_id: patchId,
    mode,
    status,
    reason: reason || 'validation failed',
    operations_count: result?.summary?.operations || patch?.operations?.length || 0,
    matched_count: result?.summary?.matched || 0,
    applied_count: result?.summary?.applied || 0,
    requested_by: getPatchActor(req),
    request_ip: req.ip,
    patch_json: safeJsonStringify(patch || req.body || {}),
    result_json: result ? safeJsonStringify(result) : null,
    error_message: error ? error.message : null,
  }, { transaction });
}

async function handleDatabasePatch(req, res, mode) {
  const patchId = crypto.randomUUID();
  const transaction = mode === 'apply' ? await sequelize.transaction() : null;

  try {
    const normalizedPatch = validateDatabasePatch(req.body);
    const result = await runDatabasePatch(normalizedPatch, {
      models: patchModels,
      mode,
      transaction,
    });

    const response = {
      success: true,
      patchId,
      ...result,
      normalizedPatch: undefined,
    };

    await createPatchLog({
      patchId,
      mode,
      status: 'success',
      reason: result.reason,
      patch: result.normalizedPatch,
      result: response,
      req,
      transaction,
    });

    if (transaction) {
      await transaction.commit();
    }

    res.json(response);
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }

    try {
      await createPatchLog({
        patchId,
        mode,
        status: 'failed',
        reason: req.body?.reason,
        patch: req.body,
        error,
        req,
      });
    } catch (logError) {
      console.error('写入数据库补丁失败日志失败:', logError);
    }

    const statusCode = error instanceof PatchValidationError ? 400 : 500;
    console.error(`[DATABASE_PATCH] ${mode} failed:`, error);
    res.status(statusCode).json({
      success: false,
      patchId,
      error: error.message,
    });
  }
}

router.post('/database-patches/dry-run', async (req, res) => {
  await handleDatabasePatch(req, res, 'dry-run');
});

router.post('/database-patches/apply', async (req, res) => {
  await handleDatabasePatch(req, res, 'apply');
});

router.get('/database-patches/logs', async (req, res) => {
  try {
    const rawLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, 100)
      : 20;

    const logs = await DatabasePatchLog.findAll({
      order: [['createdAt', 'DESC']],
      limit,
    });

    res.json({
      success: true,
      logs,
    });
  } catch (error) {
    console.error('获取数据库补丁日志失败:', error);
    res.status(500).json({
      success: false,
      error: '获取数据库补丁日志失败',
    });
  }
});

const dateRecordModels = {
  DailyMetric,
  LiquidityOverview,
  TrendingCoin,
};

function getDateRecordStatusCode(error) {
  return error instanceof AdminDateRecordError ? error.statusCode : 500;
}

router.get('/date-records/:date/summary', async (req, res) => {
  try {
    const summary = await getDateRecordSummary(dateRecordModels, req.params.date);
    res.json({
      success: true,
      summary,
    });
  } catch (error) {
    console.error('[DATE_RECORDS] summary failed:', error);
    res.status(getDateRecordStatusCode(error)).json({
      success: false,
      error: error.message,
    });
  }
});

router.put('/date-records/:date/time', async (req, res) => {
  const patchId = crypto.randomUUID();
  const transaction = await sequelize.transaction();

  try {
    const result = await updateDateRecordTime(dateRecordModels, {
      date: req.params.date,
      time: req.body?.time,
      timePrecision: req.body?.timePrecision,
      transaction,
    });

    await createPatchLog({
      patchId,
      mode: 'apply',
      status: 'success',
      reason: `修改日期时间 ${req.params.date}`,
      patch: {
        type: 'date-time-update',
        date: req.params.date,
        time: req.body?.time || null,
        timePrecision: req.body?.timePrecision,
      },
      result,
      req,
      transaction,
    });

    await transaction.commit();
    res.json({
      success: true,
      patchId,
      result,
    });
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }

    try {
      await createPatchLog({
        patchId,
        mode: 'apply',
        status: 'failed',
        reason: `修改日期时间 ${req.params.date}`,
        patch: {
          type: 'date-time-update',
          date: req.params.date,
          time: req.body?.time || null,
          timePrecision: req.body?.timePrecision,
        },
        error,
        req,
      });
    } catch (logError) {
      console.error('写入日期时间修改失败日志失败:', logError);
    }

    console.error('[DATE_RECORDS] time update failed:', error);
    res.status(getDateRecordStatusCode(error)).json({
      success: false,
      patchId,
      error: error.message,
    });
  }
});

router.delete('/date-records/:date', async (req, res) => {
  const patchId = crypto.randomUUID();
  const transaction = await sequelize.transaction();

  try {
    const before = await getDateRecordSummary(dateRecordModels, req.params.date);
    const result = await deleteDateRecords(dateRecordModels, {
      date: req.params.date,
      transaction,
    });

    await createPatchLog({
      patchId,
      mode: 'apply',
      status: 'success',
      reason: `删除日期数据 ${req.params.date}`,
      patch: {
        type: 'date-record-delete',
        date: req.params.date,
      },
      result: {
        before,
        ...result,
      },
      req,
      transaction,
    });

    await transaction.commit();
    res.json({
      success: true,
      patchId,
      before,
      result,
    });
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }

    try {
      await createPatchLog({
        patchId,
        mode: 'apply',
        status: 'failed',
        reason: `删除日期数据 ${req.params.date}`,
        patch: {
          type: 'date-record-delete',
          date: req.params.date,
        },
        error,
        req,
      });
    } catch (logError) {
      console.error('写入日期删除失败日志失败:', logError);
    }

    console.error('[DATE_RECORDS] delete failed:', error);
    res.status(getDateRecordStatusCode(error)).json({
      success: false,
      patchId,
      error: error.message,
    });
  }
});

router.get('/kline-mappings', async (req, res) => {
  try {
    await CoinKlineMapping?.sync?.();
    const mappings = await listKlineMappings();
    res.json({
      success: true,
      mappings,
    });
  } catch (error) {
    console.error('获取K线映射失败:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || '获取K线映射失败',
    });
  }
});

router.put('/kline-mappings/:coinId', async (req, res) => {
  try {
    await CoinKlineMapping?.sync?.();
    const mapping = await updateKlineMapping(undefined, {
      coinId: req.params.coinId,
      payload: req.body,
    });
    res.json({
      success: true,
      mapping,
    });
  } catch (error) {
    console.error('更新K线映射失败:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || '更新K线映射失败',
    });
  }
});

router.post('/kline-mappings/seed-defaults', async (req, res) => {
  try {
    await CoinKlineMapping?.sync?.();
    const result = await seedDefaultKlineMappings();
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('补齐默认K线映射失败:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || '补齐默认K线映射失败',
    });
  }
});

router.get('/coins', async (req, res) => {
  try {
    const result = await listAdminCoins();
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('获取币种列表失败:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || '获取币种列表失败',
    });
  }
});

router.post('/coins', async (req, res) => {
  try {
    const result = await createAdminCoin(undefined, req.body);
    res.status(201).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('创建币种失败:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || '创建币种失败',
    });
  }
});

router.put('/coins/:id', async (req, res) => {
  try {
    const result = await updateAdminCoin(undefined, req.params.id, req.body);
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('更新币种失败:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || '更新币种失败',
    });
  }
});

router.delete('/coins/:id', async (req, res) => {
  try {
    const force = req.query.force === 'true' || req.body?.force === true;
    const result = await deleteAdminCoin(undefined, req.params.id, { force });
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('删除币种失败:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || '删除币种失败',
      ...(error.dependencies ? { dependencies: error.dependencies } : {}),
      ...(error.coin ? { coin: error.coin } : {}),
      requiresConfirmation: error.statusCode === 409,
    });
  }
});

router.post('/kline-cleanup/preview', async (req, res) => {
  try {
    await CoinKline?.sync?.();
    const result = await previewKlineCleanup(undefined, req.body || {});
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('预览K线清理失败:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || '预览K线清理失败',
    });
  }
});

router.post('/kline-cleanup/delete', async (req, res) => {
  try {
    await CoinKline?.sync?.();
    const result = await deleteKlinesByCleanupFilters(undefined, req.body || {});
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('删除K线失败:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || '删除K线失败',
    });
  }
});

// 获取所有用户
router.get('/users', async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ['password'] }, // 不返回密码
      order: [['createdAt', 'DESC']]
    });
    
    res.json({
      success: true,
      users: users
    });
  } catch (error) {
    console.error('获取用户列表失败:', error);
    res.status(500).json({
      success: false,
      error: '获取用户列表失败'
    });
  }
});

// 创建新用户
router.post('/users', async (req, res) => {
  try {
    const { username, email, password, role = 'user', status = 'active' } = req.body;

    // 验证必填字段
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        error: '用户名、邮箱和密码为必填项'
      });
    }

    // 检查用户名是否已存在
    const existingUser = await User.findOne({ where: { username } });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: '用户名已存在'
      });
    }

    // 检查邮箱是否已存在
    const existingEmail = await User.findOne({ where: { email } });
    if (existingEmail) {
      return res.status(400).json({
        success: false,
        error: '邮箱已存在'
      });
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 创建用户
    const user = await User.create({
      username,
      email,
      password: hashedPassword,
      role,
      status
    });

    // 返回用户信息（不包含密码）
    const userResponse = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };

    res.status(201).json({
      success: true,
      message: '用户创建成功',
      user: userResponse
    });
  } catch (error) {
    console.error('创建用户失败:', error);
    res.status(500).json({
      success: false,
      error: '创建用户失败'
    });
  }
});

// 更新用户信息
router.put('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, role, status } = req.body;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: '用户不存在'
      });
    }

    // 如果要更新用户名，检查是否与其他用户冲突
    if (username && username !== user.username) {
      const existingUser = await User.findOne({ 
        where: { 
          username,
          id: { [require('sequelize').Op.ne]: id }
        } 
      });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: '用户名已存在'
        });
      }
    }

    // 如果要更新邮箱，检查是否与其他用户冲突
    if (email && email !== user.email) {
      const existingEmail = await User.findOne({ 
        where: { 
          email,
          id: { [require('sequelize').Op.ne]: id }
        } 
      });
      if (existingEmail) {
        return res.status(400).json({
          success: false,
          error: '邮箱已存在'
        });
      }
    }

    // 更新用户信息
    await user.update({
      username: username || user.username,
      email: email || user.email,
      role: role || user.role,
      status: status || user.status
    });

    const userResponse = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };

    res.json({
      success: true,
      message: '用户更新成功',
      user: userResponse
    });
  } catch (error) {
    console.error('更新用户失败:', error);
    res.status(500).json({
      success: false,
      error: '更新用户失败'
    });
  }
});

// 删除用户
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 不能删除自己
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        success: false,
        error: '不能删除自己的账户'
      });
    }

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: '用户不存在'
      });
    }

    await user.destroy();

    res.json({
      success: true,
      message: '用户删除成功'
    });
  } catch (error) {
    console.error('删除用户失败:', error);
    res.status(500).json({
      success: false,
      error: '删除用户失败'
    });
  }
});

// 封禁用户
router.post('/users/:id/ban', async (req, res) => {
  try {
    const { id } = req.params;

    // 不能封禁自己
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        success: false,
        error: '不能封禁自己的账户'
      });
    }

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: '用户不存在'
      });
    }

    await user.update({ status: 'banned' });

    res.json({
      success: true,
      message: '用户已封禁'
    });
  } catch (error) {
    console.error('封禁用户失败:', error);
    res.status(500).json({
      success: false,
      error: '封禁用户失败'
    });
  }
});

// 解封用户
router.post('/users/:id/unban', async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: '用户不存在'
      });
    }

    await user.update({ status: 'active' });

    res.json({
      success: true,
      message: '用户已解封'
    });
  } catch (error) {
    console.error('解封用户失败:', error);
    res.status(500).json({
      success: false,
      error: '解封用户失败'
    });
  }
});

// 获取系统设置
router.get('/settings', async (req, res) => {
  try {
    const settings = getSystemSettings();
    res.json({
      success: true,
      settings: settings
    });
  } catch (error) {
    console.error('获取系统设置失败:', error);
    res.status(500).json({
      success: false,
      error: '获取系统设置失败'
    });
  }
});

// 更新系统设置
router.put('/settings', async (req, res) => {
  try {
    const { registrationEnabled } = req.body;
    
    const newSettings = {};
    if (typeof registrationEnabled === 'boolean') {
      newSettings.registrationEnabled = registrationEnabled;
    }

    const updatedSettings = updateSystemSettings(newSettings);

    res.json({
      success: true,
      message: '系统设置更新成功',
      settings: updatedSettings
    });
  } catch (error) {
    console.error('更新系统设置失败:', error);
    res.status(500).json({
      success: false,
      error: '更新系统设置失败'
    });
  }
});

router.get('/openai-prompt-settings', async (req, res) => {
  try {
    await AppSetting?.sync?.();
    const settings = await buildOpenAIPromptSettingsResponse();
    res.json({
      success: true,
      settings,
    });
  } catch (error) {
    console.error('获取AI解析Prompt设置失败:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || '获取AI解析Prompt设置失败',
    });
  }
});

router.get('/openai-model-settings', async (req, res) => {
  try {
    await AppSetting?.sync?.();
    const settings = await buildOpenAIModelSettingsResponse();
    res.json({ success: true, settings });
  } catch (error) {
    console.error('获取AI模型设置失败:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || '获取AI模型设置失败',
    });
  }
});

router.post('/openai-model-settings/models', async (req, res) => {
  try {
    await AppSetting?.sync?.();
    const result = await buildOpenAIModelCatalogResponse({}, req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('同步AI模型列表失败:', error);
    res.status(error.statusCode || 502).json({
      success: false,
      error: error.message || '同步AI模型列表失败',
    });
  }
});

router.put('/openai-model-settings', async (req, res) => {
  try {
    await AppSetting?.sync?.();
    await updateOpenAIModelSettings({ AppSettingModel: AppSetting }, req.body || {});
    const settings = await buildOpenAIModelSettingsResponse();
    res.json({
      success: true,
      message: 'AI模型设置已保存',
      settings,
    });
  } catch (error) {
    console.error('保存AI模型设置失败:', error);
    res.status(error.statusCode || 400).json({
      success: false,
      error: error.message || '保存AI模型设置失败',
    });
  }
});

router.post('/openai-model-settings/reset', async (req, res) => {
  try {
    await AppSetting?.sync?.();
    await resetOpenAIModelSettings({ AppSettingModel: AppSetting });
    const settings = await buildOpenAIModelSettingsResponse();
    res.json({
      success: true,
      message: 'AI模型设置已恢复环境配置',
      settings,
    });
  } catch (error) {
    console.error('恢复AI模型设置失败:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || '恢复AI模型设置失败',
    });
  }
});

router.put('/openai-prompt-settings', async (req, res) => {
  try {
    await AppSetting?.sync?.();
    await updateOpenAIPromptSettings({ AppSettingModel: AppSetting }, {
      systemPrompt: req.body.systemPrompt,
      userPromptTemplate: req.body.userPromptTemplate,
    });
    const settings = await buildOpenAIPromptSettingsResponse();
    res.json({
      success: true,
      message: 'AI解析Prompt设置已保存',
      settings,
    });
  } catch (error) {
    console.error('保存AI解析Prompt设置失败:', error);
    res.status(error.statusCode || 400).json({
      success: false,
      error: error.message || '保存AI解析Prompt设置失败',
    });
  }
});

router.post('/openai-prompt-settings/reset', async (req, res) => {
  try {
    await AppSetting?.sync?.();
    await resetOpenAIPromptSettings({ AppSettingModel: AppSetting });
    const settings = await buildOpenAIPromptSettingsResponse();
    res.json({
      success: true,
      message: 'AI解析Prompt设置已恢复默认',
      settings,
    });
  } catch (error) {
    console.error('恢复AI解析Prompt设置失败:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || '恢复AI解析Prompt设置失败',
    });
  }
});

router.__test = {
  buildOpenAIModelCatalogResponse,
  buildOpenAIModelSettingsResponse,
  buildOpenAIPromptSettingsResponse,
  buildCoinMetricStatusById,
  createAdminCoin,
  deleteAdminCoin,
  deleteKlinesByCleanupFilters,
  getCoinDependencyCounts,
  listAdminCoins,
  listKlineMappings,
  previewKlineCleanup,
  seedDefaultKlineMappings,
  serializeKlineMapping,
  updateAdminCoin,
  updateKlineMapping,
};

module.exports = router;
