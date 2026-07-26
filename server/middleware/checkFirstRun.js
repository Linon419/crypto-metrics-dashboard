/**
 * 首次运行检查中间件：
 * - 若数据库中不存在管理员账号，则创建一个管理员账号
 * - 未提供 ADMIN_PASSWORD 时使用易于首次登录的初始密码，并提示登录后修改
 */

const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User } = require('../models');
const { validatePassword } = require('../utils/authSecurity');

let isFirstRunChecked = false;
const DEFAULT_INITIAL_ADMIN_PASSWORD = '123456';

function passwordMeetsCurrentPolicy(password) {
  try {
    validatePassword(password);
    return true;
  } catch {
    return false;
  }
}

function resolveInitialAdminPassword(configuredPassword) {
  const password = configuredPassword || DEFAULT_INITIAL_ADMIN_PASSWORD;
  return {
    password,
    source: configuredPassword ? '环境变量' : '默认值',
    passwordChangeRecommended: !passwordMeetsCurrentPolicy(password),
  };
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

    if (passwordSource === '默认值') {
      console.warn(`首次管理员登录信息：用户名=${adminUsername}，初始密码=${adminPassword}`);
    }
    if (passwordResolution.passwordChangeRecommended) {
      console.warn('当前管理员初始密码较简单，登录后系统会提示修改为至少15个字符的独立口令');
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
  DEFAULT_INITIAL_ADMIN_PASSWORD,
  resolveInitialAdminPassword,
};
