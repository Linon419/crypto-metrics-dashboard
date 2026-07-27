'use strict';

const TABLE_NAME = 'CoinKlines';
const LEGACY_INDEX_NAME = 'coin_klines_unique_coin_market_interval_open_time';
const NEXT_INDEX_NAME = 'coin_klines_unique_coin_market_symbol_interval_open_time';
const NEXT_INDEX_FIELDS = ['coin_id', 'market', 'interval', 'trading_symbol', 'open_time'];

async function hasIndex(queryInterface, name) {
  const indexes = await queryInterface.showIndex(TABLE_NAME);
  return indexes.some(index => index.name === name);
}

// 旧唯一键漏了 trading_symbol，同一 open_time 换标的会互相覆盖；这里重建索引。
// 生产库已有数据，重建前先检测冲突行，只报告不删除。
async function findConflictingRows(queryInterface, fields, indexName) {
  const columns = fields.map(field => `\`${field}\``).join(', ');
  const [rows] = await queryInterface.sequelize.query(
    `SELECT ${columns}, COUNT(*) AS duplicate_count FROM \`${TABLE_NAME}\``
    + ` GROUP BY ${columns} HAVING COUNT(*) > 1 LIMIT 20`
  );

  if (rows.length > 0) {
    console.warn(
      `[migration] ${TABLE_NAME} 存在 ${rows.length} 组重复行，无法建立唯一索引 ${indexName}，`
      + '请先人工清理后重跑：',
      JSON.stringify(rows)
    );
  }

  return rows;
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes(TABLE_NAME)) return;

    if (await hasIndex(queryInterface, NEXT_INDEX_NAME)) {
      if (await hasIndex(queryInterface, LEGACY_INDEX_NAME)) {
        await queryInterface.removeIndex(TABLE_NAME, LEGACY_INDEX_NAME);
      }
      return;
    }

    const conflicts = await findConflictingRows(queryInterface, NEXT_INDEX_FIELDS, NEXT_INDEX_NAME);
    if (conflicts.length > 0) {
      throw new Error(
        `${TABLE_NAME} 存在重复行，无法创建唯一索引 ${NEXT_INDEX_NAME}，请先清理重复数据`
      );
    }

    await queryInterface.addIndex(TABLE_NAME, NEXT_INDEX_FIELDS, {
      unique: true,
      name: NEXT_INDEX_NAME,
    });

    if (await hasIndex(queryInterface, LEGACY_INDEX_NAME)) {
      await queryInterface.removeIndex(TABLE_NAME, LEGACY_INDEX_NAME);
    }
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes(TABLE_NAME)) return;

    if (!(await hasIndex(queryInterface, LEGACY_INDEX_NAME))) {
      const conflicts = await findConflictingRows(
        queryInterface,
        ['coin_id', 'market', 'interval', 'open_time'],
        LEGACY_INDEX_NAME
      );
      if (conflicts.length > 0) {
        throw new Error(
          `${TABLE_NAME} 存在跨 trading_symbol 冲突，无法安全恢复唯一索引 ${LEGACY_INDEX_NAME}`
        );
      }
      await queryInterface.addIndex(TABLE_NAME, ['coin_id', 'market', 'interval', 'open_time'], {
        unique: true,
        name: LEGACY_INDEX_NAME,
      });
    }

    if (await hasIndex(queryInterface, NEXT_INDEX_NAME)) {
      await queryInterface.removeIndex(TABLE_NAME, NEXT_INDEX_NAME);
    }
  },
};
