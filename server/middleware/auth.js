const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { getJwtSecret } = require('../utils/authConfig');
const {
  authVersionsMatch,
  createAuthVersion,
  serializeAuthUser,
} = require('../utils/authSecurity');
const { isPasswordChangeEnforced } = require('../utils/productionSecrets');
const {
  isDemoAccount,
  isDemoAccountMisconfigured,
  isDemoReadOnly,
} = require('../utils/demoAccounts');

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

      const passwordChangeRecommended = decoded.passwordChangeRecommended === true;
      const safeUser = serializeAuthUser(user);
      const demoAccount = isDemoAccount(safeUser);
      req.user = {
        ...safeUser,
        passwordChangeRecommended,
        passwordChangeEnforced:
          passwordChangeRecommended && isPasswordChangeEnforced() && !demoAccount,
        demoAccount,
        demoReadOnly: demoAccount && isDemoReadOnly(),
      };
      req.auth = { claims: decoded, token };
      return next();
    } catch (error) {
      console.error('Auth user lookup error:', error);
      return res.status(500).json({ error: 'Authentication service unavailable' });
    }
  };
}

const authMiddleware = createAuthMiddleware();

/**
 * 初始密码闸门：携带 passwordChangeRecommended 的会话除 /api/auth 外一律拒绝。
 * 前端弹窗只是提示，真正的强制在这里。
 * 本地一键启动（DASHBOARD_LOCAL_MODE=1）不启用，仅保留提示。
 */
function requirePasswordChange(req, res, next) {
  if (!isPasswordChangeEnforced()) return next();

  // 演示账号按设计保留弱口令，改由只读闸门限制影响面
  if (isDemoAccount(req.user)) return next();

  if (isDemoAccountMisconfigured(req.user)) {
    console.error(
      `[安全告警] DEMO_USERNAMES 包含管理员账号 ${req.user.username}，已忽略该豁免。请改用普通用户角色。`
    );
  }

  if (req.user?.passwordChangeRecommended === true) {
    return res.status(403).json({
      error: '当前账号仍在使用初始密码，请先完成密码修改后再使用其他功能',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
  }
  return next();
}

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
  requirePasswordChange,
  __authTestUtils: {
    resolvedJwtSecret: JWT_SECRET,
  },
};
