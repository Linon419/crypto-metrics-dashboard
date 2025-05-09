// server/index.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// 数据库初始化
const db = require('./models');

// 中间件
app.use(cors());
app.use(bodyParser.json());
app.use(morgan('dev'));

// API路由
app.use('/api/coins', require('./routes/coins'));
app.use('/api/metrics', require('./routes/metrics'));
app.use('/api/data', require('./routes/data'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/liquidity', require('./routes/liquidity'));
app.use('/api/debug', require('./routes/debug'));
// 提供静态文件（生产环境）
if (process.env.NODE_ENV === 'production') {
  // 设置静态文件夹
  app.use(express.static(path.join(__dirname, '../client/build')));
  
  // 所有未匹配的路由都返回index.html
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
}

// 数据库同步并启动服务器
db.sequelize.sync()
  .then(() => {
    console.log('Database synchronized');
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to synchronize database:', err);
  });