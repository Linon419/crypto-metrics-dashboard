const assert = require('assert');
const {
  AGENT_TOKEN_PREFIX,
  createAgentToken,
  getAgentTokenStatus,
  isAgentRequestAllowed,
  revokeAgentToken,
  verifyAgentToken,
} = require('../utils/agentToken');
const { createAuthMiddleware } = require('../middleware/auth');

/**
 * Agent 只读 Token 回归测试：
 * 这枚 Token 会长期放在本机 skill 的环境变量里，必须锁死为"只读 + 白名单"。
 */

function createAppSettingModel() {
  const rows = new Map();
  return {
    rows,
    async findOne({ where }) {
      const row = rows.get(where.key);
      if (!row) return null;
      return {
        ...row,
        async update(values) {
          rows.set(where.key, { ...rows.get(where.key), ...values });
        },
      };
    },
    async create(values) {
      rows.set(values.key, { ...values });
    },
    async destroy({ where }) {
      rows.delete(where.key);
    },
  };
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function invoke(middleware, { token, method = 'GET', url }) {
  const req = { method, originalUrl: url, headers: { authorization: `Bearer ${token}` } };
  const res = createResponse();
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
}

async function testTokenLifecycle() {
  const AppSettingModel = createAppSettingModel();
  assert.deepStrictEqual(await getAgentTokenStatus({ AppSettingModel }), { active: false });

  await assert.rejects(() => createAgentToken({ AppSettingModel }), /ownerUserId/);

  const { token, status } = await createAgentToken({ AppSettingModel, ownerUserId: 1, createdBy: 'admin' });
  assert.ok(token.startsWith(AGENT_TOKEN_PREFIX));
  assert.strictEqual(status.last4, token.slice(-4));
  assert.ok(!AppSettingModel.rows.get('agent_api_token').value.includes(token), '库里不能存明文');
  assert.deepStrictEqual(await verifyAgentToken(token, { AppSettingModel }), { ownerUserId: 1 });
  assert.strictEqual(await verifyAgentToken(`${token}x`, { AppSettingModel }), null);

  // 重新生成即吊销旧 Token
  const { token: rotated } = await createAgentToken({ AppSettingModel, ownerUserId: 1 });
  assert.strictEqual(await verifyAgentToken(token, { AppSettingModel }), null);
  assert.deepStrictEqual(await verifyAgentToken(rotated, { AppSettingModel }), { ownerUserId: 1 });

  await revokeAgentToken({ AppSettingModel });
  assert.strictEqual(await verifyAgentToken(rotated, { AppSettingModel }), null);
  assert.deepStrictEqual(await getAgentTokenStatus({ AppSettingModel }), { active: false });
}

function testAllowlist() {
  const allowed = [
    '/api/data/latest',
    '/api/data/by-date/2026-09-01',
    '/api/data/available-dates',
    '/api/coins',
    '/api/coins/BTC',
    '/api/coins/BTC/metrics?startDate=2026-08-01&endDate=2026-09-01',
    '/api/coins/BTC/klines?interval=1d&limit=100',
    '/api/liquidity?startDate=2026-08-01',
    '/api/liquidity/2026-09-01',
    '/api/volatility/btc',
    '/api/volatility/btc/history?lookbackHours=72',
    '/api/notifications?limit=20&unreadOnly=true',
  ];
  allowed.forEach(url => assert.strictEqual(isAgentRequestAllowed('GET', url), true, url));

  const denied = [
    ['GET', '/api/admin/users'],
    ['GET', '/api/data/export-all'],
    ['GET', '/api/favorites'],
    ['POST', '/api/notifications'],
    ['POST', '/api/notifications/read-all'],
    ['PATCH', '/api/notifications/5/read'],
    ['GET', '/api/coins/klines/backfill/status'],
    ['GET', '/api/coins/BTC/klines?refresh=1'],
    ['GET', '/api/volatility/btc?refresh=true'],
    ['POST', '/api/data/latest'],
    ['DELETE', '/api/coins/BTC'],
    [undefined, '/ws/klines?symbol=BTC'],
    ['GET', '/api/admin/../data/latest'],
    ['GET', '/api/favorites/%2e%2e/data/latest'],
  ];
  denied.forEach(([method, url]) => (
    assert.strictEqual(isAgentRequestAllowed(method, url), false, `${method} ${url}`)
  ));
}

async function testMiddleware() {
  const AppSettingModel = createAppSettingModel();
  let owner = { id: 7, username: 'boss', role: 'admin', status: 'active' };
  const UserModel = {
    async findByPk(id) {
      return owner && owner.id === id ? owner : null;
    },
  };
  const middleware = createAuthMiddleware({
    UserModel,
    AppSettingModel,
    jwtSecret: 'test-secret-with-enough-length-1234567890',
    allowDevBypass: false,
  });
  const { token } = await createAgentToken({ AppSettingModel, ownerUserId: 7 });

  const accepted = await invoke(middleware, { token, url: '/api/data/latest' });
  assert.strictEqual(accepted.nextCalled, true);
  assert.strictEqual(accepted.req.user.role, 'agent');
  assert.strictEqual(accepted.req.user.agent, true);

  // 通知按用户存储：Agent 以生成 Token 的管理员身份读取
  const notifications = await invoke(middleware, { token, url: '/api/notifications?limit=5' });
  assert.strictEqual(notifications.nextCalled, true);
  assert.strictEqual(notifications.req.user.id, 7);
  assert.notStrictEqual(notifications.req.user.role, 'admin');

  const write = await invoke(middleware, { token, method: 'POST', url: '/api/data/input' });
  assert.strictEqual(write.nextCalled, false);
  assert.strictEqual(write.res.statusCode, 403);

  const admin = await invoke(middleware, { token, url: '/api/admin/users' });
  assert.strictEqual(admin.nextCalled, false);
  assert.strictEqual(admin.res.statusCode, 403);

  const refresh = await invoke(middleware, { token, url: '/api/coins/BTC/klines?refresh=1' });
  assert.strictEqual(refresh.nextCalled, false);
  assert.strictEqual(refresh.res.statusCode, 403);

  const forged = await invoke(middleware, { token: `${AGENT_TOKEN_PREFIX}forged`, url: '/api/data/latest' });
  assert.strictEqual(forged.nextCalled, false);
  assert.strictEqual(forged.res.statusCode, 401);

  // 管理员被降级、封禁或删除后，Token 随之失效
  owner = { ...owner, role: 'user' };
  const demoted = await invoke(middleware, { token, url: '/api/data/latest' });
  assert.strictEqual(demoted.nextCalled, false);
  assert.strictEqual(demoted.res.statusCode, 401);
  owner = { ...owner, role: 'admin', status: 'banned' };
  const banned = await invoke(middleware, { token, url: '/api/data/latest' });
  assert.strictEqual(banned.res.statusCode, 401);
  owner = null;
  const deleted = await invoke(middleware, { token, url: '/api/data/latest' });
  assert.strictEqual(deleted.res.statusCode, 401);
  owner = { id: 7, username: 'boss', role: 'admin', status: 'active' };

  await revokeAgentToken({ AppSettingModel });
  const revoked = await invoke(middleware, { token, url: '/api/data/latest' });
  assert.strictEqual(revoked.nextCalled, false);
  assert.strictEqual(revoked.res.statusCode, 401);
}

async function testNotificationsReadOnly() {
  const { __test: { listUserNotifications } } = require('../routes/notifications');
  const updates = [];
  const row = { id: 1, title: 't', content: 'c', read_at: null, update: async values => updates.push(values) };
  const NotificationModel = {
    async findAll({ where }) {
      assert.strictEqual(where.user_id, 7);
      return [row];
    },
    async count() {
      return 1;
    },
  };
  const result = await listUserNotifications(NotificationModel, 7, { limit: 5 });
  assert.strictEqual(result.notifications.length, 1);
  assert.strictEqual(result.unreadCount, 1);
  assert.deepStrictEqual(updates, [], 'GET 列表不能把通知标为已读');
}

async function run() {
  await testTokenLifecycle();
  testAllowlist();
  await testMiddleware();
  await testNotificationsReadOnly();
  console.log('agentToken tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
