'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('TrendingCoins', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      date: {
        type: Sequelize.STRING
      },
      symbol: {
        type: Sequelize.STRING
      },
      otc_index: {
        type: Sequelize.INTEGER
      },
      explosion_index: {
        type: Sequelize.INTEGER
      },
      entry_exit_type: {
        type: Sequelize.STRING
      },
      entry_exit_day: {
        type: Sequelize.INTEGER
      },
      schelling_point: {
        type: Sequelize.FLOAT
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
    await queryInterface.dropTable('TrendingCoins');
  }
};