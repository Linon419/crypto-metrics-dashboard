/**
 * 启动时的数据与索引收敛。
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
 * 当前负责删除已被取代的旧索引，以及把历史用户名规范为小写。
 * 两项操作都具备幂等性；用户名存在大小写冲突时会在写入前停止。
 */

const { QueryTypes } = require('sequelize');
const { normalizeUsername } = require('./authSecurity');

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

function normalizeStoredUsernames(rows) {
  return rows.map(row => {
    try {
      return { id: row.id, before: row.username, normalized: normalizeUsername(row.username) };
    } catch (error) {
      throw new Error(`用户 ${row.id} 的用户名无法规范化：${error.message}`);
    }
  });
}

function findUsernameConflicts(rows) {
  const groups = new Map();
  rows.forEach(row => {
    const group = groups.get(row.normalized) || [];
    group.push({ id: row.id, username: row.before });
    groups.set(row.normalized, group);
  });
  return Array.from(groups.entries())
    .filter(([, users]) => users.length > 1)
    .map(([normalized, users]) => (
      `${normalized}: ${users.map(user => `${user.id}/${user.username}`).join(', ')}`
    ));
}

/**
 * 把旧库用户名收敛为统一的小写形式。
 *
 * 新写入由 normalizeUsername 和 User 模型 setter 保证；这里负责兼容升级前已经
 * 保存的混合大小写用户名。发生 Alice/alice 这类历史冲突时停止启动，由管理员
 * 明确决定保留哪个账号，避免静默合并两个不同身份。
 */
async function reconcileUsernames(sequelize, logger = console) {
  const rows = await sequelize.query(
    'SELECT "id", "username" FROM "Users" ORDER BY "id" ASC',
    { type: QueryTypes.SELECT },
  );
  const normalizedRows = normalizeStoredUsernames(rows);
  const conflicts = findUsernameConflicts(normalizedRows);
  if (conflicts.length > 0) {
    throw new Error(`用户名大小写冲突，请先处理重复账号：${conflicts.join('; ')}`);
  }

  const pending = normalizedRows.filter(row => row.before !== row.normalized);
  if (pending.length === 0) return { updated: [] };

  await sequelize.transaction(async transaction => {
    for (const row of pending) {
      await sequelize.query(
        'UPDATE "Users" SET "username" = :username WHERE "id" = :id',
        {
          replacements: { id: row.id, username: row.normalized },
          transaction,
          type: QueryTypes.UPDATE,
        },
      );
    }
  });

  const updated = pending.map(row => `${row.before} -> ${row.normalized}`);
  logger.log(`[schema] 已规范化 ${updated.length} 个用户名：${updated.join(', ')}`);
  return { updated };
}

module.exports = {
  reconcileIndexes,
  reconcileUsernames,
  STALE_INDEXES,
};
