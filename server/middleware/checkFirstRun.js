/**
 * 首次运行检查中间件：
 * - 若数据库中不存在管理员账号，则创建一个管理员账号
 * - 本地运行时未提供 ADMIN_PASSWORD 则使用易于首次登录的初始密码，并提示登录后修改
 * - 对外部署（生产且非本地模式）拒绝用占位值或弱口令创建管理员
 */

const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User } = require('../models');
const { MIN_PASSWORD_LENGTH, validatePassword } = require('../utils/authSecurity');
const { isLocalMode, isPlaceholderSecret } = require('../utils/productionSecrets');

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

function isHardenedDeployment(env = process.env) {
  return env.NODE_ENV === 'production' && !isLocalMode(env);
}

function resolveInitialAdminPassword(configuredPassword, { hardened = false } = {}) {
  if (hardened) {
    if (!configuredPassword) {
      return {
        password: null,
        source: '未配置',
        passwordChangeRecommended: true,
        blockedReason: '对外部署必须显式配置 ADMIN_PASSWORD，不再回退到默认初始密码',
      };
    }
    if (isPlaceholderSecret(configuredPassword)) {
      return {
        password: null,
        source: '环境变量',
        passwordChangeRecommended: true,
        blockedReason: 'ADMIN_PASSWORD 仍是模板占位值，公开仓库中可见',
      };
    }
    if (!passwordMeetsCurrentPolicy(configuredPassword)) {
      return {
        password: null,
        source: '环境变量',
        passwordChangeRecommended: true,
        blockedReason: `ADMIN_PASSWORD 不满足密码策略（至少 ${MIN_PASSWORD_LENGTH} 个字符的独立口令）`,
      };
    }
    return {
      password: configuredPassword,
      source: '环境变量',
      passwordChangeRecommended: false,
      blockedReason: null,
    };
  }

  const password = configuredPassword || DEFAULT_INITIAL_ADMIN_PASSWORD;
  return {
    password,
    source: configuredPassword ? '环境变量' : '默认值',
    passwordChangeRecommended: !passwordMeetsCurrentPolicy(password),
    blockedReason: null,
  };
}

/**
 * 启动期会以 checkFirstRun({}, {}, resolve) 的形式调用，此时 res 不是真正的响应对象，
 * 只能放行让启动流程继续（服务随后会对每个请求重新命中这里并返回 503）。
 */
function sendBootstrapBlocked(res, next) {
  if (res && typeof res.status === 'function') {
    return res.status(503).json({
      error: '服务尚未完成初始化：缺少合规的 ADMIN_PASSWORD 配置',
      code: 'ADMIN_BOOTSTRAP_BLOCKED',
    });
  }
  return next();
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

    const hardened = isHardenedDeployment();
    const passwordResolution = resolveInitialAdminPassword(process.env.ADMIN_PASSWORD, { hardened });

    if (passwordResolution.blockedReason) {
      console.error(`FATAL: 拒绝创建初始管理员账号 —— ${passwordResolution.blockedReason}`);
      console.error('请设置合规的 ADMIN_PASSWORD 后重启服务。');
      // 保持 isFirstRunChecked 为 false，修正配置并重启后可再次尝试初始化
      return sendBootstrapBlocked(res, next);
    }

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
  isHardenedDeployment,
  resolveInitialAdminPassword,
};
