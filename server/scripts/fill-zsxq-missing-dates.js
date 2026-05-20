const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const projectRoot = path.resolve(__dirname, '../..');
const dbPath = path.join(projectRoot, 'database.sqlite');
const sourcePath = path.join(projectRoot, 'zsxq-notion-date-map-final-1779198512807.json');
const cacheDir = path.join(projectRoot, 'server/output/zsxq-notion-page-cache');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const fetchDelayMs = args.has('--fast') ? 0 : 1200;

const SYMBOL_MAP = [
  [/期权波动率|vega/i, 'VEGA'],
  [/币市流动性|流动性/i, 'LIQUIDITY'],
  [/美股纳指|美股\s*OTC|纳指/i, 'NASDAQ'],
  [/国内人工智能/i, 'CN_AI_ETF'],
  [/国内机器人/i, 'CN_ROBOT'],
  [/A股指数/i, 'CN_INDEX'],
  [/国内股/i, 'A_SHARES'],
  [/黄金|Xau/i, 'GOLD'],
  [/白银|Xag/i, 'SILVER'],
  [/地产/i, 'ESTATE'],
  [/布伦特|原油/i, 'OIL'],
  [/fartcoin/i, 'FARTCOIN'],
  [/trump/i, 'TRUMP'],
  [/virtual/i, 'VIRTUAL'],
  [/kaito/i, 'KAITO'],
  [/aave/i, 'AAVE'],
  [/avax/i, 'AVAX'],
  [/ondo|ond0/i, 'ONDO'],
  [/aapl/i, 'AAPL'],
  [/goog/i, 'GOOG'],
  [/nvda/i, 'NVDA'],
  [/tsla/i, 'TSLA'],
  [/coin/i, 'COIN'],
  [/circle/i, 'CIRCLE'],
  [/hood/i, 'HOOD'],
  [/msft/i, 'MSFT'],
  [/amzn/i, 'AMZN'],
  [/orcl/i, 'ORCL'],
  [/sndk/i, 'SNDK'],
  [/\bmu\b/i, 'MU'],
];

const KNOWN_SYMBOLS = new Set([
  'BTC', 'ETH', 'BNB', 'SOL', 'DOGE', 'NASDAQ', 'LIQUIDITY', 'VEGA',
  'LTC', 'LDO', 'CRV', 'LINK', 'EOS', 'ADA', 'UNI', 'ONDO',
  'FARTCOIN', 'BGB', 'AAVE', 'AVAX', 'PEPE', 'SUI', 'SEI', 'WLD',
  'XRP', 'OM', 'TRUMP', 'KAITO', 'HYPE', 'VIRTUAL', 'PUMP', 'ZEC',
  'GOLD', 'SILVER', 'OIL', 'ESTATE', 'CN_AI_ETF', 'CN_ROBOT',
  'CN_INDEX', 'A_SHARES', 'COIN', 'CIRCLE', 'TSLA', 'NVDA', 'AAPL',
  'GOOG', 'HOOD', 'MSFT', 'AMZN', 'SNDK', 'MU', 'ORCL', 'CET',
  'RAY', 'AIOZ',
]);

