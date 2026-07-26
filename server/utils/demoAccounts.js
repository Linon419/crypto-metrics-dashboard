/**
 * 演示账号：允许对外部署保留一个供人试用的弱口令账号。
 *
 * 账号名通过 DEMO_USERNAMES 配置（逗号分隔），凭据本身不写入仓库。
 * 演示账号豁免强制改密闸门，同时默认降为只读，避免公开口令带来写入与删除风险。
 *
 * 安全边界：
 * - 管理员角色不允许被登记为演示账号，避免误配把后台完全敞开
 * - 只读拦截作用于所有非安全 HTTP 方法（GET/HEAD/OPTIONS 之外）
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 演示账号仍然允许的非安全方法。
 * 收录标准：不落库、或只影响该账号自身的数据。
 * 期权收益曲线用 POST 传参但只做计算，是演示的主要内容之一，必须放行。
 */
const DEMO_WRITE_ALLOWLIST = [
  { method: 'POST', pattern: /^\/api\/options\/btc\/payoff\/?$/ },
  { method: 'POST', pattern: /^\/api\/favorites\/?$/ },
  { method: 'DELETE', pattern: /^\/api\/favorites\/[^/]+\/?$/ },
  { method: 'PATCH', pattern: /^\/api\/notifications\/[^/]+\/read\/?$/ },
  { method: 'POST', pattern: /^\/api\/notifications\/read-all\/?$/ },
];

/**
 * 中间件挂载在子路径上时 req.path 已被剥掉前缀，需要拼回 baseUrl 才能匹配完整路径。
 */
function resolveRequestPath(req) {
  const base = req.baseUrl || '';
  const rest = req.path || '';
  const joined = `${base}${rest}` || String(req.originalUrl || '').split('?')[0];
  return joined.replace(/\/{2,}/g, '/');
}

function isAllowedDemoWrite(req) {
  const method = String(req.method || '').toUpperCase();
  const path = resolveRequestPath(req);
  return DEMO_WRITE_ALLOWLIST.some(rule => rule.method === method && rule.pattern.test(path));
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);
}

function getDemoUsernames(env = process.env) {
  return parseList(env.DEMO_USERNAMES);
}

function isDemoReadOnly(env = process.env) {
  // 默认只读；显式设置 DEMO_READONLY=false 才放开写权限
  return !['false', '0', 'no'].includes(String(env.DEMO_READONLY ?? '').toLowerCase());
}

/**
 * 管理员角色永远不算演示账号，即使被写进 DEMO_USERNAMES。
 */
function isDemoAccount(user, env = process.env) {
  const username = String(user?.username || '').trim().toLowerCase();
  if (!username) return false;
  if (!getDemoUsernames(env).includes(username)) return false;
  if (user?.role === 'admin') return false;
  return true;
}

function isDemoAccountMisconfigured(user, env = process.env) {
  const username = String(user?.username || '').trim().toLowerCase();
  if (!username) return false;
  return getDemoUsernames(env).includes(username) && user?.role === 'admin';
}

/**
 * 演示账号只读闸门。放在鉴权之后、业务路由之前。
 */
function enforceDemoReadOnly(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!isDemoAccount(req.user)) return next();
  if (!isDemoReadOnly()) return next();
  if (isAllowedDemoWrite(req)) return next();

  return res.status(403).json({
    error: '演示账号为只读模式，无法执行写入操作',
    code: 'DEMO_ACCOUNT_READ_ONLY',
  });
}

module.exports = {
  DEMO_WRITE_ALLOWLIST,
  SAFE_METHODS,
  enforceDemoReadOnly,
  isAllowedDemoWrite,
  getDemoUsernames,
  isDemoAccount,
  isDemoAccountMisconfigured,
  isDemoReadOnly,
};
