/**
 * 生产部署密钥校验：
 * - 拒绝仍是根目录 .env.example 中的模板占位值
 * - 拒绝历史版本硬编码过的弱密钥
 * - 校验范围覆盖 JWT_SECRET 与 AI_SETTINGS_ENCRYPTION_KEY
 *
 * 本地一键启动器（DASHBOARD_LOCAL_MODE=1）只告警不中断，
 * 因为它同样以 NODE_ENV=production 运行，但仅监听回环地址。
 */

const MIN_SECRET_LENGTH = 32;

// 历史版本中出现过的硬编码默认值，长度可能已满足下限，必须单独列出
const KNOWN_BAD_SECRETS = new Set([
  'your-secret-key-change-this-in-production',
  'your-secret-key-should-be-in-env-file',
  'fallback-dev-secret-key-change-in-production',
  'your-secret-key',
]);

// 模板占位值特征。随机生成的密钥命中这些模式的概率可忽略
const PLACEHOLDER_PATTERNS = [
  /please[\s_-]*(generate|set|replace|change|provide|use)/i,
  /change[\s_-]*(me|this|it)\b/i,
  /replace[\s_-]*(me|this|with)\b/i,
  /your[\s_-]*(secret|token|key|password|api)/i,
  /(^|[\s_-])(example|sample|placeholder|dummy|changeit|todo)([\s_-]|$)/i,
  /[\s_-]here$/i,
  /at[\s_-]*least[\s_-]*\d+[\s_-]*chars/i,
];

function isLocalMode(env = process.env) {
  return ['1', 'true', 'yes'].includes(String(env.DASHBOARD_LOCAL_MODE || '').toLowerCase());
}

/**
 * 初始密码是否强制更换。
 * 本地一键启动只监听回环地址、面向单机用户，保留“可关闭提示”的旧行为；
 * 其余部署（Docker、公网、局域网）一律强制。
 */
function isPasswordChangeEnforced(env = process.env) {
  return !isLocalMode(env);
}

function isPlaceholderSecret(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (KNOWN_BAD_SECRETS.has(trimmed)) return true;
  return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(trimmed));
}

/**
 * @returns {{level: 'fatal'|'warn', message: string}|null}
 */
function describeSecretProblem(value, { name, required = false, hint = '' } = {}) {
  const trimmed = typeof value === 'string' ? value.trim() : '';

  if (!trimmed) {
    if (!required) return null;
    return { level: 'fatal', message: `${name} 未设置。${hint}` };
  }

  if (isPlaceholderSecret(trimmed)) {
    return {
      level: 'fatal',
      message: `${name} 仍是模板占位值，公开仓库中可见，等同于没有设置。请替换为随机生成的值。${hint}`,
    };
  }

  if (trimmed.length < MIN_SECRET_LENGTH) {
    return {
      level: required ? 'fatal' : 'warn',
      message: `${name} 长度不足 ${MIN_SECRET_LENGTH} 个字符，建议使用 \`openssl rand -hex 32\` 重新生成。${hint}`,
    };
  }

  return null;
}

function collectSecretProblems(env = process.env) {
  const checks = [
    {
      name: 'JWT_SECRET',
      value: env.JWT_SECRET,
      required: true,
      hint: '更换后所有已签发的登录态会失效，需要重新登录。',
    },
    {
      name: 'AI_SETTINGS_ENCRYPTION_KEY',
      value: env.AI_SETTINGS_ENCRYPTION_KEY,
      required: false,
      hint: '该值用于加密数据库中保存的 AI API Key，更换后需要在「管理后台 → AI 模型」重新填写 API Key。',
    },
  ];

  return checks
    .map(check => {
      const problem = describeSecretProblem(check.value, check);
      return problem ? { name: check.name, ...problem } : null;
    })
    .filter(Boolean);
}

/**
 * 生产环境启动前校验。开发环境直接放行。
 */
function assertProductionSecrets(env = process.env, {
  logger = console,
  onFatal = () => process.exit(1),
} = {}) {
  if (env.NODE_ENV !== 'production') return { ok: true, problems: [] };

  const problems = collectSecretProblems(env);
  if (problems.length === 0) return { ok: true, problems: [] };

  const localMode = isLocalMode(env);
  const fatals = localMode ? [] : problems.filter(problem => problem.level === 'fatal');
  const warnings = localMode ? problems : problems.filter(problem => problem.level === 'warn');

  warnings.forEach(problem => {
    logger.warn(`[安全告警] ${problem.message}`);
  });

  if (localMode && problems.length > 0) {
    logger.warn('[安全告警] 当前为本地模式，以上问题不阻断启动；服务仅监听 127.0.0.1，请勿直接对外暴露。');
  }

  if (fatals.length > 0) {
    fatals.forEach(problem => {
      logger.error(`FATAL: ${problem.message}`);
    });
    logger.error('生产环境启动已中止。请修正上述密钥后重启。');
    onFatal(fatals);
    return { ok: false, problems };
  }

  return { ok: true, problems };
}

module.exports = {
  MIN_SECRET_LENGTH,
  assertProductionSecrets,
  collectSecretProblems,
  describeSecretProblem,
  isLocalMode,
  isPasswordChangeEnforced,
  isPlaceholderSecret,
};
