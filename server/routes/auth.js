const express = require('express');
const { AppSetting, User, UserAuditLog } = require('../models');
const { createAuthMiddleware } = require('../middleware/auth');
const { getJwtSecret } = require('../utils/authConfig');
const { createLoginAttemptLimiter } = require('../utils/loginAttemptLimiter');
const { getSystemSettings } = require('../utils/settings');
const {
  authenticateUser,
  changeOwnPassword,
  registerUser,
} = require('../services/authService');
const { writeUserAuditLog } = require('../services/userManagementService');
const { isDemoAccount } = require('../utils/demoAccounts');

const JWT_SECRET = getJwtSecret();
const loginAttemptLimiter = createLoginAttemptLimiter();

function getRequestIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function sendRouteError(res, error, fallbackMessage) {
  const uniqueConflict = error.name === 'SequelizeUniqueConstraintError';
  const statusCode = error.statusCode || (uniqueConflict ? 409 : 500);
  if (statusCode >= 500) console.error(fallbackMessage, error);
  if (error.retryAfterSeconds) res.set('Retry-After', String(error.retryAfterSeconds));
  // 登录/注册在鉴权之前，5xx 只回通用文案；4xx 的校验提示本来就是给用户看的，保留原文
  const message = uniqueConflict
    ? 'Username or email already exists'
    : (statusCode >= 500 ? fallbackMessage : (error.message || fallbackMessage));
  return res.status(statusCode).json({ error: message });
}

async function writeAuthAudit(payload) {
  try {
    await writeUserAuditLog({ UserAuditLogModel: UserAuditLog }, payload);
  } catch (error) {
    console.error('Failed to write authentication audit log:', error);
  }
}

function createAuthRouter({
  UserModel = User,
  AppSettingModel = AppSetting,
  limiter = loginAttemptLimiter,
  jwtSecret = JWT_SECRET,
} = {}) {
  const router = express.Router();
  const verifyToken = createAuthMiddleware({ UserModel, jwtSecret });
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.post('/register', async (req, res) => {
    try {
      const settings = await getSystemSettings({ AppSettingModel });
      if (!settings.registrationEnabled) {
        return res.status(403).json({ error: '注册功能已关闭，请联系管理员' });
      }
      const result = await registerUser({ UserModel, jwtSecret }, req.body || {});
      await writeAuthAudit({
        actor: result.user,
        target: result.user,
        action: 'auth.register',
        ip: getRequestIp(req),
      });
      return res.status(201).json({ message: 'User registered successfully', ...result });
    } catch (error) {
      return sendRouteError(res, error, 'Failed to register user');
    }
  });

  router.post('/login', async (req, res) => {
    try {
      const result = await authenticateUser({ UserModel, limiter, jwtSecret }, {
        ...req.body,
        ip: getRequestIp(req),
      });
      await writeAuthAudit({
        actor: result.user,
        target: result.user,
        action: 'auth.login.success',
        ip: getRequestIp(req),
      });
      return res.json({ message: 'Login successful', ...result });
    } catch (error) {
      if (error.statusCode !== 429) {
        await writeAuthAudit({
          action: 'auth.login.failed',
          target: { username: String(req.body?.username || '').trim().slice(0, 64) || null },
          details: { statusCode: error.statusCode || 500 },
          ip: getRequestIp(req),
        });
      }
      return sendRouteError(res, error, 'Failed to login');
    }
  });

  router.get('/verify', verifyToken, (req, res) => res.json({ user: req.user }));

  router.put('/change-password', verifyToken, async (req, res) => {
    // 演示账号的凭据是公开的，任何访客都能登录；若允许自助改密，
    // 第一个访问者就能改掉口令并独占该账号
    if (isDemoAccount(req.user)) {
      return res.status(403).json({
        error: '演示账号不支持修改密码',
        code: 'DEMO_ACCOUNT_READ_ONLY',
      });
    }

    try {
      const result = await changeOwnPassword({ UserModel }, req.user.id, req.body || {});
      await writeAuthAudit({
        actor: req.user,
        target: req.user,
        action: 'auth.password.change',
        ip: getRequestIp(req),
      });
      return res.json({ message: '密码修改成功，请重新登录', ...result });
    } catch (error) {
      return sendRouteError(res, error, '密码修改失败');
    }
  });

  return router;
}

const router = createAuthRouter();
router.createAuthRouter = createAuthRouter;
router.__authTestUtils = {
  loginAttemptLimiter,
  resolvedJwtSecret: JWT_SECRET,
};

module.exports = router;
