/**
 * 回归用例：启动时必须删掉已被取代的过期唯一索引。
 *
 * 本项目实际不跑 migration（SequelizeMeta 停在 2025，且对现网库执行
 * db:migrate 会死在 duplicate column name: lastLogin），表结构由 sync() 维护。
 * 而 sync() 只补建索引、不删旧索引 —— 实测在现网库副本上执行 sync() 后，
 * 新旧两个唯一索引会同时存在。此时旧的四列唯一索引依然会阻止
 * 同一 market 下两个 trading_symbol 落在同一 open_time（如 GOLD 的 GC=F 与 GLD）。
 */

const assert = require('assert');
const { Sequelize, DataTypes } = require('sequelize');

const { reconcileIndexes, STALE_INDEXES } = require('../utils/schemaMaintenance');

const STALE = 'coin_klines_unique_coin_market_interval_open_time';
const REPLACEMENT = 'coin_klines_unique_coin_market_symbol_interval_open_time';

function defineCoinKline(sequelize, indexes) {
  return sequelize.define('CoinKline', {
    coin_id: { type: DataTypes.INTEGER, allowNull: false },
    market: { type: DataTypes.STRING, allowNull: false },
    trading_symbol: { type: DataTypes.STRING, allowNull: false },
    interval: { type: DataTypes.STRING, allowNull: false },
    open_time: { type: DataTypes.DATE, allowNull: false },
  }, { tableName: 'CoinKlines', timestamps: false, indexes });
}

async function indexNames(sequelize) {
  const rows = await sequelize.query("PRAGMA index_list('CoinKlines')", { type: 'SELECT' });
  return rows.map(row => row.name);
}

async function run() {
  // 配置里必须真的登记了这条过期索引
  assert.ok(
    STALE_INDEXES.some(entry => entry.staleIndex === STALE && entry.replacedBy === REPLACEMENT),
    'STALE_INDEXES 应登记 CoinKlines 的旧唯一索引'
  );

  const sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });

  // 1. 先造出"旧库"：只有四列唯一索引
  const Old = defineCoinKline(sequelize, [
    { fields: ['coin_id', 'market', 'interval', 'open_time'], unique: true, name: STALE },
  ]);
  await Old.sync();
  assert.ok((await indexNames(sequelize)).includes(STALE), '旧唯一索引应已建立');

  // 2. 模拟升级后的 sync()：补建新索引，但旧索引仍在
  sequelize.modelManager.removeModel(sequelize.models.CoinKline);
  const New = defineCoinKline(sequelize, [
    {
      fields: ['coin_id', 'market', 'interval', 'trading_symbol', 'open_time'],
      unique: true,
      name: REPLACEMENT,
    },
  ]);
  await New.sync();

  const afterSync = await indexNames(sequelize);
  assert.ok(afterSync.includes(REPLACEMENT), 'sync() 应补建新唯一索引');
  assert.ok(
    afterSync.includes(STALE),
    'sync() 不会删除旧索引 —— 这正是本用例存在的前提，若上游行为改变请更新此处'
  );

  // 3. 收敛后旧索引消失，新索引保留
  const silent = { log() {}, warn() {}, error() {} };
  await reconcileIndexes(sequelize, silent);

  const afterReconcile = await indexNames(sequelize);
  assert.ok(!afterReconcile.includes(STALE), '过期唯一索引应被删除');
  assert.ok(afterReconcile.includes(REPLACEMENT), '替代唯一索引必须保留');

  // 4. 幂等
  await reconcileIndexes(sequelize, silent);
  assert.deepStrictEqual(
    (await indexNames(sequelize)).sort(),
    afterReconcile.sort(),
    '重复执行不应产生变化'
  );

  // 5. 功能验证：同一 market 下两个 trading_symbol 可共存于同一 open_time
  const row = { coin_id: 1, market: 'yahoo_finance', interval: '1d', open_time: new Date('2030-01-01T00:00:00Z') };
  await New.create({ ...row, trading_symbol: 'GC=F' });
  await New.create({ ...row, trading_symbol: 'GLD' });
  assert.strictEqual(await New.count(), 2, '两个 trading_symbol 应能共存');

  // 6. 替代索引不存在时不得删除旧索引（否则会留下无唯一约束的窗口）
  const sequelize2 = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
  const OnlyOld = defineCoinKline(sequelize2, [
    { fields: ['coin_id', 'market', 'interval', 'open_time'], unique: true, name: STALE },
  ]);
  await OnlyOld.sync();
  await reconcileIndexes(sequelize2, silent);
  const names2 = await sequelize2.query("PRAGMA index_list('CoinKlines')", { type: 'SELECT' });
  assert.ok(
    names2.map(n => n.name).includes(STALE),
    '替代索引缺失时应保留旧索引'
  );

  await sequelize.close();
  await sequelize2.close();
  console.log('schemaMaintenance.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
