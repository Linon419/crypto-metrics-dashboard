// server/routes/admin.js
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const router = express.Router();
const User = require('../models/user');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { getSystemSettings, updateSystemSettings } = require('../utils/settings');

// 管理员中间件 - 验证是否为管理员
router.use(verifyToken);
router.use(requireAdmin);

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