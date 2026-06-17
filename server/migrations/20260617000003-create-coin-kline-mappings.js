'use strict';

const {
  buildDefaultKlineMappingsForCoins,
} = require('../utils/coinKlineMappings');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('CoinKlineMappings', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      coin_id: {
        allowNull: false,
        type: Sequelize.INTEGER,
        references: {
          model: 'Coins',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      coin_symbol: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      market: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      trading_symbol: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      enabled: {
        allowNull: false,
        defaultValue: true,
        type: Sequelize.BOOLEAN,
      },
      notes: {
        allowNull: true,
        type: Sequelize.TEXT,
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

    await queryInterface.addIndex('CoinKlineMappings', ['coin_id'], {
      unique: true,
      name: 'coin_kline_mappings_unique_coin_id',
    });
    await queryInterface.addIndex('CoinKlineMappings', ['coin_symbol'], {
      name: 'coin_kline_mappings_coin_symbol',
    });
    await queryInterface.addIndex('CoinKlineMappings', ['market', 'trading_symbol'], {
      name: 'coin_kline_mappings_market_trading_symbol',
    });

    const [coins] = await queryInterface.sequelize.query('SELECT id, symbol FROM Coins');
    const now = new Date();
    const rows = buildDefaultKlineMappingsForCoins(coins).map(row => ({
      ...row,
      createdAt: now,
      updatedAt: now,
    }));

    if (rows.length > 0) {
      await queryInterface.bulkInsert('CoinKlineMappings', rows);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('CoinKlineMappings');
  },
};
