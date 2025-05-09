'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('LiquidityOverviews', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      date: {
        type: Sequelize.STRING
      },
      btc_fund_change: {
        type: Sequelize.FLOAT
      },
      eth_fund_change: {
        type: Sequelize.FLOAT
      },
      sol_fund_change: {
        type: Sequelize.FLOAT
      },
      total_market_fund_change: {
        type: Sequelize.FLOAT
      },
      comments: {
        type: Sequelize.TEXT
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('LiquidityOverviews');
  }
};