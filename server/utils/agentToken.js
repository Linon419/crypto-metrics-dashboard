const crypto = require('crypto');

/**
 * 给本地 Agent（Claude Code / Codex skill）用的只读 Token。
 *
 * - 全站只有一枚，重新生成即吊销旧的；库里只存 SHA-256，明文只在生成时返回一次
 * - 绑定生成它的管理员：通知按用户存储，Agent 读的是这位管理员的通知；
 *   该账号被封禁、降级或删除后 Token 随之失效
 * - 只能 GET 下面白名单里的行情/指标/通知接口，碰不到用户、收藏、管理和写接口
 * - refresh / force 会触发外部抓取和落库，Agent 一律不允许带
 */

const AGENT_TOKEN_SETTING_KEY = 'agent_api_token';
const AGENT_TOKEN_PREFIX = 'cmagent_';

const AGENT_READ_ROUTES = [
  /^\/api\/data\/latest$/,
  /^\/api\/data\/by-date\/[^/]+$/,
  /^\/api\/data\/available-dates$/,
  /^\/api\/coins$/,
  /^\/api\/coins\/[^/]+$/,
  /^\/api\/coins\/[^/]+\/metrics$/,
  /^\/api\/coins\/[^/]+\/klines$/,
  /^\/api\/liquidity$/,
  /^\/api\/liquidity\/[^/]+$/,
  /^\/api\/volatility\/btc$/,
  /^\/api\/volatility\/btc\/history$/,
  /^\/api\/notifications$/,
];
const AGENT_FORBIDDEN_QUERY_KEYS = ['refresh', 'force'];

function getAppSettingModel() {
  try {
    return require('../models').AppSetting;
  } catch {
    return null;
  }
}

function hashAgentToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function isAgentToken(token) {
  return typeof token === 'string' && token.startsWith(AGENT_TOKEN_PREFIX);
}

async function readStoredToken(AppSettingModel) {
  if (!AppSettingModel?.findOne) return null;
  const row = await AppSettingModel.findOne({ where: { key: AGENT_TOKEN_SETTING_KEY } });
  const plain = typeof row?.get === 'function' ? row.get({ plain: true }) : row;
  if (!plain?.value) return null;
  try {
    const stored = JSON.parse(plain.value);
    return stored?.hash ? stored : null;
  } catch {
    return null;
  }
}

async function getAgentTokenStatus({ AppSettingModel = getAppSettingModel() } = {}) {
  const stored = await readStoredToken(AppSettingModel);
  if (!stored) return { active: false };
  return {
    active: true,
    last4: stored.last4,
    createdAt: stored.createdAt,
    createdBy: stored.createdBy,
  };
}

async function createAgentToken({
  AppSettingModel = getAppSettingModel(),
  ownerUserId,
  createdBy = null,
} = {}) {
  if (!AppSettingModel?.findOne || !AppSettingModel?.create) {
    throw new Error('AppSetting model is unavailable');
  }
  if (!Number.isInteger(ownerUserId) || ownerUserId <= 0) {
    throw new Error('ownerUserId is required');
  }

  const token = `${AGENT_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  const stored = {
    hash: hashAgentToken(token),
    last4: token.slice(-4),
    createdAt: new Date().toISOString(),
    createdBy,
    ownerUserId,
  };
  const value = JSON.stringify(stored);
  const row = await AppSettingModel.findOne({ where: { key: AGENT_TOKEN_SETTING_KEY } });
  if (row?.update) await row.update({ value });
  else await AppSettingModel.create({ key: AGENT_TOKEN_SETTING_KEY, value });

  return {
    token,
    status: { active: true, last4: stored.last4, createdAt: stored.createdAt, createdBy },
  };
}

async function revokeAgentToken({ AppSettingModel = getAppSettingModel() } = {}) {
  if (!AppSettingModel?.destroy) throw new Error('AppSetting model is unavailable');
  await AppSettingModel.destroy({ where: { key: AGENT_TOKEN_SETTING_KEY } });
  return { active: false };
}

// 校验通过返回 { ownerUserId }，否则返回 null
async function verifyAgentToken(token, { AppSettingModel = getAppSettingModel() } = {}) {
  if (!isAgentToken(token)) return null;
  const stored = await readStoredToken(AppSettingModel);
  if (!stored) return null;

  const expected = Buffer.from(stored.hash, 'hex');
  const actual = Buffer.from(hashAgentToken(token), 'hex');
  const matches = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  return matches ? { ownerUserId: stored.ownerUserId ?? null } : null;
}

// originalUrl 含查询串；路径和查询分开判断
function isAgentRequestAllowed(method, originalUrl) {
  if (method !== 'GET' && method !== 'HEAD') return false;

  const rawPath = String(originalUrl || '/').split('?')[0];
  const url = new URL(String(originalUrl || '/'), 'http://localhost');
  // Express 按原始路径路由；含 ../ 或编码的路径规范化后会"变成"白名单路径，一律拒绝
  if (url.pathname !== rawPath) return false;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (!AGENT_READ_ROUTES.some(pattern => pattern.test(path))) return false;
  return !AGENT_FORBIDDEN_QUERY_KEYS.some(key => url.searchParams.has(key));
}

module.exports = {
  AGENT_TOKEN_PREFIX,
  AGENT_TOKEN_SETTING_KEY,
  createAgentToken,
  getAgentTokenStatus,
  isAgentRequestAllowed,
  isAgentToken,
  revokeAgentToken,
  verifyAgentToken,
};
