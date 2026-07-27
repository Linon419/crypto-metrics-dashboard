// server/index.js
const express = require('express');
const http = require('http');
const cors = require('cors');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();
const checkFirstRun = require('./middleware/checkFirstRun');
const { attachKlineWebSocketServer } = require('./services/klineWebSocketServer');
const { buildRuntimeConfigScript } = require('./utils/runtimeConfig');
const { assertProductionSecrets, isLocalMode } = require('./utils/productionSecrets');
const { enforceDemoReadOnly } = require('./utils/demoAccounts');
const { reconcileIndexes } = require('./utils/schemaMaintenance');
const { closeApplicationResources } = require('./utils/serverShutdown');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

assertProductionSecrets();

// 数据库初始化
const db = require('./models');

// 中间件
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(morgan('dev'));
app.use(checkFirstRun);

// 认证中间件（延迟加载，避免路径错误）
let authMiddleware;
let requirePasswordChange;
try {
  const authModule = require('./middleware/auth');
  authMiddleware = authModule.verifyToken || authModule;
  requirePasswordChange = authModule.requirePasswordChange;
} catch (error) {
  console.error('Failed to load auth middleware:', error);
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: 生产环境禁止认证中间件降级，请修复后重启。');
    process.exit(1);
  }
  authMiddleware = (req, res, next) => {
    console.warn('Using fallback auth middleware (dev only).');
    next();
  };
}

// 认证模块降级时（仅开发环境）保持链路完整
if (typeof requirePasswordChange !== 'function') {
  requirePasswordChange = (req, res, next) => next();
}

// ======================================================================
// 新增：动态生成前端运行时配置
app.get('/app-config.js', (req, res) => {
  const apiPublicHost = process.env.API_PUBLIC_HOST;
  const apiBasePath = '/api';

  if (!apiPublicHost) {
    console.error('FATAL ERROR: API_PUBLIC_HOST environment variable is not set.');
    const errorScript = `
        console.error("Frontend runtime configuration failed: API_PUBLIC_HOST is not set on the server.");
        window.runtimeConfig = { error: "Configuration load failed" };
      `;
    res.type('application/javascript');
    return res.status(500).send(errorScript);
  }

  const configScript = buildRuntimeConfigScript({
    apiBaseUrl: `${apiPublicHost}${apiBasePath}`,
    brandfetchClientId: process.env.BRANDFETCH_CLIENT_ID,
  });

  res.type('application/javascript');
  res.send(configScript);
  console.log(`Served /app-config.js with API_BASE_URL: ${apiPublicHost}${apiBasePath}`);
});
// ======================================================================

// 测试路由
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working!', timestamp: new Date().toISOString() });
});

// Public, unauthenticated routes
app.use('/api/public', require('./routes/public'));
app.use('/api/docs', require('./routes/docs'));
app.use('/api/logos', require('./routes/logos'));

// 路由加载函数 - 带错误处理
function safelyLoadRoutes(routePath, mountPath) {
  try {
    const router = require(routePath);
    // 未更换初始密码的会话只能访问 /api/auth，其余业务接口一律拦截；
    // 演示账号豁免改密但默认只读
    app.use(mountPath, authMiddleware, requirePasswordChange, enforceDemoReadOnly, router);
    console.log(`Route loaded: ${mountPath}`);
    return true;
  } catch (error) {
    console.error(`Failed to load route ${routePath}:`, error);
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
safelyLoadRoutes('./routes/volatility', '/api/volatility');
safelyLoadRoutes('./routes/options', '/api/options');
safelyLoadRoutes('./routes/favorites', '/api/favorites');
safelyLoadRoutes('./routes/notifications', '/api/notifications');
safelyLoadRoutes('./routes/debug', '/api/debug');
safelyLoadRoutes('./routes/admin', '/api/admin');

// 生产环境静态文件与 SPA 回退
if (process.env.NODE_ENV === 'production') {
  const staticPath = path.join(__dirname, 'client/build');
  console.log(`[服务器] 生产环境，提供静态文件于: ${staticPath}`);
  app.use(express.static(staticPath));

  // 使用 app.use 兼容 Express 4/5：Express 5 的 path-to-regexp v8 会拒绝裸 '*'，
  // 会在启动时抛 TypeError: Missing parameter name。仓库根目录装的是 express 5，
  // server/ 下装的是 express 4，一键启动器打包时又不带 server/node_modules，
  // 因此这里必须写成两个大版本都成立的形式。
  app.use((req, res, next) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && req.accepts('html')) {
      const indexPath = path.join(__dirname, 'client/build', 'index.html');
      console.log(`[服务器] SPA Fallback: Serving index.html for route ${req.path}`);
      res.sendFile(indexPath, (err) => {
        if (err) {
          console.error('[服务器] SPA Fallback: Error sending index.html:', err);
          next(err);
        }
      });
    } else {
      next();
    }
  });
}

