// server/routes/admin.js
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const router = express.Router();
const {
  Coin,
  DailyMetric,
  DatabasePatchLog,
  LiquidityOverview,
  TrendingCoin,
  User,
  sequelize,
} = require('../models');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { getSystemSettings, updateSystemSettings } = require('../utils/settings');
const {
  PatchValidationError,
  runDatabasePatch,
  validateDatabasePatch,
} = require('../utils/databasePatch');
const {
  AdminDateRecordError,
  deleteDateRecords,
  getDateRecordSummary,
  updateDateRecordTime,
} = require('../utils/adminDateRecords');

// 管理员中间件 - 验证是否为管理员
router.use(verifyToken);
router.use(requireAdmin);

const patchModels = {
  Coin,
  DailyMetric,
  LiquidityOverview,
  TrendingCoin,
};

function getPatchActor(req) {
  if (!req.user) return null;
  return req.user.username || String(req.user.id || '');
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({ error: 'JSON serialization failed', message: error.message });
  }
}

async function createPatchLog({
  patchId,
  mode,
  status,
  reason,
  patch,
  result,
  error,
  req,
  transaction,
}) {
  if (!DatabasePatchLog) return null;

  return DatabasePatchLog.create({
    patch_id: patchId,
    mode,
    status,
    reason: reason || 'validation failed',
    operations_count: result?.summary?.operations || patch?.operations?.length || 0,
    matched_count: result?.summary?.matched || 0,
    applied_count: result?.summary?.applied || 0,
    requested_by: getPatchActor(req),
    request_ip: req.ip,
    patch_json: safeJsonStringify(patch || req.body || {}),
    result_json: result ? safeJsonStringify(result) : null,
    error_message: error ? error.message : null,
  }, { transaction });
}

async function handleDatabasePatch(req, res, mode) {
  const patchId = crypto.randomUUID();
  const transaction = mode === 'apply' ? await sequelize.transaction() : null;

  try {
    const normalizedPatch = validateDatabasePatch(req.body);
    const result = await runDatabasePatch(normalizedPatch, {
      models: patchModels,
      mode,
      transaction,
    });

    const response = {
      success: true,
      patchId,
      ...result,
      normalizedPatch: undefined,
    };

    await createPatchLog({
      patchId,
      mode,
      status: 'success',
      reason: result.reason,
      patch: result.normalizedPatch,
      result: response,
      req,
      transaction,
    });

    if (transaction) {
      await transaction.commit();
    }

    res.json(response);
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }

    try {
      await createPatchLog({
        patchId,
        mode,
        status: 'failed',
        reason: req.body?.reason,
        patch: req.body,
        error,
        req,
      });
    } catch (logError) {
      console.error('写入数据库补丁失败日志失败:', logError);
    }

    const statusCode = error instanceof PatchValidationError ? 400 : 500;
    console.error(`[DATABASE_PATCH] ${mode} failed:`, error);
    res.status(statusCode).json({
      success: false,
      patchId,
      error: error.message,
    });
  }
}

router.post('/database-patches/dry-run', async (req, res) => {
  await handleDatabasePatch(req, res, 'dry-run');
});

router.post('/database-patches/apply', async (req, res) => {
  await handleDatabasePatch(req, res, 'apply');
});

router.get('/database-patches/logs', async (req, res) => {
  try {
    const rawLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, 100)
      : 20;

    const logs = await DatabasePatchLog.findAll({
      order: [['createdAt', 'DESC']],
      limit,
    });

    res.json({
      success: true,
      logs,
    });
  } catch (error) {
    console.error('获取数据库补丁日志失败:', error);
    res.status(500).json({
      success: false,
      error: '获取数据库补丁日志失败',
    });
  }
});

const dateRecordModels = {
  DailyMetric,
  LiquidityOverview,
  TrendingCoin,
};

function getDateRecordStatusCode(error) {
  return error instanceof AdminDateRecordError ? error.statusCode : 500;
}

