const assert = require('assert');

const adminRouter = require('../routes/admin');

function createFakeModels() {
  const coins = [
    { id: 1, symbol: 'CN_AI_ETF', name: '国内人工智能 ETF' },
    { id: 2, symbol: 'BTC', name: 'Bitcoin' },
    { id: 3, symbol: 'EOS', name: 'EOS' },
  ];
  const mappings = new Map([
    [1, {
      id: 11,
      coin_id: 1,
      coin_symbol: 'CN_AI_ETF',
      market: 'yahoo_finance',
      trading_symbol: '159819.SZ',
      enabled: true,
      notes: 'custom',
      updatedAt: new Date('2026-06-17T00:00:00.000Z'),
      update(payload) {
        Object.assign(this, payload);
        return Promise.resolve(this);
      },
      get() {
        return this;
      },
    }],
  ]);
  const appSettings = new Map();
  const klineRows = [
    {
      coin_symbol: 'GOLD',
      trading_symbol: 'GLD',
      market: 'yahoo_finance',
      interval: '4h',
      open_time: new Date('2026-01-01T00:00:00.000Z'),
    },
    {
      coin_symbol: 'GOLD',
      trading_symbol: 'GLD',
      market: 'yahoo_finance',
      interval: '1d',
      open_time: new Date('2026-01-01T00:00:00.000Z'),
    },
    {
      coin_symbol: 'GOLD',
      trading_symbol: 'XAUUSD=X',
      market: 'yahoo_finance',
      interval: '4h',
      open_time: new Date('2026-01-01T00:00:00.000Z'),
    },
  ];

  const matchesWhere = (row, where = {}) => {
    if (where.coin_symbol && row.coin_symbol !== where.coin_symbol) return false;
    if (where.trading_symbol && row.trading_symbol !== where.trading_symbol) return false;
    if (where.market && row.market !== where.market) return false;
    if (where.interval && row.interval !== where.interval) return false;
    if (where.open_time) {
      const openTime = row.open_time.getTime();
      const symbols = Object.getOwnPropertySymbols(where.open_time);
      const gteKey = symbols.find(symbol => String(symbol) === 'Symbol(gte)');
      const lteKey = symbols.find(symbol => String(symbol) === 'Symbol(lte)');
      if (gteKey && openTime < where.open_time[gteKey].getTime()) {
        return false;
      }
      if (lteKey && openTime > where.open_time[lteKey].getTime()) {
        return false;
      }
    }
    return true;
  };

  return {
    CoinModel: {
      async findAll() {
        return coins;
      },
      async findByPk(id) {
        return coins.find(coin => coin.id === Number(id)) || null;
      },
    },
    CoinKlineMappingModel: {
      created: [],
      async findAll() {
        return Array.from(mappings.values());
      },
      async findOne(options) {
        return mappings.get(Number(options.where.coin_id)) || null;
      },
      async create(payload) {
        this.created.push(payload);
        const row = {
          id: 100 + this.created.length,
          ...payload,
          update(nextPayload) {
            Object.assign(this, nextPayload);
            return Promise.resolve(this);
          },
          get() {
            return this;
          },
        };
        mappings.set(payload.coin_id, row);
        return row;
      },
      async bulkCreate(rows) {
        rows.forEach(row => this.created.push(row));
        return rows;
      },
    },
    DailyMetricModel: {
      async findOne() {
        return { date: '2026-06-06' };
      },
      async findAll(options) {
        if (options.where?.date === '2026-06-06') {
          return [
            { coin_id: 1 },
            { coin_id: 2 },
          ];
        }
        return [];
      },
    },
    CoinKlineModel: {
      rows: klineRows,
      lastWhere: null,
      async count(options) {
        this.lastWhere = options.where;
        return this.rows.filter(row => matchesWhere(row, options.where)).length;
      },
      async destroy(options) {
        this.lastWhere = options.where;
        const before = this.rows.length;
        this.rows = this.rows.filter(row => !matchesWhere(row, options.where));
        return before - this.rows.length;
      },
    },
    AppSettingModel: {
      async findAll() {
        return Array.from(appSettings.values());
      },
      async findOne(options) {
        return appSettings.get(options.where.key) || null;
      },
      async create(payload) {
        const row = {
          ...payload,
          update(nextPayload) {
            Object.assign(this, nextPayload);
            return Promise.resolve(this);
          },
          get() {
            return this;
          },
        };
        appSettings.set(payload.key, row);
        return row;
      },
      async destroy(options) {
        const keys = Array.isArray(options.where.key) ? options.where.key : [options.where.key];
        keys.forEach(key => appSettings.delete(key));
      },
    },
  };
}

