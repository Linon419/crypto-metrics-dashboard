/**
 * 首次运行检查中间件：
 * - 若数据库中不存在管理员账号，则创建一个管理员账号
 * - 本地运行时未提供 ADMIN_PASSWORD 则使用易于首次登录的初始密码，并提示登录后修改
 * - 对外部署（生产且非本地模式）拒绝用占位值或弱口令创建管理员
 */

const bcrypt = require('bcryptjs');
const { User, UserAuditLog } = require('../models');
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
function sendBootstrapBlocked(res, next, message = '服务尚未完成初始化：缺少合规的 ADMIN_PASSWORD 配置') {
  if (res && typeof res.status === 'function') {
    return res.status(503).json({
      error: message,
      code: 'ADMIN_BOOTSTRAP_BLOCKED',
    });
  }
  return next();
}

// 初始化过程中的账号变更必须留痕，否则「恢复」了谁、什么时候恢复的都查不到
async function writeBootstrapAuditLog(target, details) {
  try {
    if (!UserAuditLog?.create) return;
    await UserAuditLog.create({
      actor_user_id: null,
      actor_username: 'system:bootstrap',
      target_user_id: target?.id || null,
      target_username: target?.username || null,
      action: 'auth.bootstrap.recover',
      details: details ? JSON.stringify(details) : null,
      ip_address: null,
    });
  } catch (error) {
    console.error('写入初始化审计日志失败：', error);
  }
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

    // 只按用户名匹配：早先的 username OR email 匹配会让任何邮箱恰好等于 ADMIN_EMAIL
    // （默认 admin@example.com，docker-compose 就是这么传的）的普通账号被静默提权并覆盖密码
    const recoverableAdmin = await User.findOne({
      where: { username: adminUsername },
    });

    if (recoverableAdmin && recoverableAdmin.status === 'banned') {
      // 被封禁的账号可能是管理员刻意处置的，不做静默解封，交给运维显式处理
      console.error(
        `FATAL: 拒绝初始化管理员账号 —— 用户名 ${adminUsername} 的账号处于 banned 状态。` +
        '请先解封该账号，或改用其他 ADMIN_USERNAME 后重启服务。'
      );
      return sendBootstrapBlocked(
        res,
        next,
        '服务尚未完成初始化：目标管理员账号处于封禁状态，需要人工处理'
      );
    }

    if (recoverableAdmin) {
      const previous = {
        role: recoverableAdmin.role,
        status: recoverableAdmin.status,
      };
      await recoverableAdmin.update({
        password: hashedPassword,
        role: 'admin',
        status: 'active',
      });
      console.warn(`系统初始化恢复了管理员账号：${recoverableAdmin.username}`);
      await writeBootstrapAuditLog(recoverableAdmin, {
        reason: '首次运行检查未发现可用管理员，恢复同名账号',
        previousRole: previous.role,
        previousStatus: previous.status,
        passwordSource,
      });
    } else {
      // email 有唯一约束：既然不再按 email 认领他人账号，占用时就留空建号，
      // 邮箱冲突时继续创建账号，保证管理员仍能用 ADMIN_USERNAME 登录
      const emailTaken = adminEmail
        ? Boolean(await User.findOne({ where: { email: adminEmail } }))
        : false;
      if (emailTaken) {
        console.warn(
          `ADMIN_EMAIL(${adminEmail}) 已被其他账号占用，新管理员账号将不设置邮箱，` +
          '请登录后在用户管理中补填。'
        );
      }
      await User.create({
        username: adminUsername,
        email: emailTaken ? null : (adminEmail || null),
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
    // 初始化失败时保留待重试状态；旧实现会置位 isFirstRunChecked 并放行，
    // 任何校验或瞬时数据库错误都会让服务带着 0 个账号启动
    console.error('系统初始化检查失败：', error);
    return sendBootstrapBlocked(res, next, '服务尚未完成初始化：管理员账号初始化失败');
  }
}

module.exports = checkFirstRun;
module.exports.__testUtils = {
  DEFAULT_INITIAL_ADMIN_PASSWORD,
  isHardenedDeployment,
  resolveInitialAdminPassword,
};
