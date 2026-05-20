'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('BtcPricePoints')) {
      return;
    }

    await queryInterface.createTable('BtcPricePoints', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      daily_metric_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: {
          model: 'DailyMetrics',
          key: 'id',
        },
      },
      coin_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Coins',
          key: 'id',
        },
      },
      symbol: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'BTCUSDT',
      },
      market: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'binance_usdm_perpetual',
      },
      published_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      kline_open_time: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      kline_close_time: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      close_price: {
        type: Sequelize.FLOAT,
        allowNull: false,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    await queryInterface.addIndex('BtcPricePoints', ['coin_id']);
    await queryInterface.addIndex('BtcPricePoints', ['daily_metric_id'], { unique: true });
    await queryInterface.addIndex('BtcPricePoints', ['symbol', 'published_at']);
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('BtcPricePoints')) {
      await queryInterface.dropTable('BtcPricePoints');
    }
  },
};
