const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Sequelize, QueryTypes } = require('sequelize');

const { backupDatabase, parseArgs } = require('../scripts/cleanup-mislabeled-yahoo-klines');

async function run() {
  assert.deepStrictEqual(
    parseArgs(['--apply', '--backup=/tmp/archive=name.sqlite']),
    { apply: true, backupPath: '/tmp/archive=name.sqlite' }
  );

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yahoo-cleanup-backup-'));
  const sourcePath = path.join(tempDir, 'source.sqlite');
  const backupPath = path.join(tempDir, 'backup.sqlite');
  const source = new Sequelize({ dialect: 'sqlite', storage: sourcePath, logging: false });
  let backup = null;

  try {
    await source.query('PRAGMA journal_mode=WAL');
    await source.query('CREATE TABLE sample (value TEXT NOT NULL)');
    await source.query("INSERT INTO sample (value) VALUES ('committed-in-wal')");

    const savedPath = await backupDatabase(backupPath, source);
    assert.strictEqual(savedPath, backupPath);

    backup = new Sequelize({ dialect: 'sqlite', storage: backupPath, logging: false });
    const rows = await backup.query('SELECT value FROM sample', { type: QueryTypes.SELECT });
    assert.deepStrictEqual(rows, [{ value: 'committed-in-wal' }]);

    await assert.rejects(() => backupDatabase(backupPath, source), /备份文件已存在/);
    await assert.rejects(() => backupDatabase(sourcePath, source), /路径相同/);
  } finally {
    await backup?.close();
    await source.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('yahooKlineCleanupBackup.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
