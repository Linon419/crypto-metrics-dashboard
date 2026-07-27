'use strict';

/**
 * DailyMetrics 与 LiquidityOverviews 此前没有任何索引（PRAGMA index_list 为空），
 * 而 DailyMetrics 已有 13000+ 行、且是全站最热的表：
 *   - calculatePeriodQuality 对每个币种做一次一年期回看；
 *   - /api/data/latest 为页面上每个币种各查一次历史。
 * 两者叠加后每个请求都在做几十次全表扫描，随历史增长线性劣化。
 *
 * 这里只加索引，不改结构、不动数据，因此对现有库是安全的。
 */

const DAILY_METRIC_INDEXES = [
  { fields: ['coin_id', 'date'], name: 'daily_metrics_coin_id_date' },
  { fields: ['date'], name: 'daily_metrics_date' },
];

const LIQUIDITY_INDEXES = [
  { fields: ['date'], name: 'liquidity_overviews_date' },
];

async function ensureIndexes(queryInterface, tableName, indexes) {
  const tables = await queryInterface.showAllTables();
  if (!tables.includes(tableName)) return;

  let existing = [];
  try {
    existing = await queryInterface.showIndex(tableName);
  } catch (error) {
    existing = [];
  }
  const existingNames = new Set(existing.map(index => index.name));

  for (const index of indexes) {
    if (existingNames.has(index.name)) continue;
    await queryInterface.addIndex(tableName, index.fields, { name: index.name });
  }
}

async function dropIndexes(queryInterface, tableName, indexes) {
  const tables = await queryInterface.showAllTables();
  if (!tables.includes(tableName)) return;

  let existing = [];
  try {
    existing = await queryInterface.showIndex(tableName);
  } catch (error) {
    existing = [];
  }
  const existingNames = new Set(existing.map(index => index.name));

  for (const index of indexes) {
    if (!existingNames.has(index.name)) continue;
    await queryInterface.removeIndex(tableName, index.name);
  }
}

module.exports = {
  async up(queryInterface) {
    await ensureIndexes(queryInterface, 'DailyMetrics', DAILY_METRIC_INDEXES);
    await ensureIndexes(queryInterface, 'LiquidityOverviews', LIQUIDITY_INDEXES);
  },

  async down(queryInterface) {
    await dropIndexes(queryInterface, 'DailyMetrics', DAILY_METRIC_INDEXES);
    await dropIndexes(queryInterface, 'LiquidityOverviews', LIQUIDITY_INDEXES);
  },
};
