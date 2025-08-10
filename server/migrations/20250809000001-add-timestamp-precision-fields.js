'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 为 DailyMetrics 表添加时间戳和精度字段
    await queryInterface.addColumn('DailyMetrics', 'timestamp', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'Precise timestamp for the metric data'
    });
    
    await queryInterface.addColumn('DailyMetrics', 'time_precision', {
      type: Sequelize.ENUM('day', 'hour', 'minute'),
      defaultValue: 'day',
      allowNull: false,
      comment: 'Precision level of the time data'
    });

    // 为 TrendingCoins 表添加时间戳和精度字段
    await queryInterface.addColumn('TrendingCoins', 'timestamp', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'Precise timestamp for the trending coin data'
    });
    
    await queryInterface.addColumn('TrendingCoins', 'time_precision', {
      type: Sequelize.ENUM('day', 'hour', 'minute'),
      defaultValue: 'day',
      allowNull: false,
      comment: 'Precision level of the time data'
    });

    // 为 LiquidityOverviews 表添加时间戳和精度字段
    await queryInterface.addColumn('LiquidityOverviews', 'timestamp', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'Precise timestamp for the liquidity data'
    });
    
    await queryInterface.addColumn('LiquidityOverviews', 'time_precision', {
      type: Sequelize.ENUM('day', 'hour', 'minute'),
      defaultValue: 'day',
      allowNull: false,
      comment: 'Precision level of the time data'
    });

    // 为现有数据设置默认的时间精度
    await queryInterface.sequelize.query(`
      UPDATE "DailyMetrics" SET time_precision = 'day' WHERE time_precision IS NULL;
    `);
    
    await queryInterface.sequelize.query(`
      UPDATE "TrendingCoins" SET time_precision = 'day' WHERE time_precision IS NULL;
    `);
    
    await queryInterface.sequelize.query(`
      UPDATE "LiquidityOverviews" SET time_precision = 'day' WHERE time_precision IS NULL;
    `);
  },

  async down(queryInterface, Sequelize) {
    // 移除添加的字段
    await queryInterface.removeColumn('DailyMetrics', 'timestamp');
    await queryInterface.removeColumn('DailyMetrics', 'time_precision');
    
    await queryInterface.removeColumn('TrendingCoins', 'timestamp');
    await queryInterface.removeColumn('TrendingCoins', 'time_precision');
    
    await queryInterface.removeColumn('LiquidityOverviews', 'timestamp');
    await queryInterface.removeColumn('LiquidityOverviews', 'time_precision');
  }
};
