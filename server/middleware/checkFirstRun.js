/**
 * 首次运行检查中间件
 * 检查数据库是否存在管理员账户，如果不存在则创建默认管理员
 */

const bcrypt = require('bcryptjs');
const { User } = require('../models');

let isFirstRunChecked = false;

/**
 * 检查是否是首次运行并初始化管理员账户
 */
async function checkFirstRun(req, res, next) {
  // 跳过已经检查过的情况
  if (isFirstRunChecked) {
    return next();
  }

  try {
    // 检查是否有任何管理员账户
    const adminExists = await User.findOne({
      where: { role: 'admin' }
    });

    // 如果已存在管理员账户，标记已检查并继续
    if (adminExists) {
      console.log('系统检查: 已存在管理员账户');
      isFirstRunChecked = true;
      return next();
    }

    // 如果没有管理员账户，创建一个
    console.log('系统检查: 未发现管理员账户，正在创建默认管理员...');

    // 从环境变量获取管理员凭据，如果未设置则使用默认值
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';

    // 密码加密
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(adminPassword, salt);

    // 创建管理员用户
    await User.create({
      username: adminUsername,
      email: adminEmail,
      password: hashedPassword,
      role: 'admin',
      is_active: true
    });

    console.log(`系统初始化: 默认管理员账户创建成功 - 用户名: ${adminUsername}`);
    
    // 标记已检查
    isFirstRunChecked = true;
    
    next();
  } catch (error) {
    console.error('系统初始化检查失败:', error);
    // 即使检查失败也继续应用流程，不应该阻止应用运行
    isFirstRunChecked = true;
    next();
  }
}

module.exports = checkFirstRun;