'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('DatabasePatchLogs')) {
      return;
    }

    await queryInterface.createTable('DatabasePatchLogs', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      patch_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      mode: {
        type: Sequelize.ENUM('dry-run', 'apply'),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('success', 'failed'),
        allowNull: false,
      },
      reason: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      operations_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      matched_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      applied_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      requested_by: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      request_ip: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      patch_json: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      result_json: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      error_message: {
        type: Sequelize.TEXT,
        allowNull: true,
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

    await queryInterface.addIndex('DatabasePatchLogs', ['patch_id']);
    await queryInterface.addIndex('DatabasePatchLogs', ['createdAt']);
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('DatabasePatchLogs')) {
      await queryInterface.dropTable('DatabasePatchLogs');
    }
  },
};