router.get('/date-records/:date/summary', async (req, res) => {
  try {
    const summary = await getDateRecordSummary(dateRecordModels, req.params.date);
    res.json({
      success: true,
      summary,
    });
  } catch (error) {
    console.error('[DATE_RECORDS] summary failed:', error);
    res.status(getDateRecordStatusCode(error)).json({
      success: false,
      error: error.message,
    });
  }
});

router.put('/date-records/:date/time', async (req, res) => {
  const patchId = crypto.randomUUID();
  const transaction = await sequelize.transaction();

  try {
    const result = await updateDateRecordTime(dateRecordModels, {
      date: req.params.date,
      time: req.body?.time,
      timePrecision: req.body?.timePrecision,
      transaction,
    });

    await createPatchLog({
      patchId,
      mode: 'apply',
      status: 'success',
      reason: `修改日期时间 ${req.params.date}`,
      patch: {
        type: 'date-time-update',
        date: req.params.date,
        time: req.body?.time || null,
        timePrecision: req.body?.timePrecision,
      },
      result,
      req,
      transaction,
    });

    await transaction.commit();
    res.json({
      success: true,
      patchId,
      result,
    });
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }

    try {
      await createPatchLog({
        patchId,
        mode: 'apply',
        status: 'failed',
        reason: `修改日期时间 ${req.params.date}`,
        patch: {
          type: 'date-time-update',
          date: req.params.date,
          time: req.body?.time || null,
          timePrecision: req.body?.timePrecision,
        },
        error,
        req,
      });
    } catch (logError) {
      console.error('写入日期时间修改失败日志失败:', logError);
    }

    console.error('[DATE_RECORDS] time update failed:', error);
    res.status(getDateRecordStatusCode(error)).json({
      success: false,
      patchId,
      error: error.message,
    });
  }
});

router.delete('/date-records/:date', async (req, res) => {
  const patchId = crypto.randomUUID();
  const transaction = await sequelize.transaction();

  try {
    const before = await getDateRecordSummary(dateRecordModels, req.params.date);
    const result = await deleteDateRecords(dateRecordModels, {
      date: req.params.date,
      transaction,
    });

    await createPatchLog({
      patchId,
      mode: 'apply',
      status: 'success',
      reason: `删除日期数据 ${req.params.date}`,
      patch: {
        type: 'date-record-delete',
        date: req.params.date,
      },
      result: {
        before,
        ...result,
      },
      req,
      transaction,
    });

    await transaction.commit();
    res.json({
      success: true,
      patchId,
      before,
      result,
    });
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }

    try {
      await createPatchLog({
        patchId,
        mode: 'apply',
        status: 'failed',
        reason: `删除日期数据 ${req.params.date}`,
        patch: {
          type: 'date-record-delete',
          date: req.params.date,
        },
        error,
        req,
      });
    } catch (logError) {
      console.error('写入日期删除失败日志失败:', logError);
    }

    console.error('[DATE_RECORDS] delete failed:', error);
    res.status(getDateRecordStatusCode(error)).json({
      success: false,
      patchId,
      error: error.message,
    });
  }
});

// 获取所有用户
router.get('/users', async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ['password'] }, // 不返回密码
      order: [['createdAt', 'DESC']]
    });
    
    res.json({
      success: true,
      users: users
    });
  } catch (error) {
    console.error('获取用户列表失败:', error);
    res.status(500).json({
      success: false,
      error: '获取用户列表失败'
    });
  }
});

