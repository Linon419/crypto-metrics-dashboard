const assert = require('assert');

const adminRouter = require('../routes/admin');

function createRow(payload) {
  return {
    ...payload,
    update(updatePayload) {
      Object.assign(this, updatePayload);
      return Promise.resolve(this);
    },
    destroy() {
      this.destroyed = true;
      return Promise.resolve(1);
    },
    get() {
      return this;
    },
  };
}

function createFakeCoinModels() {
  const coins = new Map([
    [1, createRow({
      id: 1,
      symbol: 'BTC',
      name: 'Bitcoin',
      current_price: 65000,
      logo_url: 'https://example.com/btc.png',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })],
    [2, createRow({
      id: 2,
      symbol: 'EMPTY',
      name: 'Empty Coin',
      current_price: null,
      logo_url: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })],
    [4, createRow({
      id: 4,
      symbol: 'STALE',
      name: 'Stale Coin',
      current_price: null,
      logo_url: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })],
  ]);
  let nextId = 3;
  const dependencyCounts = {
    DailyMetricModel: { 1: 2, 2: 0 },
    CoinKlineModel: { 1: 3, 2: 0 },
    CoinKlineMappingModel: { 1: 1, 2: 0 },
    UserFavoriteModel: { BTC: 1, EMPTY: 0 },
    BtcPricePointModel: { 1: 4, 2: 0 },
  };
  const destroyed = [];
  const updatedReferences = [];

  function createDependencyModel(name) {
    return {
      async count(options) {
        const key = options.where.symbol || options.where.coin_id;
        return dependencyCounts[name][key] || 0;
      },
      async destroy(options) {
        const key = options.where.symbol || options.where.coin_id;
        destroyed.push({ model: name, key });
        dependencyCounts[name][key] = 0;
        return 1;
      },
      async update(values, options) {
        updatedReferences.push({ model: name, values, where: options.where });
        return [1];
      },
    };
  }

  return {
    destroyed,
    updatedReferences,
    CoinModel: {
      async findAll() {
        return Array.from(coins.values());
      },
      async findByPk(id) {
        return coins.get(Number(id)) || null;
      },
      async findOne(options) {
        const symbol = String(options.where.symbol || '').toUpperCase();
        const excludedId = Number(options.where.id?.[Object.getOwnPropertySymbols(options.where.id)[0]]);
        return Array.from(coins.values()).find(coin => (
          coin.symbol === symbol && (!Number.isFinite(excludedId) || coin.id !== excludedId)
        )) || null;
      },
      async create(payload) {
        const row = createRow({
          id: nextId,
          ...payload,
          createdAt: '2026-01-03T00:00:00.000Z',
          updatedAt: '2026-01-03T00:00:00.000Z',
        });
        nextId += 1;
        coins.set(row.id, row);
        return row;
      },
    },
    CoinKlineModel: createDependencyModel('CoinKlineModel'),
    CoinKlineMappingModel: createDependencyModel('CoinKlineMappingModel'),
    UserFavoriteModel: createDependencyModel('UserFavoriteModel'),
    BtcPricePointModel: createDependencyModel('BtcPricePointModel'),
    DailyMetricModel: {
      ...createDependencyModel('DailyMetricModel'),
      async findOne() {
        return { date: '2026-06-06' };
      },
      async findAll() {
        return [
          { coin_id: 1, date: '2026-06-06' },
          { coin_id: 1, date: '2026-06-05' },
          { coin_id: 4, date: '2026-06-01' },
        ];
      },
    },
    SequelizeInstance: {
      async transaction(callback) {
        return callback({ id: 'tx' });
      },
    },
  };
}

async function run() {
  const {
    createAdminCoin,
    deleteAdminCoin,
    listAdminCoins,
    updateAdminCoin,
  } = adminRouter.__test;

  const models = createFakeCoinModels();
  const list = await listAdminCoins(models);
  assert.strictEqual(list.latestMetricDate, '2026-06-06');
  assert.strictEqual(list.coins.length, 3);
  assert.strictEqual(list.coins[0].symbol, 'BTC');
  assert.strictEqual(list.coins[0].latestMetricDate, '2026-06-06');
  assert.strictEqual(list.coins[0].isLatestMetricMissing, false);
  assert.strictEqual(list.coins.find(coin => coin.symbol === 'EMPTY').isLatestMetricMissing, true);
  assert.strictEqual(list.coins.find(coin => coin.symbol === 'STALE').latestMetricDate, '2026-06-01');
  assert.strictEqual(list.coins.find(coin => coin.symbol === 'STALE').isLatestMetricMissing, true);

  const created = await createAdminCoin(models, {
    symbol: 'test',
    name: 'Test Coin',
    current_price: '12.5',
    logo_url: 'https://example.com/test.png',
  });
  assert.strictEqual(created.coin.symbol, 'TEST');
  assert.strictEqual(created.coin.current_price, 12.5);

  let duplicateError = null;
  try {
    await createAdminCoin(models, {
      symbol: 'btc',
      name: 'Duplicate BTC',
    });
  } catch (error) {
    duplicateError = error;
  }
  assert.strictEqual(duplicateError.statusCode, 400);
  assert.match(duplicateError.message, /币种代码已存在/);

  const updated = await updateAdminCoin(models, 2, {
    symbol: 'empty2',
    name: 'Empty Coin 2',
    current_price: '',
    logo_url: '',
  });
  assert.strictEqual(updated.coin.symbol, 'EMPTY2');
  assert.strictEqual(updated.coin.current_price, null);
  assert.strictEqual(updated.coin.logo_url, null);
  assert.deepStrictEqual(models.updatedReferences.map(entry => entry.model), [
    'CoinKlineModel',
    'CoinKlineMappingModel',
    'UserFavoriteModel',
  ]);
  assert.deepStrictEqual(models.updatedReferences[0].values, { coin_symbol: 'EMPTY2' });
  assert.deepStrictEqual(models.updatedReferences[2].values, { symbol: 'EMPTY2' });

  let dependencyError = null;
  try {
    await deleteAdminCoin(models, 1, { force: false });
  } catch (error) {
    dependencyError = error;
  }
  assert.strictEqual(dependencyError.statusCode, 409);
  assert.strictEqual(dependencyError.dependencies.dailyMetrics, 2);
  assert.strictEqual(dependencyError.dependencies.coinKlines, 3);
  assert.strictEqual(dependencyError.dependencies.otcAndExplosionMetrics, 2);

  const forced = await deleteAdminCoin(models, 1, { force: true });
  assert.strictEqual(forced.deleted, true);
  assert.strictEqual(forced.dependencies.dailyMetrics, 2);
  assert.deepStrictEqual(models.destroyed.map(entry => entry.model), [
    'BtcPricePointModel',
    'CoinKlineModel',
    'CoinKlineMappingModel',
    'UserFavoriteModel',
    'DailyMetricModel',
  ]);

  const emptyDeleted = await deleteAdminCoin(models, 2, { force: false });
  assert.strictEqual(emptyDeleted.deleted, true);
  assert.strictEqual(emptyDeleted.dependencies.total, 0);

  console.log('adminCoins.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
