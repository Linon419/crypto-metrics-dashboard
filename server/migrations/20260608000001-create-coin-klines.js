'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('CoinKlines')) {
      return;
    }

    await queryInterface.createTable('CoinKlines', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      coin_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Coins',
          key: 'id',
        },
      },
      coin_symbol: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      trading_symbol: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      market: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'binance_usdm_perpetual',
      },
      interval: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: '1d',
      },
      open_time: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      close_time: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      open_price: {
        type: Sequelize.FLOAT,
        allowNull: false,
      },
      high_price: {
        type: Sequelize.FLOAT,
        allowNull: false,
      },
      low_price: {
        type: Sequelize.FLOAT,
        allowNull: false,
      },
      close_price: {
        type: Sequelize.FLOAT,
        allowNull: false,
      },
      volume: {
        type: Sequelize.FLOAT,
        allowNull: false,
        defaultValue: 0,
      },
      quote_volume: {
        type: Sequelize.FLOAT,
        allowNull: false,
        defaultValue: 0,
      },
      trade_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
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

    await queryInterface.addIndex('CoinKlines', ['coin_id', 'interval', 'open_time']);
    await queryInterface.addIndex('CoinKlines', ['trading_symbol', 'market', 'interval', 'open_time']);
    await queryInterface.addIndex('CoinKlines', ['coin_id', 'market', 'interval', 'open_time'], {
      unique: true,
      name: 'coin_klines_unique_coin_market_interval_open_time',
    });
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('CoinKlines')) {
      await queryInterface.dropTable('CoinKlines');
    }
  },
};
