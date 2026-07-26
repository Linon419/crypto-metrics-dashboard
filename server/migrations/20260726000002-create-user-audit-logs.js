'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('UserAuditLogs')) return;

    await queryInterface.createTable('UserAuditLogs', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      actor_user_id: {
        allowNull: true,
        type: Sequelize.INTEGER,
      },
      actor_username: {
        allowNull: true,
        type: Sequelize.STRING(64),
      },
      target_user_id: {
        allowNull: true,
        type: Sequelize.INTEGER,
      },
      target_username: {
        allowNull: true,
        type: Sequelize.STRING(64),
      },
      action: {
        allowNull: false,
        type: Sequelize.STRING(64),
      },
      details: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      ip_address: {
        allowNull: true,
        type: Sequelize.STRING(64),
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

    await queryInterface.addIndex('UserAuditLogs', ['action', 'createdAt'], {
      name: 'user_audit_logs_action_created_at',
    });
    await queryInterface.addIndex('UserAuditLogs', ['target_user_id', 'createdAt'], {
      name: 'user_audit_logs_target_created_at',
    });
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('UserAuditLogs')) {
      await queryInterface.dropTable('UserAuditLogs');
    }
  },
};