function openDb() {
  return new sqlite3.Database(dbPath);
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows)));
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function closeDb(db) {
  return new Promise((resolve, reject) => db.close(error => (error ? reject(error) : resolve())));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pad(value, width = 2) {
  return String(value).padStart(width, '0');
}

function toDbTimestamp(input) {
  const date = new Date(input);
  return [
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${pad(date.getUTCMilliseconds(), 3)}`,
    '+00:00',
  ].join(' ');
}

function cleanLine(line) {
  return String(line || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[　]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function plainTitle(block) {
  const title = block?.properties?.title || block?.crdt_data?.title;
  if (!Array.isArray(title)) return '';
  return title.map(part => (Array.isArray(part) ? part[0] : String(part))).join('');
}

function explodeLines(values) {
  return values
    .flatMap(value => String(value || '').split(/\r?\n/))
    .map(cleanLine)
    .filter(Boolean);
}

async function fetchNotionLines(pageId) {
  const cachePath = path.join(cacheDir, `${pageId}.json`);
  if (fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8')).lines;
  }

  let cursor = { stack: [] };
  let chunkNumber = 0;
  const blocks = new Map();
  let rootBlock = null;

  while (chunkNumber < 30) {
    let response;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      response = await fetch('https://www.notion.so/api/v3/loadPageChunk', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Mozilla/5.0',
        },
        body: JSON.stringify({
          pageId,
          limit: 100,
          cursor,
          chunkNumber,
          verticalColumns: false,
        }),
      });

      if (response.status !== 429) break;
      await sleep(8000 * (attempt + 1));
    }

    if (!response.ok) {
      throw new Error(`Notion fetch failed for ${pageId}: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    for (const entry of Object.values(payload.recordMap?.block || {})) {
      const block = entry?.value?.value;
      if (!block?.id) continue;
      blocks.set(block.id, block);
      if (block.id === pageId) rootBlock = block;
    }

    cursor = payload.cursor;
    chunkNumber += 1;
    if (!cursor?.stack?.length) break;
    if (fetchDelayMs) await sleep(fetchDelayMs);
  }

  const collected = [];
  const seen = new Set();
  const walk = id => {
    if (seen.has(id)) return;
    seen.add(id);
    const block = blocks.get(id);
    if (!block) return;
    const text = plainTitle(block);
    if (text) collected.push(text);
    for (const childId of block.content || []) walk(childId);
  };

  if (rootBlock) {
    for (const childId of rootBlock.content || []) walk(childId);
  } else {
    for (const block of blocks.values()) {
      const text = plainTitle(block);
      if (text) collected.push(text);
    }
  }

  const lines = explodeLines(collected);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify({ pageId, lines }, null, 2));
  return lines;
}

