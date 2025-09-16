'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // Check and fix Users table
    const usersInfo = await queryInterface.describeTable('Users');
    
    if (!usersInfo.status) {
      await queryInterface.addColumn('Users', 'status', {
        type: Sequelize.STRING,
        defaultValue: 'active',
        allowNull: false
      });
    }
    
    // Check and fix Coins table
    try {
      const coinsInfo = await queryInterface.describeTable('Coins');
      
      if (!coinsInfo.current_price) {
        await queryInterface.addColumn('Coins', 'current_price', {
          type: Sequelize.DECIMAL(20, 8),
          allowNull: true
        });
      }
      
      if (!coinsInfo.market_cap) {
        await queryInterface.addColumn('Coins', 'market_cap', {
          type: Sequelize.BIGINT,
          allowNull: true
        });
      }
      
      if (!coinsInfo.volume_24h) {
        await queryInterface.addColumn('Coins', 'volume_24h', {
          type: Sequelize.BIGINT,
          allowNull: true
        });
      }
      
      if (!coinsInfo.last_updated) {
        await queryInterface.addColumn('Coins', 'last_updated', {
          type: Sequelize.DATE,
          allowNull: true
        });
      }
    } catch (error) {
      console.log('Coins table modifications skipped:', error.message);
    }
    
    // Check and fix DailyMetrics table
    const metricsInfo = await queryInterface.describeTable('DailyMetrics');
    
    if (!metricsInfo.near_threshold) {
      await queryInterface.addColumn('DailyMetrics', 'near_threshold', {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      });
    }
  },

  async down (queryInterface, Sequelize) {
    // Remove added columns
    try {
      await queryInterface.removeColumn('Users', 'status');
      await queryInterface.removeColumn('Coins', 'current_price');
      await queryInterface.removeColumn('Coins', 'market_cap');
      await queryInterface.removeColumn('Coins', 'volume_24h');
      await queryInterface.removeColumn('Coins', 'last_updated');
      await queryInterface.removeColumn('DailyMetrics', 'near_threshold');
    } catch (error) {
      console.log('Some columns may not exist for removal:', error.message);
    }
  }
};
