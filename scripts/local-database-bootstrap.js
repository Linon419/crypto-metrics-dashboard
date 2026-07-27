const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { promisify } = require('util');
const zlib = require('zlib');

const gunzip = promisify(zlib.gunzip);
const DEFAULT_DATABASE_ASSET = 'crypto-metrics-demo.sqlite.gz';
const DEFAULT_DATABASE_URL = [
  'https://github.com/Linon419/crypto-metrics-dashboard',
  'releases/latest/download',
  DEFAULT_DATABASE_ASSET,
].join('/');
const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function parseSha256(content) {
  const match = String(content || '').match(/\b([a-f0-9]{64})\b/i);
  if (!match) throw new Error('Database checksum file is invalid');
  return match[1].toLowerCase();
}

function assertSqliteBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 100) {
    throw new Error('Downloaded database is too small');
  }
  if (!buffer.subarray(0, 16).equals(Buffer.from('SQLite format 3\0', 'binary'))) {
    throw new Error('Downloaded database is not a SQLite file');
  }
}

function fetchUrlBuffer(url, { redirectsRemaining = MAX_REDIRECTS } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      reject(new Error(`Unsupported database download protocol: ${parsed.protocol}`));
      return;
    }
    const transport = parsed.protocol === 'http:' ? http : https;
    const request = transport.get(parsed, {
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': 'crypto-metrics-dashboard-local-launcher',
      },
    }, response => {
      const status = Number(response.statusCode || 0);
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (redirectsRemaining <= 0) {
          reject(new Error('Database download exceeded the redirect limit'));
          return;
        }
        const redirectedUrl = new URL(location, parsed).toString();
        fetchUrlBuffer(redirectedUrl, { redirectsRemaining: redirectsRemaining - 1 })
          .then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`Database download failed with HTTP ${status}`));
        return;
      }
      const declaredLength = Number(response.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) {
        response.resume();
        reject(new Error('Database download exceeded the size limit'));
        return;
      }

      const chunks = [];
      let total = 0;
      response.on('data', chunk => {
        total += chunk.length;
        if (total > MAX_DOWNLOAD_BYTES) {
          response.destroy(new Error('Database download exceeded the size limit'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.setTimeout(120000, () => {
      request.destroy(new Error('Database download timed out'));
    });
    request.on('error', reject);
  });
}

function validateSqliteDatabase(databasePath) {
  const sqlite3 = require('sqlite3');
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY, error => {
      if (error) {
        reject(error);
        return;
      }
      database.get('PRAGMA integrity_check', (queryError, row) => {
        const integrityError = queryError || (row?.integrity_check === 'ok'
          ? null
          : new Error(`Downloaded database integrity check failed: ${row?.integrity_check}`));
        database.close(closeError => {
          if (integrityError || closeError) {
            reject(integrityError || closeError);
            return;
          }
          resolve();
        });
      });
    });
  });
}

function resolveDatabasePath(root, env) {
  const configured = env.DB_STORAGE;
  if (!configured) return path.join(root, 'database.sqlite');
  return path.isAbsolute(configured) ? configured : path.resolve(root, configured);
}

async function ensureLocalDatabase({
  root = path.join(__dirname, '..'),
  env = process.env,
  databaseUrl = env.LOCAL_DATABASE_URL || DEFAULT_DATABASE_URL,
  checksumUrl = env.LOCAL_DATABASE_SHA256_URL || `${databaseUrl}.sha256`,
  fetchBuffer = fetchUrlBuffer,
  validateDatabase = validateSqliteDatabase,
  logMessage = () => {},
} = {}) {
  const databasePath = resolveDatabasePath(root, env);
  if (fs.existsSync(databasePath)) {
    return { status: 'existing', databasePath };
  }
  if (env.LOCAL_DATABASE_DOWNLOAD_DISABLED === '1') {
    logMessage('Starter database download is disabled; a new empty database will be created.');
    return { status: 'disabled', databasePath };
  }

  logMessage('Downloading the starter market database.');
  const archive = await fetchBuffer(databaseUrl);
  const checksumFile = await fetchBuffer(checksumUrl);
  const expectedChecksum = parseSha256(checksumFile.toString('utf8'));
  const actualChecksum = sha256Buffer(archive);
  if (actualChecksum !== expectedChecksum) {
    throw new Error('Starter database checksum verification failed');
  }

  const database = await gunzip(archive);
  assertSqliteBuffer(database);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const temporaryPath = `${databasePath}.download-${process.pid}-${Date.now()}`;

  try {
    fs.writeFileSync(temporaryPath, database, { flag: 'wx', mode: 0o600 });
    await validateDatabase(temporaryPath);
    if (fs.existsSync(databasePath)) {
      return { status: 'existing', databasePath };
    }
    fs.renameSync(temporaryPath, databasePath);
    logMessage('Starter market database downloaded and verified.');
    return { status: 'downloaded', databasePath };
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

module.exports = {
  DEFAULT_DATABASE_ASSET,
  DEFAULT_DATABASE_URL,
  assertSqliteBuffer,
  ensureLocalDatabase,
  fetchUrlBuffer,
  parseSha256,
  resolveDatabasePath,
  sha256Buffer,
  validateSqliteDatabase,
};
