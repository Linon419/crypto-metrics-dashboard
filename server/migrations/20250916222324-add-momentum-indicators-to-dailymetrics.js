'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // Check if the column already exists
    const tableInfo = await queryInterface.describeTable('DailyMetrics');
    
    if (!tableInfo.momentum_indicators) {
      await queryInterface.addColumn('DailyMetrics', 'momentum_indicators', {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'JSON array of momentum indicator symbols: $, ※, ‼, ↑, w'
      });
    }
    
    if (!tableInfo.timestamp) {
      await queryInterface.addColumn('DailyMetrics', 'timestamp', {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Precise timestamp for the metric data'
      });
    }
    
    if (!tableInfo.time_precision) {
      await queryInterface.addColumn('DailyMetrics', 'time_precision', {
        type: Sequelize.ENUM('day', 'hour', 'minute'),
        defaultValue: 'day',
        allowNull: false,
        comment: 'Precision level of the time data'
      });
    }
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('DailyMetrics', 'momentum_indicators');
    await queryInterface.removeColumn('DailyMetrics', 'timestamp');
    await queryInterface.removeColumn('DailyMetrics', 'time_precision');
  }
};
