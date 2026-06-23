'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('AppSettings')) {
      return;
    }

    await queryInterface.createTable('AppSettings', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      key: {
        allowNull: false,
        unique: true,
        type: Sequelize.STRING,
      },
      value: {
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

    await queryInterface.addIndex('AppSettings', ['key'], {
      unique: true,
      name: 'app_settings_unique_key',
    });
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('AppSettings')) {
      await queryInterface.dropTable('AppSettings');
    }
  },
};
