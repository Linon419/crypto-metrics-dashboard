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

// 认证中间件 (延迟加载，避免路径错误)
let authMiddleware;
try {
  authMiddleware = require('./middleware/auth');
} catch (error) {
  console.error('Failed to load auth middleware:', error);
  // 提供一个简易的中间件替代
  authMiddleware = (req, res, next) => {
    console.log('Using fallback auth middleware');
    next();
  };
}

// 测试路由
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working!', timestamp: new Date().toISOString() });
});

// 路由加载函数 - 带错误处理
function safelyLoadRoutes(routePath, mountPath) {
  try {
    const router = require(routePath);
    app.use(mountPath, authMiddleware, router);
    console.log(`Route loaded: ${mountPath}`);
    return true;
  } catch (error) {
    console.error(`Failed to load route ${routePath}:`, error);
    // 提供一个临时路由
    app.use(mountPath, (req, res) => {
      res.status(500).json({ error: `Route ${mountPath} is temporarily unavailable` });
    });
    return false;
  }
}

// 加载路由
app.use('/api/auth', require('./routes/auth'));

// 安全地加载其他路由
safelyLoadRoutes('./routes/coins', '/api/coins');
safelyLoadRoutes('./routes/metrics', '/api/metrics');
safelyLoadRoutes('./routes/data', '/api/data');
safelyLoadRoutes('./routes/dashboard', '/api/dashboard');
safelyLoadRoutes('./routes/liquidity', '/api/liquidity');
safelyLoadRoutes('./routes/debug', '/api/debug');

// 提供静态文件（生产环境）
if (process.env.NODE_ENV === 'production') {
    // 设置静态文件夹 - 【重要修改点】
    const staticPath = path.join(__dirname, 'client/build'); // <--- 修改这里
    console.log(`[服务器] 生产环境，提供静态文件于: ${staticPath}`);
    app.use(express.static(staticPath));
    
    // 所有未匹配的路由都返回index.html - 【重要修改点】
    app.get('*', (req, res) => {
      const indexPath = path.join(__dirname, 'client/build', 'index.html'); // <--- 修改这里
      console.log(`[服务器] 为路由 ${req.path} 提供 SPA 入口: ${indexPath}`);
      res.sendFile(indexPath, (err) => { // 添加错误处理回调
        if (err) {
          console.error('[服务器] 发送 index.html 出错:', err);
          res.status(500).json({
            error: "无法提供应用入口文件",
            message: err.message
          });
        }
      });
    });
  }

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Server error', message: err.message });
});

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