/**
 * 启动时的索引收敛。
 *
 * 这个项目实际上并不跑 migration：SequelizeMeta 停在 2025 年，
 * 现网库的表是 db.sequelize.sync() 建出来的，且对现有库执行 db:migrate
 * 会直接死在 `duplicate column name: lastLogin`。
 *
 * 而 sync() 只会“补建”模型里声明的索引，**不会删除已废弃的旧索引**。
 * 于是 CoinKlines 的唯一键加上 trading_symbol 之后，旧的四列唯一索引
 * 仍然存在，同一 market 下两个 trading_symbol 撞上同一 open_time 时
 * 依旧会抛 SQLITE_CONSTRAINT（例如 GOLD 的 GC=F 与 GLD）。
 *
 * 这里只做一件事：当替代索引已经存在时，删掉明确列出的过期索引。
 * 不改列、不改表、不删数据，因此对现网库是安全且幂等的。
 */

// { table, staleIndex, replacedBy }
const STALE_INDEXES = [
  {
    table: 'CoinKlines',
    staleIndex: 'coin_klines_unique_coin_market_interval_open_time',
    replacedBy: 'coin_klines_unique_coin_market_symbol_interval_open_time',
  },
];

async function listIndexNames(queryInterface, table) {
  try {
    const indexes = await queryInterface.showIndex(table);
    return new Set(indexes.map(index => index.name));
  } catch (error) {
    // 表不存在等情况直接跳过
    return null;
  }
}

async function reconcileIndexes(sequelize, logger = console) {
  const queryInterface = sequelize.getQueryInterface();
  const dropped = [];

  for (const { table, staleIndex, replacedBy } of STALE_INDEXES) {
    const names = await listIndexNames(queryInterface, table);
    if (!names) continue;

    if (!names.has(staleIndex)) continue;

    // 替代索引还没建出来时不能删旧的，否则会出现一段没有唯一约束的窗口
    if (!names.has(replacedBy)) {
      logger.warn(
        `[schema] 跳过删除 ${table}.${staleIndex}：替代索引 ${replacedBy} 尚不存在`
      );
      continue;
    }

    try {
      await queryInterface.removeIndex(table, staleIndex);
      dropped.push(`${table}.${staleIndex}`);
      logger.log(`[schema] 已删除过期索引 ${table}.${staleIndex}（由 ${replacedBy} 取代）`);
    } catch (error) {
      logger.error(`[schema] 删除过期索引 ${table}.${staleIndex} 失败:`, error.message);
    }
  }

  return { dropped };
}

module.exports = {
  reconcileIndexes,
  STALE_INDEXES,
};
