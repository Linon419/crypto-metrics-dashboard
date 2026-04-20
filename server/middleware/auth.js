// server/middleware/auth.js
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../utils/authConfig');

const JWT_SECRET = getJwtSecret();

// 仅用于开发环境的显式绕过开关：避免误把“免登录管理员”带到生产
const DEV_AUTH_BYPASS = ['true', '1', 'yes'].includes(
  String(process.env.DEV_AUTH_BYPASS || '').toLowerCase()
);

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    if (process.env.NODE_ENV !== 'production' && DEV_AUTH_BYPASS) {
      console.warn('DEV_AUTH_BYPASS enabled: proceeding without token (dev only).');
      req.user = { id: 999, username: 'dev-mode', role: 'admin' };
      return next();
    }
    return res.status(401).json({ error: 'No token provided, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (error) {
    console.error('Auth middleware error:', error.message);

    if (process.env.NODE_ENV !== 'production' && DEV_AUTH_BYPASS) {
      console.warn('DEV_AUTH_BYPASS enabled: proceeding with invalid token (dev only).');
      req.user = { id: 999, username: 'dev-mode', role: 'admin' };
      return next();
    }

    return res.status(401).json({ error: 'Token is not valid' });
  }
};

// 管理员权限检查中间件
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  return next();
};

module.exports = {
  verifyToken: authMiddleware,
  requireAdmin,
  __authTestUtils: {
    resolvedJwtSecret: JWT_SECRET,
  },
};
