#!/usr/bin/env node
/**
 * 清理历史上被错误标记的 Yahoo K 线。
 *
 * 背景：parseYahooChartResult 曾直接把请求时的 interval 写进库，
 * 而 Yahoo 没有 4h 粒度、实际返回的是 1h 数据，于是 53640 行小时柱
 * 被标成 interval='4h'，close_time 还按 4h 计算，相邻柱互相重叠 3 小时。
 * 4h 又恰好是前端图表的默认周期，25 个 Yahoo 标的打开就是这条脏序列。
 *
 * 代码侧已修复（改为按 1h 拉取后聚合成真正的 4h），但**存量脏行不会自动消失**，
 * 新旧数据混在一起反而更难辨认，因此需要删除后重新抓取。
 *
 * 该脚本默认只做统计（dry-run），不会修改任何数据：
 *
 *   node server/scripts/cleanup-mislabeled-yahoo-klines.js              # 只看统计
 *   node server/scripts/cleanup-mislabeled-yahoo-klines.js --apply      # 真正删除
 *   node server/scripts/cleanup-mislabeled-yahoo-klines.js --apply --backup=/path/to/backup.sqlite
 *
 * 删除后这些区间会在下一次访问对应图表时按新逻辑重新抓取聚合。
 * 强烈建议先备份：数据库当前约 441MB，删除不可撤销。
 */

const fs = require('fs');
const path = require('path');
const { Op, QueryTypes } = require('sequelize');

const db = require('../models');

const YAHOO_MARKET = 'yahoo_finance';
const INTERVAL_MS = { '1h': 3600000, '4h': 14400000 };

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const backupArg = argv.find(arg => arg.startsWith('--backup='));
  return { apply, backupPath: backupArg ? backupArg.slice('--backup='.length) : null };
}

async function backupDatabase(backupPath, sequelize = db.sequelize) {
  const sourcePath = sequelize.options.storage;
  const resolvedBackupPath = path.resolve(backupPath);
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error(`找不到数据库文件，无法备份：${sourcePath}`);
  }
  if (path.resolve(sourcePath) === resolvedBackupPath) {
    throw new Error('备份路径与当前数据库路径相同');
  }
  if (fs.existsSync(resolvedBackupPath)) {
    throw new Error(`备份文件已存在，请换一个路径：${resolvedBackupPath}`);
  }

  fs.mkdirSync(path.dirname(resolvedBackupPath), { recursive: true });
  const connection = await sequelize.connectionManager.getConnection();
  await new Promise((resolve, reject) => {
    let backup;
    let retryCount = 0;
    const fail = (error) => {
      if (!backup || backup.completed || backup.failed) {
        reject(error);
        return;
      }
      backup.finish(() => reject(error));
    };
    const step = () => {
      backup.step(-1, (error) => {
        if (!error && backup.completed) {
          resolve();
          return;
        }
        if (backup.failed) {
          reject(error || new Error('SQLite 备份失败'));
          return;
        }
        retryCount += 1;
        if (retryCount > 100) {
          fail(error || new Error('SQLite 备份等待数据库解锁超时'));
          return;
        }
        setTimeout(step, 50);
      });
    };

    backup = connection.backup(resolvedBackupPath, (error) => {
      if (error) {
        reject(error);
        return;
      }
      step();
    });
  });
  return resolvedBackupPath;
}

