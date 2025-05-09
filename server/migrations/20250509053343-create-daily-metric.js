'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('DailyMetrics', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      coin_id: {
        type: Sequelize.INTEGER
      },
      date: {
        type: Sequelize.STRING
      },
      otc_index: {
        type: Sequelize.INTEGER
      },
      explosion_index: {
        type: Sequelize.INTEGER
      },
      schelling_point: {
        type: Sequelize.FLOAT
      },
      entry_exit_type: {
        type: Sequelize.STRING
      },
      entry_exit_day: {
        type: Sequelize.INTEGER
      },
      near_threshold: {
        type: Sequelize.BOOLEAN
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
    await queryInterface.dropTable('DailyMetrics');
  }
};