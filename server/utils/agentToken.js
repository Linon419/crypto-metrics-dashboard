const crypto = require('crypto');

/**
 * 给本地 Agent（Claude Code / Codex skill）用的 Token。
 *
 * - 可以同时存在多枚，各自命名、各自吊销；库里只存 SHA-256，明文只在生成时返回一次
 * - 绑定生成它的管理员：通知按用户存储，Agent 读的是这位管理员的通知；
 *   该账号被封禁、降级或删除后 Token 随之失效
 * - 默认只能 GET 下面白名单里的行情/指标/通知接口，碰不到用户、收藏和管理接口；
 *   生成时勾选「允许写入」的 Token 额外可以 POST /api/data/input 录入原始数据
 * - refresh / force 会触发外部抓取和落库，Agent 一律不允许带
 */

const AGENT_TOKEN_SETTING_KEY = 'agent_api_token';
const AGENT_TOKEN_PREFIX = 'cmagent_';
const MAX_AGENT_TOKEN_NAME_LENGTH = 50;

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
const AGENT_WRITE_ROUTES = [
  /^\/api\/data\/input$/,
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

// 旧版只存一枚 Token 的对象，读出时当作一枚只读 Token
function normalizeStoredTokens(parsed) {
  if (Array.isArray(parsed)) return parsed.filter(item => item?.hash && item?.id);
  if (parsed?.hash) return [{ id: 'legacy', name: '', canWrite: false, ...parsed }];
  return [];
}

async function readStoredTokens(AppSettingModel) {
  if (!AppSettingModel?.findOne) return [];
  const row = await AppSettingModel.findOne({ where: { key: AGENT_TOKEN_SETTING_KEY } });
  const plain = typeof row?.get === 'function' ? row.get({ plain: true }) : row;
  if (!plain?.value) return [];
  try {
    return normalizeStoredTokens(JSON.parse(plain.value));
  } catch {
    return [];
  }
}

async function writeStoredTokens(AppSettingModel, tokens) {
  const value = JSON.stringify(tokens);
  const row = await AppSettingModel.findOne({ where: { key: AGENT_TOKEN_SETTING_KEY } });
  if (row?.update) await row.update({ value });
  else await AppSettingModel.create({ key: AGENT_TOKEN_SETTING_KEY, value });
}

function serializeToken(stored) {
  return {
    id: stored.id,
    name: stored.name || '',
    last4: stored.last4,
    canWrite: stored.canWrite === true,
    createdAt: stored.createdAt,
    createdBy: stored.createdBy,
  };
}

async function listAgentTokens({ AppSettingModel = getAppSettingModel() } = {}) {
  const tokens = await readStoredTokens(AppSettingModel);
  return tokens.map(serializeToken);
}

async function createAgentToken({
  AppSettingModel = getAppSettingModel(),
  ownerUserId,
  createdBy = null,
  name = '',
  canWrite = false,
} = {}) {
  if (!AppSettingModel?.findOne || !AppSettingModel?.create) {
    throw new Error('AppSetting model is unavailable');
  }
  if (!Number.isInteger(ownerUserId) || ownerUserId <= 0) {
    throw new Error('ownerUserId is required');
  }
  const trimmedName = String(name || '').trim();
  if (trimmedName.length > MAX_AGENT_TOKEN_NAME_LENGTH) {
    const error = new Error(`Token 名称最多 ${MAX_AGENT_TOKEN_NAME_LENGTH} 个字符`);
    error.statusCode = 400;
    throw error;
  }

  const token = `${AGENT_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  const stored = {
    id: crypto.randomBytes(8).toString('hex'),
    name: trimmedName,
    hash: hashAgentToken(token),
    last4: token.slice(-4),
    canWrite: canWrite === true,
    createdAt: new Date().toISOString(),
    createdBy,
    ownerUserId,
  };
  const tokens = await readStoredTokens(AppSettingModel);
  await writeStoredTokens(AppSettingModel, [...tokens, stored]);

  return { token, tokenInfo: serializeToken(stored) };
}

// 返回被吊销的 Token 信息；id 不存在时返回 null
async function revokeAgentToken(id, { AppSettingModel = getAppSettingModel() } = {}) {
  if (!AppSettingModel?.findOne) throw new Error('AppSetting model is unavailable');
  const tokens = await readStoredTokens(AppSettingModel);
  const target = tokens.find(item => item.id === id);
  if (!target) return null;
  await writeStoredTokens(AppSettingModel, tokens.filter(item => item.id !== id));
  return serializeToken(target);
}

// 校验通过返回 { id, ownerUserId, canWrite }，否则返回 null
async function verifyAgentToken(token, { AppSettingModel = getAppSettingModel() } = {}) {
  if (!isAgentToken(token)) return null;
  const tokens = await readStoredTokens(AppSettingModel);
  const actual = Buffer.from(hashAgentToken(token), 'hex');
  const matched = tokens.find(stored => {
    const expected = Buffer.from(stored.hash, 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  });
  if (!matched) return null;
  return {
    id: matched.id,
    ownerUserId: matched.ownerUserId ?? null,
    canWrite: matched.canWrite === true,
  };
}

// originalUrl 含查询串；路径和查询分开判断
function isAgentRequestAllowed(method, originalUrl, { canWrite = false } = {}) {
  let routes;
  if (method === 'GET' || method === 'HEAD') routes = AGENT_READ_ROUTES;
  else if (method === 'POST' && canWrite) routes = AGENT_WRITE_ROUTES;
  else return false;

  const rawPath = String(originalUrl || '/').split('?')[0];
  const url = new URL(String(originalUrl || '/'), 'http://localhost');
  // Express 按原始路径路由；含 ../ 或编码的路径规范化后会"变成"白名单路径，一律拒绝
  if (url.pathname !== rawPath) return false;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (!routes.some(pattern => pattern.test(path))) return false;
  return !AGENT_FORBIDDEN_QUERY_KEYS.some(key => url.searchParams.has(key));
}

module.exports = {
  AGENT_TOKEN_PREFIX,
  AGENT_TOKEN_SETTING_KEY,
  createAgentToken,
  isAgentRequestAllowed,
  isAgentToken,
  listAgentTokens,
  revokeAgentToken,
  verifyAgentToken,
};
