const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DEFAULT_BUSY_TIMEOUT_MS,
  buildPragmaStatements,
  installSqlitePragmas,
  resolveBusyTimeoutMs,
  shouldEnableWal,
} = require('../utils/sqlitePragmas');

function createScratchStorage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-pragmas-'));
  return { dir, storage: path.join(dir, 'pragmas.sqlite') };
}

async function run() {
  // busy_timeout 取值
  assert.strictEqual(resolveBusyTimeoutMs({}), DEFAULT_BUSY_TIMEOUT_MS);
  assert.strictEqual(resolveBusyTimeoutMs({ SQLITE_BUSY_TIMEOUT_MS: '12000' }), 12000);
  assert.strictEqual(resolveBusyTimeoutMs({ SQLITE_BUSY_TIMEOUT_MS: 'abc' }), DEFAULT_BUSY_TIMEOUT_MS);
  assert.strictEqual(resolveBusyTimeoutMs({ SQLITE_BUSY_TIMEOUT_MS: '-1' }), DEFAULT_BUSY_TIMEOUT_MS);

  // 内存库不启用 WAL
  assert.strictEqual(shouldEnableWal(':memory:'), false);
  assert.strictEqual(shouldEnableWal(''), false);
  assert.strictEqual(shouldEnableWal('./database.sqlite'), true);

  const memoryStatements = buildPragmaStatements({ storage: ':memory:', env: {} });
  assert.ok(memoryStatements.every(statement => !statement.includes('journal_mode')));
  assert.ok(memoryStatements.some(statement => statement.includes('busy_timeout')));

  const fileStatements = buildPragmaStatements({ storage: './x.sqlite', env: {} });
  assert.ok(fileStatements.some(statement => statement.includes('journal_mode = WAL')));

  // 缺少 connectionManager 时安全跳过，不应抛错
  const warnings = [];
  const logger = { warn: message => warnings.push(message), error: () => {} };
  assert.strictEqual(installSqlitePragmas(null, { storage: './x.sqlite', logger }), false);
  assert.strictEqual(installSqlitePragmas({}, { storage: './x.sqlite', logger }), false);
  assert.ok(warnings.length >= 1);

  // 端到端：真实实例上验证 WAL 与 busy_timeout，且事务连接同样生效。
  // Sequelize v6 的 SQLite 方言覆写了 getConnection、绕过 afterConnect 钩子，
  // 这里正是要锁住「包装 getConnection」这条实现路径不被改回钩子写法。
  const { Sequelize } = require('sequelize');
  const scratch = createScratchStorage();
  const sequelize = new Sequelize(null, null, null, {
    dialect: 'sqlite',
    storage: scratch.storage,
    logging: false,
  });

  try {
    assert.strictEqual(
      installSqlitePragmas(sequelize, { storage: scratch.storage, env: { SQLITE_BUSY_TIMEOUT_MS: '7000' } }),
      true
    );

    await sequelize.query('CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY)');

    const [journalMode] = await sequelize.query('PRAGMA journal_mode');
    assert.strictEqual(journalMode[0].journal_mode, 'wal', 'WAL 未生效');

    const [busyTimeout] = await sequelize.query('PRAGMA busy_timeout');
    assert.strictEqual(busyTimeout[0].timeout, 7000, 'busy_timeout 未生效');

    // 事务会拿到独立连接，busy_timeout 是连接级设置，必须同样生效
    const transaction = await sequelize.transaction();
    try {
      const [txTimeout] = await sequelize.query('PRAGMA busy_timeout', { transaction });
      assert.strictEqual(txTimeout[0].timeout, 7000, '事务连接的 busy_timeout 未生效');
    } finally {
      await transaction.rollback();
    }
  } finally {
    await sequelize.close();
    fs.rmSync(scratch.dir, { recursive: true, force: true });
  }

  console.log('sqlitePragmas.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
