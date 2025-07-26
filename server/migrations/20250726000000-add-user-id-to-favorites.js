'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 添加 user_id 字段到 UserFavorites 表
    await queryInterface.addColumn('UserFavorites', 'user_id', {
      type: Sequelize.INTEGER,
      allowNull: true, // 允许为空，以支持未登录用户的收藏（使用device_id）
      references: {
        model: 'Users',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    });

    // 删除原有的唯一索引
    await queryInterface.removeIndex('UserFavorites', 'unique_device_symbol');

    // 创建新的复合唯一索引，支持两种情况：
    // 1. user_id + symbol (已登录用户)
    // 2. device_id + symbol (未登录用户)
    // 注意：我们需要创建两个部分唯一索引，因为 PostgreSQL/MySQL 不支持条件唯一索引
    
    // 为已登录用户创建唯一索引 (user_id + symbol)
    await queryInterface.addIndex('UserFavorites', ['user_id', 'symbol'], {
      unique: true,
      name: 'unique_user_symbol',
      where: {
        user_id: {
          [Sequelize.Op.ne]: null
        }
      }
    });

    // 为未登录用户保持原有索引 (device_id + symbol)，但只在 user_id 为 null 时生效
    await queryInterface.addIndex('UserFavorites', ['device_id', 'symbol'], {
      unique: true,
      name: 'unique_device_symbol_when_no_user',
      where: {
        user_id: null
      }
    });
  },

  async down(queryInterface, Sequelize) {
    // 删除新创建的索引
    await queryInterface.removeIndex('UserFavorites', 'unique_user_symbol');
    await queryInterface.removeIndex('UserFavorites', 'unique_device_symbol_when_no_user');

    // 恢复原有的唯一索引
    await queryInterface.addIndex('UserFavorites', ['device_id', 'symbol'], {
      unique: true,
      name: 'unique_device_symbol'
    });

    // 删除 user_id 字段
    await queryInterface.removeColumn('UserFavorites', 'user_id');
  }
};
