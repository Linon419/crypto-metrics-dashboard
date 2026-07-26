/**
 * 首次运行检查中间件：
 * - 若数据库中不存在管理员账号，则创建一个管理员账号
 * - 避免使用弱默认口令：未提供 ADMIN_PASSWORD 时生成随机强口令并输出到日志
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { User } = require('../models');
const { validatePassword } = require('../utils/authSecurity');

let isFirstRunChecked = false;

function generateStrongPassword() {
  // base64url：只包含 URL 安全字符，便于复制粘贴
  return crypto.randomBytes(24).toString('base64url');
}

function resolveInitialAdminPassword(configuredPassword) {
  if (configuredPassword) {
    try {
      validatePassword(configuredPassword);
      return { password: configuredPassword, source: '环境变量', replacedWeakPassword: false };
    } catch {
      return { password: generateStrongPassword(), source: '自动生成', replacedWeakPassword: true };
    }
  }
  return { password: generateStrongPassword(), source: '自动生成', replacedWeakPassword: false };
}

async function checkFirstRun(req, res, next) {
  if (isFirstRunChecked) {
    return next();
  }

  try {
    const adminExists = await User.findOne({ where: { role: 'admin', status: 'active' } });
    if (adminExists) {
      console.log('系统初始化检查：已存在管理员账号');
      isFirstRunChecked = true;
      return next();
    }

    console.warn('系统初始化检查：未发现管理员账号，准备创建管理员账号');

    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';

    const passwordResolution = resolveInitialAdminPassword(process.env.ADMIN_PASSWORD);
    const adminPassword = passwordResolution.password;
    const passwordSource = passwordResolution.source;

    if (passwordResolution.replacedWeakPassword) {
      console.warn('ADMIN_PASSWORD 未满足强口令规则，已改用自动生成的管理员初始密码');
    }
    if (passwordSource === '自动生成') {
      console.warn(
        `管理员随机初始密码（请立即保存并尽快修改）：${adminPassword}`
      );
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(adminPassword, salt);

    const recoverableAdmin = await User.findOne({
      where: {
        [Op.or]: [{ username: adminUsername }, { email: adminEmail }],
      },
    });

    if (recoverableAdmin) {
      await recoverableAdmin.update({
        password: hashedPassword,
        role: 'admin',
        status: 'active',
      });
      console.warn(`系统初始化恢复了管理员账号：${recoverableAdmin.username}`);
    } else {
      await User.create({
        username: adminUsername,
        email: adminEmail,
        password: hashedPassword,
        role: 'admin',
        status: 'active',
      });
    }

    console.log(
      `系统初始化完成：管理员账号已创建（用户名：${adminUsername}，密码来源：${passwordSource}）`
    );

    isFirstRunChecked = true;
    return next();
  } catch (error) {
    console.error('系统初始化检查失败：', error);
    isFirstRunChecked = true;
    return next();
  }
}

module.exports = checkFirstRun;
module.exports.__testUtils = {
  generateStrongPassword,
  resolveInitialAdminPassword,
};
