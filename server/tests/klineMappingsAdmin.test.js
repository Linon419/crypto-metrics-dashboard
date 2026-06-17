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
  };
}

async function run() {
  const {
    listKlineMappings,
    seedDefaultKlineMappings,
    updateKlineMapping,
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

  console.log('klineMappingsAdmin.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
