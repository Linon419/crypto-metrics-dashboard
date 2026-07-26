const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { getJwtSecret } = require('../utils/authConfig');
const {
  authVersionsMatch,
  createAuthVersion,
  serializeAuthUser,
} = require('../utils/authSecurity');

const JWT_SECRET = getJwtSecret();
const DEV_AUTH_BYPASS = ['true', '1', 'yes'].includes(
  String(process.env.DEV_AUTH_BYPASS || '').toLowerCase()
);

function sendUnauthorized(res, message = 'Token is not valid') {
  return res.status(401).json({ error: message });
}

function createAuthMiddleware({
  UserModel = User,
  jwtSecret = JWT_SECRET,
  allowDevBypass = process.env.NODE_ENV !== 'production' && DEV_AUTH_BYPASS,
} = {}) {
  return async function authMiddleware(req, res, next) {
    const authorization = String(req.headers.authorization || '');
    const [scheme, token] = authorization.split(' ');

    if (scheme !== 'Bearer' || !token) {
      if (allowDevBypass) {
        console.warn('DEV_AUTH_BYPASS enabled: proceeding without token (dev only).');
        req.user = { id: 999, username: 'dev-mode', role: 'admin', status: 'active' };
        return next();
      }
      return sendUnauthorized(res, 'No token provided, authorization denied');
    }

    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (error) {
      console.error('Auth token verification error:', error.message);
      if (allowDevBypass) {
        console.warn('DEV_AUTH_BYPASS enabled: proceeding with invalid token (dev only).');
        req.user = { id: 999, username: 'dev-mode', role: 'admin', status: 'active' };
        return next();
      }
      return sendUnauthorized(res);
    }

    try {
      const user = await UserModel.findByPk(decoded.id);
      if (!user || user.status !== 'active') {
        return sendUnauthorized(res, 'Account is unavailable');
      }
      const currentVersion = createAuthVersion(user, jwtSecret);
      if (!authVersionsMatch(decoded.authVersion, currentVersion)) {
        return sendUnauthorized(res, 'Session has expired');
      }

      req.user = serializeAuthUser(user);
      req.auth = { claims: decoded, token };
      return next();
    } catch (error) {
      console.error('Auth user lookup error:', error);
      return res.status(500).json({ error: 'Authentication service unavailable' });
    }
  };
}

const authMiddleware = createAuthMiddleware();

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.status !== 'active' || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}

module.exports = {
  createAuthMiddleware,
  verifyToken: authMiddleware,
  requireAdmin,
  __authTestUtils: {
    resolvedJwtSecret: JWT_SECRET,
  },
};