async function run() {
  const {
    listKlineMappings,
    previewKlineCleanup,
    seedDefaultKlineMappings,
    deleteKlinesByCleanupFilters,
    updateKlineMapping,
    buildOpenAIPromptSettingsResponse,
  } = adminRouter.__test;

  const models = createFakeModels();
  const list = await listKlineMappings(models);
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].coinSymbol, 'CN_AI_ETF');
  assert.strictEqual(list[0].market, 'yahoo_finance');
  assert.strictEqual(list[0].tradingSymbol, '159819.SZ');
  assert.strictEqual(list[1].market, 'binance_usdm_perpetual');
  assert.strictEqual(list[1].tradingSymbol, 'BTCUSDT');

  const updated = await updateKlineMapping(models, {
    coinId: 2,
    payload: {
      market: 'binance_usdm_perpetual',
      trading_symbol: 'btc',
      enabled: true,
      notes: ' core ',
    },
  });
  assert.strictEqual(updated.coinSymbol, 'BTC');
  assert.strictEqual(updated.tradingSymbol, 'BTCUSDT');
  assert.strictEqual(updated.notes, 'core');
  assert.strictEqual(models.CoinKlineMappingModel.created.length, 1);

  const disabled = await updateKlineMapping(models, {
    coinId: 2,
    payload: {
      market: 'binance_usdm_perpetual',
      trading_symbol: 'btc',
      enabled: false,
      notes: ' paused ',
    },
  });
  assert.strictEqual(disabled.market, 'binance_usdm_perpetual');
  assert.strictEqual(disabled.tradingSymbol, 'BTCUSDT');
  assert.strictEqual(disabled.enabled, false);
  assert.strictEqual(disabled.notes, 'paused');

  let invalidError = null;
  try {
    await updateKlineMapping(models, {
      coinId: 2,
      payload: {
        market: 'bad',
        trading_symbol: 'BTCUSDT',
      },
    });
  } catch (error) {
    invalidError = error;
  }
  assert.match(invalidError.message, /Unsupported kline market/);

  const seeded = await seedDefaultKlineMappings(createFakeModels());
  assert.strictEqual(seeded.created, 1);
  assert.strictEqual(seeded.rows[0].coin_symbol, 'BTC');
  assert.strictEqual(seeded.rows[0].trading_symbol, 'BTCUSDT');

  const cleanupModels = createFakeModels();
  const preview = await previewKlineCleanup(cleanupModels, {
    coinSymbol: 'gold',
    market: 'yahoo_finance',
    tradingSymbol: 'GLD',
    interval: '4h',
  });
  assert.strictEqual(preview.count, 1);
  assert.strictEqual(preview.filters.coinSymbol, 'GOLD');
  assert.strictEqual(preview.filters.tradingSymbol, 'GLD');

  let confirmError = null;
  try {
    await deleteKlinesByCleanupFilters(cleanupModels, {
      coinSymbol: 'GOLD',
      market: 'yahoo_finance',
      tradingSymbol: 'GLD',
      interval: '4h',
    });
  } catch (error) {
    confirmError = error;
  }
  assert.match(confirmError.message, /confirm is required/);

  const deleted = await deleteKlinesByCleanupFilters(cleanupModels, {
    coinSymbol: 'GOLD',
    market: 'yahoo_finance',
    tradingSymbol: 'GLD',
    interval: '4h',
    confirm: true,
  });
  assert.strictEqual(deleted.deleted, 1);
  assert.strictEqual(cleanupModels.CoinKlineModel.rows.length, 2);

  const promptModels = createFakeModels();
  const defaultPromptSettings = await buildOpenAIPromptSettingsResponse(promptModels);
  assert.strictEqual(defaultPromptSettings.sources.userPromptTemplate, 'default');
  assert.ok(defaultPromptSettings.userPromptTemplate.includes('{{processedText}}'));

  await promptModels.AppSettingModel.create({
    key: 'openai_user_prompt_template',
    value: '自定义 {{processedText}}',
  });
  const savedPromptSettings = await buildOpenAIPromptSettingsResponse(promptModels);
  assert.strictEqual(savedPromptSettings.sources.userPromptTemplate, 'database');
  assert.strictEqual(savedPromptSettings.userPromptTemplate, '自定义 {{processedText}}');

  console.log('klineMappingsAdmin.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
