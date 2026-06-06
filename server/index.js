// server/index.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();
const checkFirstRun = require('./middleware/checkFirstRun');
const mcpGatewayRouter = require('./routes/mcpGateway');

const app = express();
const PORT = process.env.PORT || 3001;

function isWeakJwtSecret(secret) {
  if (typeof secret !== 'string') return true;
  const trimmed = secret.trim();
  if (!trimmed) return true;

  const knownBad = new Set([
    'your-secret-key-change-this-in-production',
    'your-secret-key-should-be-in-env-file',
    'fallback-dev-secret-key-change-in-production',
    'your-secret-key',
  ]);

  if (knownBad.has(trimmed)) return true;
  if (trimmed.length < 32) return true;
  return false;
}

function assertProductionSecrets() {
  if (process.env.NODE_ENV !== 'production') return;

  const jwtSecret = process.env.JWT_SECRET;
  if (isWeakJwtSecret(jwtSecret)) {
    console.error('FATAL: 生产环境必须设置强 JWT_SECRET（建议随机生成，长度>=32）。');
    process.exit(1);
  }
}

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
try {
  const authModule = require('./middleware/auth');
  authMiddleware = authModule.verifyToken || authModule;
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

  const configScript = `
      // 此文件由服务器动态生成
      console.log('[App Config] Runtime configuration loaded.');
      window.runtimeConfig = {
        API_BASE_URL: '${apiPublicHost}${apiBasePath}'
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

// Public, unauthenticated routes
app.use('/api/public', require('./routes/public'));
app.use('/api/docs', require('./routes/docs'));

// MCP Gateway（对外暴露 MCP tools/list 与 tools/call）
app.use('/default/crypto', mcpGatewayRouter);

// 路由加载函数 - 带错误处理
function safelyLoadRoutes(routePath, mountPath) {
  try {
    const router = require(routePath);
    app.use(mountPath, authMiddleware, router);
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
safelyLoadRoutes('./routes/favorites', '/api/favorites');
safelyLoadRoutes('./routes/debug', '/api/debug');
safelyLoadRoutes('./routes/admin', '/api/admin');

// 生产环境静态文件与 SPA 回退
if (process.env.NODE_ENV === 'production') {
  const staticPath = path.join(__dirname, 'client/build');
  console.log(`[服务器] 生产环境，提供静态文件于: ${staticPath}`);
  app.use(express.static(staticPath));

  app.get('*', (req, res, next) => {
    if (req.accepts('html')) {
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
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Server error', message: err.message });
});

// 数据库同步并启动服务
db.sequelize
  .sync()
  .then(async () => {
    console.log('Database synchronized');

    const checkAdmin = require('./middleware/checkFirstRun');
    try {
      await new Promise((resolve) => {
        checkAdmin({}, {}, resolve);
      });
    } catch (err) {
      console.error('Admin check failed:', err);
    }

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to synchronize database:', err);
  });
