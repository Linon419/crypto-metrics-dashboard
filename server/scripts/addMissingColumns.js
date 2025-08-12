// server/scripts/addMissingColumns.js
// 添加缺失的数据库列
const { Sequelize } = require('sequelize');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// 根据环境获取配置
const env = process.env.NODE_ENV || 'development';
const config = require('../config/config.json')[env];

// 创建与数据库的连接
const sequelize = new Sequelize(
  config.database, 
  config.username, 
  config.password, 
  {
    host: config.host,
    dialect: config.dialect,
    storage: config.storage, // SQLite需要
    logging: console.log, // 显示所有SQL查询
  }
);

async function addMissingColumns() {
  try {
    // 测试数据库连接
    await sequelize.authenticate();
    console.log('数据库连接成功');

    // 检查并添加 DailyMetrics 表的缺失列
    console.log('检查 DailyMetrics 表...');
    
    // 检查 timestamp 列是否存在
    try {
      await sequelize.query("SELECT timestamp FROM DailyMetrics LIMIT 1");
      console.log('timestamp 列已存在');
    } catch (error) {
      if (error.message.includes('no such column: timestamp')) {
        console.log('添加 timestamp 列...');
        await sequelize.query("ALTER TABLE DailyMetrics ADD COLUMN timestamp DATETIME");
        console.log('timestamp 列添加成功');
      } else {
        throw error;
      }
    }

    // 检查 time_precision 列是否存在
    try {
      await sequelize.query("SELECT time_precision FROM DailyMetrics LIMIT 1");
      console.log('time_precision 列已存在');
    } catch (error) {
      if (error.message.includes('no such column: time_precision')) {
        console.log('添加 time_precision 列...');
        await sequelize.query("ALTER TABLE DailyMetrics ADD COLUMN time_precision VARCHAR(10) DEFAULT 'day'");
        console.log('time_precision 列添加成功');
      } else {
        throw error;
      }
    }

    // 检查并添加 LiquidityOverviews 表的缺失列
    console.log('检查 LiquidityOverviews 表...');
    
    try {
      await sequelize.query("SELECT timestamp FROM LiquidityOverviews LIMIT 1");
      console.log('LiquidityOverviews timestamp 列已存在');
    } catch (error) {
      if (error.message.includes('no such column: timestamp')) {
        console.log('添加 LiquidityOverviews timestamp 列...');
        await sequelize.query("ALTER TABLE LiquidityOverviews ADD COLUMN timestamp DATETIME");
        console.log('LiquidityOverviews timestamp 列添加成功');
      } else {
        throw error;
      }
    }

    try {
      await sequelize.query("SELECT time_precision FROM LiquidityOverviews LIMIT 1");
      console.log('LiquidityOverviews time_precision 列已存在');
    } catch (error) {
      if (error.message.includes('no such column: time_precision')) {
        console.log('添加 LiquidityOverviews time_precision 列...');
        await sequelize.query("ALTER TABLE LiquidityOverviews ADD COLUMN time_precision VARCHAR(10) DEFAULT 'day'");
        console.log('LiquidityOverviews time_precision 列添加成功');
      } else {
        throw error;
      }
    }

    // 检查并添加 TrendingCoins 表的缺失列
    console.log('检查 TrendingCoins 表...');
    
    try {
      await sequelize.query("SELECT timestamp FROM TrendingCoins LIMIT 1");
      console.log('TrendingCoins timestamp 列已存在');
    } catch (error) {
      if (error.message.includes('no such column: timestamp')) {
        console.log('添加 TrendingCoins timestamp 列...');
        await sequelize.query("ALTER TABLE TrendingCoins ADD COLUMN timestamp DATETIME");
        console.log('TrendingCoins timestamp 列添加成功');
      } else {
        throw error;
      }
    }

    try {
      await sequelize.query("SELECT time_precision FROM TrendingCoins LIMIT 1");
      console.log('TrendingCoins time_precision 列已存在');
    } catch (error) {
      if (error.message.includes('no such column: time_precision')) {
        console.log('添加 TrendingCoins time_precision 列...');
        await sequelize.query("ALTER TABLE TrendingCoins ADD COLUMN time_precision VARCHAR(10) DEFAULT 'day'");
        console.log('TrendingCoins time_precision 列添加成功');
      } else {
        throw error;
      }
    }

    console.log('所有缺失列添加完成！');
  } catch (error) {
    console.error('添加列失败:', error);
  } finally {
    // 关闭数据库连接
    await sequelize.close();
  }
}

// 运行脚本
addMissingColumns();