// 错误处理中间件
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  // 响应已发出时不能再写一次，否则触发 ERR_HTTP_HEADERS_SENT
  if (res.headersSent) {
    return next(err);
  }

  // body-parser 等中间件会带上 status/statusCode（如 JSON 解析失败 400、
  // 请求体过大 413）。此前一律改写成 500，前端据此走了错误的分支。
  const status = Number(err.status || err.statusCode) || 500;

  // 4xx 是调用方可据以纠正的信息，可以回显；
  // 5xx 的 err.message 往往含表名、列名、文件路径，只写日志。
  const message = status < 500
    ? (err.message || 'Request error')
    : 'Server error';

  res.status(status).json({ error: message });
});

// 数据库同步并启动服务
db.sequelize
  .sync()
  .then(async () => {
    console.log('Database synchronized');

    // sync() 只补建索引、不删旧索引，这里收敛掉已被取代的过期唯一索引
    try {
      await reconcileIndexes(db.sequelize);
    } catch (schemaError) {
      console.error('索引收敛失败（不影响启动）:', schemaError.message);
    }

    const checkAdmin = require('./middleware/checkFirstRun');
    try {
      await new Promise((resolve) => {
        checkAdmin({}, {}, resolve);
      });
    } catch (err) {
      console.error('Admin check failed:', err);
    }

    const wss = attachKlineWebSocketServer({ server, db });
    // 本地一键启动使用内置弱密钥，只监听回环地址，避免同局域网直接访问
    const host = process.env.HOST || (isLocalMode() ? '127.0.0.1' : '0.0.0.0');

    // 没有 'error' 监听时，EADDRINUSE 会作为未捕获异常直接抛栈，
    // 一键启动器只能报"90 秒未就绪"，用户看不出真正原因。
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`端口 ${PORT} 已被占用，请关闭占用该端口的程序或改用其他 PORT。`);
      } else {
        console.error('HTTP 服务启动失败:', err);
      }
      process.exit(1);
    });

    server.listen(PORT, host, () => {
      console.log(`Server running on ${host}:${PORT}`);
      console.log('Kline WebSocket running on /ws/klines');
    });

    // 优雅退出：否则 docker stop 会掐断在途请求，
    // 且 WebSocket 与 SQLite 句柄都不会被关闭。
    let shuttingDown = false;
    const shutdown = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`收到 ${signal}，正在关闭服务...`);

      const forceExit = setTimeout(() => {
        console.error('关闭超时，强制退出');
        process.exit(1);
      }, 10000);
      forceExit.unref();

      let exitCode = 0;
      try {
        await closeApplicationResources({ server, wss, sequelize: db.sequelize });
      } catch (closeError) {
        exitCode = 1;
        console.error('关闭过程中出错:', closeError);
      } finally {
        clearTimeout(forceExit);
        console.log('服务已关闭');
        process.exit(exitCode);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })
  .catch((err) => {
    // 此前只打日志不退出，进程会活着但永远不 listen，
    // 外部只能看到"启动超时"这种无从下手的现象。
    console.error('Failed to synchronize database:', err);
    process.exit(1);
  });