// 创建新用户
router.post('/users', async (req, res) => {
  try {
    const { username, email, password, role = 'user', status = 'active' } = req.body;

    // 验证必填字段
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        error: '用户名、邮箱和密码为必填项'
      });
    }

    // 检查用户名是否已存在
    const existingUser = await User.findOne({ where: { username } });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: '用户名已存在'
      });
    }

    // 检查邮箱是否已存在
    const existingEmail = await User.findOne({ where: { email } });
    if (existingEmail) {
      return res.status(400).json({
        success: false,
        error: '邮箱已存在'
      });
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 创建用户
    const user = await User.create({
      username,
      email,
      password: hashedPassword,
      role,
      status
    });

    // 返回用户信息（不包含密码）
    const userResponse = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };

    res.status(201).json({
      success: true,
      message: '用户创建成功',
      user: userResponse
    });
  } catch (error) {
    console.error('创建用户失败:', error);
    res.status(500).json({
      success: false,
      error: '创建用户失败'
    });
  }
});

// 更新用户信息
router.put('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, role, status } = req.body;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: '用户不存在'
      });
    }

    // 如果要更新用户名，检查是否与其他用户冲突
    if (username && username !== user.username) {
      const existingUser = await User.findOne({ 
        where: { 
          username,
          id: { [require('sequelize').Op.ne]: id }
        } 
      });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: '用户名已存在'
        });
      }
    }

    // 如果要更新邮箱，检查是否与其他用户冲突
    if (email && email !== user.email) {
      const existingEmail = await User.findOne({ 
        where: { 
          email,
          id: { [require('sequelize').Op.ne]: id }
        } 
      });
      if (existingEmail) {
        return res.status(400).json({
          success: false,
          error: '邮箱已存在'
        });
      }
    }

    // 更新用户信息
    await user.update({
      username: username || user.username,
      email: email || user.email,
      role: role || user.role,
      status: status || user.status
    });

    const userResponse = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };

    res.json({
      success: true,
      message: '用户更新成功',
      user: userResponse
    });
  } catch (error) {
    console.error('更新用户失败:', error);
    res.status(500).json({
      success: false,
      error: '更新用户失败'
    });
  }
});

// 删除用户
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 不能删除自己
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        success: false,
        error: '不能删除自己的账户'
      });
    }

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: '用户不存在'
      });
    }

    await user.destroy();

    res.json({
      success: true,
      message: '用户删除成功'
    });
  } catch (error) {
    console.error('删除用户失败:', error);
    res.status(500).json({
      success: false,
      error: '删除用户失败'
    });
  }
});

// 封禁用户
router.post('/users/:id/ban', async (req, res) => {
  try {
    const { id } = req.params;

    // 不能封禁自己
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        success: false,
        error: '不能封禁自己的账户'
      });
    }

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: '用户不存在'
      });
    }

    await user.update({ status: 'banned' });

    res.json({
      success: true,
      message: '用户已封禁'
    });
  } catch (error) {
    console.error('封禁用户失败:', error);
    res.status(500).json({
      success: false,
      error: '封禁用户失败'
    });
  }
});

// 解封用户
router.post('/users/:id/unban', async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: '用户不存在'
      });
    }

    await user.update({ status: 'active' });

    res.json({
      success: true,
      message: '用户已解封'
    });
  } catch (error) {
    console.error('解封用户失败:', error);
    res.status(500).json({
      success: false,
      error: '解封用户失败'
    });
  }
});

// 获取系统设置
router.get('/settings', async (req, res) => {
  try {
    const settings = getSystemSettings();
    res.json({
      success: true,
      settings: settings
    });
  } catch (error) {
    console.error('获取系统设置失败:', error);
    res.status(500).json({
      success: false,
      error: '获取系统设置失败'
    });
  }
});

// 更新系统设置
router.put('/settings', async (req, res) => {
  try {
    const { registrationEnabled } = req.body;
    
    const newSettings = {};
    if (typeof registrationEnabled === 'boolean') {
      newSettings.registrationEnabled = registrationEnabled;
    }

    const updatedSettings = updateSystemSettings(newSettings);

    res.json({
      success: true,
      message: '系统设置更新成功',
      settings: updatedSettings
    });
  } catch (error) {
    console.error('更新系统设置失败:', error);
    res.status(500).json({
      success: false,
      error: '更新系统设置失败'
    });
  }
});

module.exports = router;