function normalizeSymbol(raw) {
  const text = cleanLine(raw)
    .replace(/^[&$#]+/, '')
    .replace(/[：:]+$/, '')
    .trim();

  if (!text) return null;
  for (const [pattern, symbol] of SYMBOL_MAP) {
    if (pattern.test(text)) return symbol;
  }

  const token = text.match(/^\$?([A-Za-z][A-Za-z0-9]*)\b/);
  if (!token) return null;
  const symbol = token[1].toUpperCase().replace(/0/g, 'O');
  if (KNOWN_SYMBOLS.has(symbol)) return symbol;
  if (/^[A-Z][A-Z0-9]{1,11}$/.test(symbol)) return symbol;
  return null;
}

function hasMetricLine(line) {
  return /场外指(?:数)?/.test(line);
}

function parseOtc(line) {
  const match = line.match(/场外指(?:数)?\s*去?\s*(-?\d+)/);
  return match ? Number(match[1]) : null;
}

function windowForMetric(lines, index) {
  const window = [lines[index]];
  for (let offset = 1; offset <= 5 && index + offset < lines.length; offset += 1) {
    const next = lines[index + offset];
    if (hasMetricLine(next)) break;
    if (/^[※♤$#∆]+$/.test(next)) break;
    window.push(next);
  }
  return window;
}

function parseExplosion(windowLines) {
  const text = windowLines.join(' ');
  const match = text.match(/爆破(?:指数|去)?\s*(-?\d+(?:\.\d+)?)/) || text.match(/爆破\s*(-?\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function parseEntryExit(windowLines) {
  const text = windowLines.join(' ');
  const match = text.match(/(进场|退场)\s*期?\s*第?\s*(\d+)\s*(天|月)?/);
  if (!match) return { type: null, day: null };
  return {
    type: match[1] === '进场' ? 'entry' : 'exit',
    day: match[3] === '月' ? 0 : Number(match[2]),
  };
}

function parseSchelling(windowLines, symbol) {
  const text = windowLines.join(' ');
  const explicit = text.match(/谢林点\s*[:：]?\s*([0-9]+(?:\.\d+)?)/);
  if (explicit) return Number(explicit[1]);

  if (!['BTC', 'ETH', 'BNB', 'SOL', 'DOGE'].includes(symbol)) return null;
  for (const line of windowLines.slice(1)) {
    if (/^[0-9]+(?:\.\d+)?$/.test(line)) return Number(line);
  }
  return null;
}

function parseMetrics(lines) {
  const metrics = [];
  let previousSymbol = null;
  const seen = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!hasMetricLine(line)) {
      const symbol = normalizeSymbol(line);
      if (symbol) previousSymbol = symbol;
      continue;
    }

    if (/场内资金/.test(line)) continue;

    const otcIndex = parseOtc(line);
    if (otcIndex === null) continue;

    const prefix = line.split(/场外指(?:数)?/)[0];
    const symbol = normalizeSymbol(prefix) || previousSymbol;
    if (!symbol || seen.has(symbol)) continue;

    const windowLines = windowForMetric(lines, index);
    const entryExit = parseEntryExit(windowLines);
    const metric = {
      symbol,
      otcIndex,
      explosionIndex: parseExplosion(windowLines),
      schellingPoint: parseSchelling(windowLines, symbol),
      entryExitType: entryExit.type,
      entryExitDay: entryExit.day,
      nearThreshold: windowLines.some(value => value.includes('逼近')) ? 1 : 0,
    };

    metrics.push(metric);
    seen.add(symbol);
    previousSymbol = symbol;
  }

  return metrics;
}

function parseFundChange(line, label) {
  const match = line.match(new RegExp(`${label}\\s*场内资金\\s*([+-]?\\d+(?:\\.\\d+)?)亿`));
  return match ? Number(match[1]) : null;
}

function parseLiquidity(lines) {
  const start = lines.findIndex(line => line.includes('流动性概况'));
  if (start === -1) return null;

  const section = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.includes('热点') || line.includes('今日潜力观察') || line.includes('问答')) break;
    if (section.length > 5 && line === '∆') break;
    section.push(line);
  }

  const btcLine = section.find(line => /^BTC\s*场内资金/.test(line));
  const ethLine = section.find(line => /^ETH\s*场内资金/.test(line));
  const solLine = section.find(line => /^SOL\s*场内资金/.test(line));
  const totalLine = section.find(line => line.includes('币市场内流动性进入净资金'));

  if (!btcLine && !ethLine && !solLine && !totalLine) return null;

  const totalMatch = totalLine?.match(/净资金\s*([+-]?\d+(?:\.\d+)?)亿/);
  const comments = [];
  if (totalLine) {
    const totalIndex = section.indexOf(totalLine);
    for (let offset = totalIndex; offset < section.length; offset += 1) {
      const line = section[offset];
      if (line.includes('每日提醒') || /^[∆$]+$/.test(line)) break;
      if (!/^日内短线情况$/.test(line)) comments.push(line);
    }
  }

  const reminderStart = lines.findIndex(line => line.includes('每日提醒'));
  const reminder = [];
  if (reminderStart !== -1) {
    for (let index = reminderStart; index < lines.length; index += 1) {
      const line = lines[index];
      if (index > reminderStart && (line === '∆' || line.includes('问答') || line.includes('今日潜力观察'))) break;
      if (!/^[∆$]+$/.test(line)) reminder.push(line);
    }
  }

  return {
    btcFundChange: btcLine ? parseFundChange(btcLine, 'BTC') : null,
    ethFundChange: ethLine ? parseFundChange(ethLine, 'ETH') : null,
    solFundChange: solLine ? parseFundChange(solLine, 'SOL') : null,
    totalMarketFundChange: totalMatch ? Number(totalMatch[1]) : null,
    comments: comments.join(' '),
    dailyReminder: reminder.join(' '),
  };
}

async function getCoinId(db, symbol, now) {
  const existing = await get(db, 'SELECT id FROM Coins WHERE symbol = ?', [symbol]);
  if (existing) return existing.id;
  if (dryRun) return -1;
  const result = await run(
    db,
    'INSERT INTO Coins (symbol, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)',
    [symbol, symbol, now, now],
  );
  return result.id;
}

async function upsertMetric(db, record, metric, now) {
  const coinId = await getCoinId(db, metric.symbol, now);
  if (dryRun) return 'dry-run';

  const existing = await get(
    db,
    'SELECT id FROM DailyMetrics WHERE coin_id = ? AND date = ? AND timestamp = ?',
    [coinId, record.dbDate, record.timestamp],
  );

  const params = [
    metric.otcIndex,
    metric.explosionIndex,
    metric.schellingPoint,
    metric.entryExitType,
    metric.entryExitDay,
    metric.nearThreshold,
    null,
    record.timestamp,
    'minute',
    now,
  ];

  if (existing) {
    await run(
      db,
      `UPDATE DailyMetrics
       SET otc_index = ?, explosion_index = ?, schelling_point = ?, entry_exit_type = ?,
           entry_exit_day = ?, near_threshold = ?, momentum_indicators = ?, timestamp = ?,
           time_precision = ?, updatedAt = ?
       WHERE id = ?`,
      [...params, existing.id],
    );
    return 'updated';
  }

  await run(
    db,
    `INSERT INTO DailyMetrics
      (coin_id, date, otc_index, explosion_index, schelling_point, entry_exit_type,
       entry_exit_day, near_threshold, momentum_indicators, timestamp, time_precision, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      coinId,
      record.dbDate,
      metric.otcIndex,
      metric.explosionIndex,
      metric.schellingPoint,
      metric.entryExitType,
      metric.entryExitDay,
      metric.nearThreshold,
      null,
      record.timestamp,
      'minute',
      now,
      now,
    ],
  );
  return 'inserted';
}

async function insertLiquidity(db, record, liquidity, now) {
  if (!liquidity || dryRun) return dryRun && liquidity ? 'dry-run' : 'none';

  const existing = await get(
    db,
    'SELECT id FROM LiquidityOverviews WHERE date = ? AND timestamp = ?',
    [record.dbDate, record.timestamp],
  );
  if (existing) return 'exists';

  await run(
    db,
    `INSERT INTO LiquidityOverviews
      (date, btc_fund_change, eth_fund_change, sol_fund_change, total_market_fund_change,
       comments, daily_reminder, timestamp, time_precision, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.dbDate,
      liquidity.btcFundChange,
      liquidity.ethFundChange,
      liquidity.solFundChange,
      liquidity.totalMarketFundChange,
      liquidity.comments,
      liquidity.dailyReminder,
      record.timestamp,
      'minute',
      now,
      now,
    ],
  );
  return 'inserted';
}

async function main() {
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const db = openDb();
  const report = {
    dryRun,
    sourcePath,
    missingRecords: [],
    parsedRecords: [],
    skippedNoDate: source.records.filter(record => !record.dbDate).length,
    insertedMetrics: 0,
    updatedMetrics: 0,
    insertedLiquidity: 0,
    existingLiquidity: 0,
    warnings: [],
  };

  try {
    const dbRows = await all(db, 'SELECT date, timestamp FROM DailyMetrics GROUP BY date, timestamp');
    const existingKeys = new Set(dbRows.map(row => `${row.date}|${row.timestamp}`));
    const missingRecords = source.records
      .filter(record => record.dbDate)
      .map(record => ({ ...record, timestamp: toDbTimestamp(record.createTime) }))
      .filter(record => !existingKeys.has(`${record.dbDate}|${record.timestamp}`));

    report.missingRecords = missingRecords.map(record => ({
      date: record.dbDate,
      timestamp: record.timestamp,
      pageId: record.pageId,
      topicId: record.topicId,
    }));

    if (!dryRun) await run(db, 'BEGIN TRANSACTION');

    const now = toDbTimestamp(new Date().toISOString());
    for (const record of missingRecords) {
      let lines;
      try {
        lines = await fetchNotionLines(record.pageId);
      } catch (error) {
        report.warnings.push({ date: record.dbDate, pageId: record.pageId, error: error.message });
        lines = explodeLines(record.firstTexts || []);
      }

      if (lines.length < 10) {
        report.warnings.push({
          date: record.dbDate,
          pageId: record.pageId,
          error: `Skipped because only ${lines.length} text lines were available`,
        });
        continue;
      }

      const metrics = parseMetrics(lines);
      const liquidity = parseLiquidity(lines);

      if (!metrics.length) {
        report.warnings.push({ date: record.dbDate, pageId: record.pageId, error: 'No DailyMetrics parsed' });
      }

      for (const metric of metrics) {
        const status = await upsertMetric(db, record, metric, now);
        if (status === 'inserted') report.insertedMetrics += 1;
        if (status === 'updated') report.updatedMetrics += 1;
      }

      const liquidityStatus = await insertLiquidity(db, record, liquidity, now);
      if (liquidityStatus === 'inserted') report.insertedLiquidity += 1;
      if (liquidityStatus === 'exists') report.existingLiquidity += 1;

      report.parsedRecords.push({
        date: record.dbDate,
        timestamp: record.timestamp,
        pageId: record.pageId,
        lines: lines.length,
        metrics: metrics.map(metric => metric.symbol),
        liquidity: Boolean(liquidity),
      });

      if (fetchDelayMs) await sleep(fetchDelayMs);
    }

    if (!dryRun) await run(db, 'COMMIT');

    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (!dryRun) {
      try {
        await run(db, 'ROLLBACK');
      } catch (rollbackError) {
        console.error(rollbackError);
      }
    }
    throw error;
  } finally {
    await closeDb(db);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
