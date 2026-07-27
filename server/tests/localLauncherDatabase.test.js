const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const {
  ensureLocalDatabase,
  parseSha256,
  sha256Buffer,
} = require('../../scripts/local-database-bootstrap');

function createSqliteFixture() {
  return Buffer.concat([
    Buffer.from('SQLite format 3\0', 'binary'),
    Buffer.alloc(256, 0),
  ]);
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-launcher-database-'));
  const databasePath = path.join(root, 'database.sqlite');
  const database = createSqliteFixture();
  const archive = zlib.gzipSync(database);
  const checksum = crypto.createHash('sha256').update(archive).digest('hex');

  try {
    assert.strictEqual(parseSha256(`${checksum}  crypto-metrics-demo.sqlite.gz\n`), checksum);
    assert.strictEqual(sha256Buffer(archive), checksum);

    fs.writeFileSync(databasePath, database);
    let existingDownloadCalls = 0;
    const existingResult = await ensureLocalDatabase({
      root,
      env: {},
      fetchBuffer: async () => {
        existingDownloadCalls += 1;
        return archive;
      },
      validateDatabase: async () => {},
      logMessage: () => {},
    });
    assert.strictEqual(existingResult.status, 'existing');
    assert.strictEqual(existingDownloadCalls, 0);

    fs.rmSync(databasePath);
    let disabledDownloadCalls = 0;
    const disabledResult = await ensureLocalDatabase({
      root,
      env: { LOCAL_DATABASE_DOWNLOAD_DISABLED: '1' },
      fetchBuffer: async () => {
        disabledDownloadCalls += 1;
        return archive;
      },
      validateDatabase: async () => {},
      logMessage: () => {},
    });
    assert.strictEqual(disabledResult.status, 'disabled');
    assert.strictEqual(disabledDownloadCalls, 0);
    assert.strictEqual(fs.existsSync(databasePath), false);

    const fetchedUrls = [];
    const downloadedResult = await ensureLocalDatabase({
      root,
      env: {},
      databaseUrl: 'https://example.test/crypto-metrics-demo.sqlite.gz',
      checksumUrl: 'https://example.test/crypto-metrics-demo.sqlite.gz.sha256',
      fetchBuffer: async (url) => {
        fetchedUrls.push(url);
        return url.endsWith('.sha256') ? Buffer.from(`${checksum}\n`) : archive;
      },
      validateDatabase: async target => {
        assert.deepStrictEqual(fs.readFileSync(target), database);
      },
      logMessage: () => {},
    });
    assert.strictEqual(downloadedResult.status, 'downloaded');
    assert.deepStrictEqual(fetchedUrls, [
      'https://example.test/crypto-metrics-demo.sqlite.gz',
      'https://example.test/crypto-metrics-demo.sqlite.gz.sha256',
    ]);
    assert.deepStrictEqual(fs.readFileSync(databasePath), database);

    fs.rmSync(databasePath);
    const assetServer = await new Promise(resolve => {
      const server = http.createServer((request, response) => {
        if (request.url === '/redirect') {
          response.writeHead(302, { Location: '/archive' });
          response.end();
          return;
        }
        if (request.url === '/archive') {
          response.writeHead(200, { 'Content-Type': 'application/gzip' });
          response.end(archive);
          return;
        }
        if (request.url === '/archive.sha256') {
          response.writeHead(200, { 'Content-Type': 'text/plain' });
          response.end(`${checksum}\n`);
          return;
        }
        response.writeHead(404);
        response.end();
      });
      server.listen(0, '127.0.0.1', () => resolve(server));
    });
    try {
      const port = assetServer.address().port;
      const networkResult = await ensureLocalDatabase({
        root,
        env: {},
        databaseUrl: `http://127.0.0.1:${port}/redirect`,
        checksumUrl: `http://127.0.0.1:${port}/archive.sha256`,
        validateDatabase: async () => {},
        logMessage: () => {},
      });
      assert.strictEqual(networkResult.status, 'downloaded');
      assert.deepStrictEqual(fs.readFileSync(databasePath), database);
    } finally {
      await new Promise((resolve, reject) => {
        assetServer.close(error => (error ? reject(error) : resolve()));
      });
    }

    fs.rmSync(databasePath);
    await assert.rejects(
      ensureLocalDatabase({
        root,
        env: {},
        fetchBuffer: async url => (url.endsWith('.sha256')
          ? Buffer.from(`${'0'.repeat(64)}\n`)
          : archive),
        validateDatabase: async () => {},
        logMessage: () => {},
      }),
      /checksum/i,
    );
    assert.strictEqual(fs.existsSync(databasePath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('localLauncherDatabase.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