async function summarise() {
  // 1) 被标成 4h、但相邻柱间隔不是 4h 的行（即实际是小时柱）
  const spacing = await db.sequelize.query(
    `SELECT gap_hours, COUNT(*) AS n FROM (
       SELECT ROUND(
         (julianday(open_time) - julianday(
            LAG(open_time) OVER (PARTITION BY coin_id, trading_symbol ORDER BY open_time)
         )) * 24, 2) AS gap_hours
       FROM CoinKlines
       WHERE market = :market AND interval = '4h'
     ) WHERE gap_hours IS NOT NULL
     GROUP BY gap_hours ORDER BY n DESC LIMIT 8`,
    { replacements: { market: YAHOO_MARKET }, type: QueryTypes.SELECT }
  );

  // 2) open_time 没有落在周期边界上的行（同步瞬间写下的未收盘柱）
  const unaligned = await db.sequelize.query(
    `SELECT interval, COUNT(*) AS n FROM CoinKlines
     WHERE market = :market
       AND CAST(strftime('%S', open_time) AS INTEGER) != 0
     GROUP BY interval ORDER BY n DESC`,
    { replacements: { market: YAHOO_MARKET }, type: QueryTypes.SELECT }
  );

  const total4h = await db.CoinKline.count({
    where: { market: YAHOO_MARKET, interval: '4h' },
  });

  const perCoin = await db.sequelize.query(
    `SELECT coin_symbol, COUNT(*) AS n FROM CoinKlines
     WHERE market = :market AND interval = '4h'
     GROUP BY coin_symbol ORDER BY n DESC`,
    { replacements: { market: YAHOO_MARKET }, type: QueryTypes.SELECT }
  );

  return { spacing, unaligned, total4h, perCoin };
}

async function main() {
  const { apply, backupPath } = parseArgs(process.argv.slice(2));

  const { spacing, unaligned, total4h, perCoin } = await summarise();

  console.log('=== Yahoo 4h 行统计 ===');
  console.log(`interval='4h' 且 market='${YAHOO_MARKET}' 共 ${total4h} 行，覆盖 ${perCoin.length} 个标的`);
  console.log('\n相邻柱间隔分布（真正的 4h 数据应当只有 4h / 隔夜跳空）：');
  spacing.forEach(row => console.log(`  ${String(row.gap_hours).padStart(6)}h  ${row.n} 行`));

  console.log('\n未对齐到周期边界的 Yahoo 行（秒数非 0）：');
  if (unaligned.length === 0) {
    console.log('  无');
  } else {
    unaligned.forEach(row => console.log(`  interval=${row.interval}  ${row.n} 行`));
  }

  console.log('\n按标的分布：');
  perCoin.forEach(row => console.log(`  ${String(row.coin_symbol).padEnd(18)} ${row.n}`));

  const hourlySpaced = spacing
    .filter(row => Number(row.gap_hours) > 0 && Number(row.gap_hours) < 4)
    .reduce((sum, row) => sum + Number(row.n), 0);

  console.log('\n=== 结论 ===');
  console.log(`间隔小于 4h 的相邻柱共 ${hourlySpaced} 对 —— 这些就是被误标的小时柱。`);

  if (!apply) {
    console.log('\n当前为 dry-run，未修改任何数据。');
    console.log('确认无误后加 --apply 执行删除（建议同时用 --backup= 指定备份路径）。');
    await db.sequelize.close();
    return;
  }

  if (backupPath) {
    // SQLite 在线备份 API 会把 WAL 中已提交的页面一并写入目标库。
    const savedPath = await backupDatabase(backupPath);
    console.log(`\n已备份数据库到 ${savedPath}`);
  } else {
    console.log('\n警告：未指定 --backup=，将直接删除且不可撤销。');
  }

  const deleted4h = await db.CoinKline.destroy({
    where: { market: YAHOO_MARKET, interval: '4h' },
  });
  console.log(`已删除 interval='4h' 的 Yahoo 行：${deleted4h}`);

  const unalignedRows = await db.sequelize.query(
    `SELECT id FROM CoinKlines
     WHERE market = :market AND CAST(strftime('%S', open_time) AS INTEGER) != 0`,
    { replacements: { market: YAHOO_MARKET }, type: QueryTypes.SELECT }
  );
  if (unalignedRows.length > 0) {
    const deletedUnaligned = await db.CoinKline.destroy({
      where: { id: { [Op.in]: unalignedRows.map(row => row.id) } },
    });
    console.log(`已删除未对齐的 Yahoo 行：${deletedUnaligned}`);
  }

  console.log('\n完成。这些区间会在下次打开对应图表时按新逻辑重新抓取。');
  await db.sequelize.close();
}

if (require.main === module) {
  main().catch(error => {
    console.error('清理失败:', error);
    process.exit(1);
  });
}

module.exports = {
  backupDatabase,
  parseArgs,
};
