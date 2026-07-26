/**
 * SQLite 连接级 PRAGMA 配置。
 *
 * 默认的 delete 回滚日志模式下读写互斥：K 线 WebSocket 持续写入时，
 * 图表查询会被阻塞，反之亦然。WAL 模式下读写可并发
 * （https://www.sqlite.org/wal.html：readers do not block writers and
 * a writer does not block readers）。
 *
 * 两条 PRAGMA 的作用域不同：
 * - journal_mode 是数据库文件级且持久化，设置一次即长期生效
 * - busy_timeout 是连接级，每条新连接都要重设，否则并发写会立刻抛 SQLITE_BUSY
 *
 * 注意：WAL 会在库文件旁生成 -wal 与 -shm 文件，冷备份需一并复制或先 checkpoint。
 */

const DEFAULT_BUSY_TIMEOUT_MS = 5000;

function resolveBusyTimeoutMs(env = process.env) {
  const raw = Number(env.SQLITE_BUSY_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  return DEFAULT_BUSY_TIMEOUT_MS;
}

/**
 * 内存库不需要也不支持 WAL，跳过以免测试环境报错。
 */
function shouldEnableWal(storage) {
  if (!storage) return false;
  return storage !== ':memory:';
}

function buildPragmaStatements({ storage, env = process.env } = {}) {
  const statements = [`PRAGMA busy_timeout = ${resolveBusyTimeoutMs(env)};`];
  if (shouldEnableWal(storage)) {
    statements.push('PRAGMA journal_mode = WAL;');
  }
  return statements;
}

function runSqliteStatement(connection, statement) {
  return new Promise((resolve, reject) => {
    if (typeof connection?.run !== 'function') {
      resolve(null);
      return;
    }
    connection.run(statement, error => (error ? reject(error) : resolve(null)));
  });
}

const APPLIED_FLAG = Symbol('sqlitePragmasApplied');

async function applyPragmas(connection, statements, logger) {
  if (!connection || connection[APPLIED_FLAG]) return connection;
  for (const statement of statements) {
    try {
      await runSqliteStatement(connection, statement);
    } catch (error) {
      // PRAGMA 失败不应阻断启动，退化成原有行为即可
      logger.warn(`[Sequelize] 应用 ${statement} 失败：${error.message}`);
    }
  }
  Object.defineProperty(connection, APPLIED_FLAG, { value: true, enumerable: false });
  return connection;
}

/**
 * 包装 connectionManager.getConnection。
 *
 * 不能用 afterConnect 钩子：Sequelize v6 的 SQLite 方言覆写了 getConnection
 * （lib/dialects/sqlite/connection-manager.js），绕过了抽象连接管理器里
 * runHooks('afterConnect') 那一步，该钩子在 SQLite 上永远不会触发。
 *
 * 包装这一层才能覆盖事务连接：SQLite 方言按 uuid 分配连接，
 * 事务会拿到独立连接，而 busy_timeout 恰恰是连接级设置。
 *
 * @returns {boolean} 是否成功安装
 */
function installSqlitePragmas(sequelize, { storage, env = process.env, logger = console } = {}) {
  const manager = sequelize?.connectionManager;
  if (!manager || typeof manager.getConnection !== 'function') {
    logger.warn('[Sequelize] 未找到 connectionManager.getConnection，跳过 SQLite PRAGMA 配置');
    return false;
  }

  const statements = buildPragmaStatements({ storage, env });
  if (statements.length === 0) return false;

  const original = manager.getConnection.bind(manager);
  manager.getConnection = async function getConnectionWithPragmas(options) {
    const connection = await original(options);
    return applyPragmas(connection, statements, logger);
  };

  return true;
}

module.exports = {
  APPLIED_FLAG,
  DEFAULT_BUSY_TIMEOUT_MS,
  buildPragmaStatements,
  installSqlitePragmas,
  resolveBusyTimeoutMs,
  shouldEnableWal,
};
