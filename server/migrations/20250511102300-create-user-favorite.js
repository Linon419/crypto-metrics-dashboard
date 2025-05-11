'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('UserFavorites', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      device_id: {
        type: Sequelize.STRING,
        allowNull: false
      },
      symbol: {
        type: Sequelize.STRING,
        allowNull: false
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
    
    // 添加联合唯一索引
    await queryInterface.addIndex('UserFavorites', ['device_id', 'symbol'], {
      unique: true,
      name: 'unique_device_symbol'
    });
  },
  
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('UserFavorites');
  }
};