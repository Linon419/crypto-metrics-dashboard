// server/models/index.js
'use strict';

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const process = require('process'); // 确保 process 被正确引用
const basename = path.basename(__filename);
const env = process.env.NODE_ENV || 'development';
let config = require(__dirname + '/../config/config.json')[env]; // 使用 let 允许修改
const db = {};

// --- 【重要修改点开始】 ---
// 如果是生产环境并且 DB_STORAGE 环境变量已设置，则用它覆盖 config 中的 storage 路径
if (env === 'production' && process.env.DB_STORAGE) {
  console.log(`[Sequelize] 生产环境检测到 DB_STORAGE 环境变量: ${process.env.DB_STORAGE}`);
  config.storage = process.env.DB_STORAGE;
} else if (env === 'production' && config.storage === './database.sqlite') {
  // 如果是生产环境，但 DB_STORAGE 未设置，并且 config.json 中是相对路径
  // 默认将其指向 docker-compose.yml 中期望的持久化路径
  // (这是一种备选方案，更推荐使用 DB_STORAGE 环境变量)
  config.storage = "/data/db/database.sqlite";
  console.warn(`[Sequelize] 警告: 生产环境未使用 DB_STORAGE 环境变量，config.storage 默认为: ${config.storage}。推荐设置 DB_STORAGE。`);
}
console.log(`[Sequelize] 最终使用的数据库配置 (${env}):`, JSON.stringify(config, null, 2));
// --- 【重要修改点结束】 ---

let sequelize;
if (config.use_env_variable) {
  sequelize = new Sequelize(process.env[config.use_env_variable], config);
} else {
  // 对于 SQLite, config.storage 是最重要的
  sequelize = new Sequelize(config.database, config.username, config.password, config);
}

fs
  .readdirSync(__dirname)
  .filter(file => {
    return (
      file.indexOf('.') !== 0 &&
      file !== basename &&
      file.slice(-3) === '.js' &&
      file.indexOf('.test.js') === -1
    );
  })
  .forEach(file => {
    const model = require(path.join(__dirname, file))(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
  });

Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

console.log("[models/index.js] Exporting db object keys:", db ? Object.keys(db) : 'db is null/undefined');
console.log("[models/index.js] db.sequelize is:", typeof db.sequelize, db.sequelize ? 'defined' : 'undefined');

module.exports = db;