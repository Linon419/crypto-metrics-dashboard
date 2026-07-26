'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('Notifications')) {
      return;
    }

    await queryInterface.createTable('Notifications', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      user_id: {
        allowNull: false,
        type: Sequelize.INTEGER,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      external_id: {
        allowNull: false,
        type: Sequelize.STRING(128),
      },
      source: {
        allowNull: false,
        defaultValue: 'telegram',
        type: Sequelize.STRING(32),
      },
      title: {
        allowNull: false,
        type: Sequelize.STRING(160),
      },
      content: {
        allowNull: false,
        type: Sequelize.TEXT,
      },
      category: {
        allowNull: false,
        defaultValue: 'market',
        type: Sequelize.STRING(32),
      },
      priority: {
        allowNull: false,
        defaultValue: 'normal',
        type: Sequelize.STRING(16),
      },
      coin_symbol: {
        allowNull: true,
        type: Sequelize.STRING(32),
      },
      notification_date: {
        allowNull: true,
        type: Sequelize.STRING(10),
      },
      read_at: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      metadata: {
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

    await queryInterface.addIndex('Notifications', ['user_id', 'external_id'], {
      unique: true,
      name: 'notifications_unique_user_external_id',
    });
    await queryInterface.addIndex('Notifications', ['user_id', 'read_at', 'createdAt'], {
      name: 'notifications_user_unread_created_at',
    });
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('Notifications')) {
      await queryInterface.dropTable('Notifications');
    }
  },
};
