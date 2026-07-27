const assert = require('assert');
const { Sequelize, DataTypes } = require('sequelize');

const createCoinKlines = require('../migrations/20260608000001-create-coin-klines');
const migration = require('../migrations/20260727000001-add-trading-symbol-to-coin-kline-unique-index');
const defineCoinKline = require('../models/coinkline');

const LEGACY_INDEX_NAME = 'coin_klines_unique_coin_market_interval_open_time';
const NEXT_INDEX_NAME = 'coin_klines_unique_coin_market_symbol_interval_open_time';

function buildRow(overrides = {}) {
  return {
    coin_id: 1,
    coin_symbol: 'GOLD',
    trading_symbol: 'GC=F',
    market: 'yahoo_finance',
    interval: '1d',
    open_time: new Date(Date.UTC(2026, 0, 2)),
    close_time: new Date(Date.UTC(2026, 0, 3) - 1),
    open_price: 1,
    high_price: 2,
    low_price: 0.5,
    close_price: 1.5,
    volume: 10,
    quote_volume: 0,
    trade_count: 0,
    ...overrides,
  };
}

async function createLegacySchema() {
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
  const queryInterface = sequelize.getQueryInterface();

  await queryInterface.createTable('Coins', {
    id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
    symbol: { allowNull: false, type: Sequelize.STRING },
  });
  await queryInterface.bulkInsert('Coins', [{ id: 1, symbol: 'GOLD' }]);
  await createCoinKlines.up(queryInterface, Sequelize);

  return { sequelize, queryInterface };
}

async function indexNames(queryInterface) {
  return (await queryInterface.showIndex('CoinKlines')).map(index => index.name);
}

async function run() {
  const { sequelize, queryInterface } = await createLegacySchema();
  const CoinKline = defineCoinKline(sequelize, DataTypes);

  assert.ok((await indexNames(queryInterface)).includes(LEGACY_INDEX_NAME));

  await migration.up(queryInterface);
  const migratedIndexes = await indexNames(queryInterface);
  assert.ok(migratedIndexes.includes(NEXT_INDEX_NAME));
  assert.ok(!migratedIndexes.includes(LEGACY_INDEX_NAME), '旧唯一索引必须被移除');

  // 重复执行必须幂等
  await migration.up(queryInterface);
  assert.ok((await indexNames(queryInterface)).includes(NEXT_INDEX_NAME));

  // 同一 coin/market/interval/open_time 下，不同 trading_symbol 必须能共存
  await CoinKline.upsert(buildRow({ trading_symbol: 'GC=F' }));
  await CoinKline.upsert(buildRow({ trading_symbol: 'GLD', close_price: 99 }));
  assert.strictEqual(await CoinKline.count(), 2);

  // 相同 trading_symbol 仍然原地更新，不会产生重复行
  await CoinKline.upsert(buildRow({ trading_symbol: 'GC=F', close_price: 7 }));
  assert.strictEqual(await CoinKline.count(), 2);
  const updated = await CoinKline.findOne({ where: { trading_symbol: 'GC=F' }, raw: true });
  assert.strictEqual(updated.close_price, 7);

  // 回滚无法恢复旧四列唯一键时必须停止，并保留当前五列唯一键
  await assert.rejects(() => migration.down(queryInterface), /无法安全恢复唯一索引/);
  assert.ok((await indexNames(queryInterface)).includes(NEXT_INDEX_NAME));

  await CoinKline.destroy({ where: { trading_symbol: 'GLD' } });
  await migration.down(queryInterface);
  const rolledBackIndexes = await indexNames(queryInterface);
  assert.ok(rolledBackIndexes.includes(LEGACY_INDEX_NAME));
  assert.ok(!rolledBackIndexes.includes(NEXT_INDEX_NAME));

  await sequelize.close();

  // 已存在重复行时应当报错而不是删除生产数据
  const dirty = await createLegacySchema();
  await dirty.queryInterface.removeIndex('CoinKlines', LEGACY_INDEX_NAME);
  const DirtyCoinKline = defineCoinKline(dirty.sequelize, DataTypes);
  await DirtyCoinKline.create(buildRow());
  await DirtyCoinKline.create(buildRow());

  await assert.rejects(
    () => migration.up(dirty.queryInterface),
    /重复行/,
    '存在重复行时必须抛错阻止建唯一索引'
  );
  assert.strictEqual(await DirtyCoinKline.count(), 2, '迁移不允许删除任何生产行');
  await dirty.sequelize.close();

  console.log('coinKlineUniqueIndexMigration.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
