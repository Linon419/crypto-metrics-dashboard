// server/index.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();
const checkFirstRun = require('./middleware/checkFirstRun');


const app = express();
const PORT = process.env.PORT || 3001;

// 数据库初始化
const db = require('./models');

// 中间件
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(morgan('dev'));
app.use(checkFirstRun);


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
// ======================================================================
// 新增：动态生成前端配置的路由
// 这个路由应该在静态文件服务和 SPA 回退路由之前定义
app.get('/app-config.js', (req, res) => {
    // 从环境变量中获取 API 的公共访问主机和路径
    // API_PUBLIC_HOST 应该包含协议、域名/IP 和端口 (如果非标准)
    // 例如: http://yourserver.com:3080 或 https://api.yourdomain.com
    const apiPublicHost = process.env.API_PUBLIC_HOST;
    const apiBasePath = '/api'; // 你的 API 路由的基础路径
  
    if (!apiPublicHost) {
      console.error('FATAL ERROR: API_PUBLIC_HOST environment variable is not set.');
      // 在生产环境中，如果这个配置缺失，前端将无法工作
      // 可以返回一个错误，或者一个包含错误信息的JS，让前端知道配置失败
      const errorScript = `
        console.error("Frontend runtime configuration failed: API_PUBLIC_HOST is not set on the server.");
        window.runtimeConfig = { error: "Configuration load failed" };
      `;
      res.type('application/javascript');
      return res.status(500).send(errorScript);
    }
  
    const configScript = `
      // 此文件由服务器动态生成
      console.log('[App Config] Runtime configuration loaded.');
      window.runtimeConfig = {
        API_BASE_URL: '${apiPublicHost}${apiBasePath}'
        // 你可以在这里添加其他需要在前端运行时配置的变量
        // 例如: SENTRY_DSN: '${process.env.FRONTEND_SENTRY_DSN || ''}'
      };
    `;
  
    res.type('application/javascript');
    res.send(configScript);
    console.log(`Served /app-config.js with API_BASE_URL: ${apiPublicHost}${apiBasePath}`);
  });
  // ======================================================================
  
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
safelyLoadRoutes('./routes/favorites', '/api/favorites'); // 添加收藏路由
safelyLoadRoutes('./routes/debug', '/api/debug');

 // 3. 静态文件服务和 SPA 回退 (生产环境)
 if (process.env.NODE_ENV === 'production') {
    const staticPath = path.join(__dirname, 'client/build');
    console.log(`[服务器] 生产环境，提供静态文件于: ${staticPath}`);
    app.use(express.static(staticPath)); // express.static 会先尝试匹配物理文件
  
    // 4. SPA 回退路由：所有未被以上路由处理的 GET 请求都返回 index.html
    // 这个处理器现在不需要检查 /api/ 或 /app-config.js 了
    app.get('*', (req, res, next) => { // <--- 可以保留 next，以防万一需要传递给最后的错误处理
      // 检查请求是否期望 HTML (通常浏览器发出的导航请求会是)
      // API 请求通常 Accept: application/json
      if (req.accepts('html')) {
          const indexPath = path.join(__dirname, 'client/build', 'index.html');
          console.log(`[服务器] SPA Fallback: Serving index.html for route ${req.path}`);
          res.sendFile(indexPath, (err) => {
              if (err) {
                  console.error('[服务器] SPA Fallback: Error sending index.html:', err);
                  // 如果发送 index.html 失败，可以将错误传递给 Express 的错误处理中间件
                  next(err);
              }
          });
      } else {
          // 如果请求不接受 HTML (例如一个未匹配的 API 请求，它可能期望 JSON 错误)
          // 则不发送 index.html，而是让它自然地流向404或错误处理
          // 或者你可以明确地发送一个404
          // res.status(404).json({ message: "Resource not found" });
          next(); // 让 Express 的默认 404 处理或你的自定义错误处理器接管
      }
    });
  }

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Server error', message: err.message });
});

// 数据库同步并启动服务器
db.sequelize.sync()
  .then(async () => {
    console.log('Database synchronized');
    
    // 在这里也可以手动触发一次管理员检查
    const checkAdmin = require('./middleware/checkFirstRun');
    try {
      await new Promise(resolve => {
        checkAdmin({}, {}, resolve);
      });
    } catch (err) {
      console.error('Admin check failed:', err);
    }
    
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to synchronize database:', err);
  });