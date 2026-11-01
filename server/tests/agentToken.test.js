const assert = require('assert');
const {
  AGENT_TOKEN_PREFIX,
  createAgentToken,
  isAgentRequestAllowed,
  listAgentTokens,
  revokeAgentToken,
  verifyAgentToken,
} = require('../utils/agentToken');
const { createAuthMiddleware, requireAdminOrAgentWriter } = require('../middleware/auth');

/**
 * Agent Token 回归测试：
 * Token 会长期放在本机 skill 的环境变量里，必须锁死为"白名单"：
 * 默认只读，勾选写入的 Token 也只能多调一个录入接口。
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
  assert.deepStrictEqual(await listAgentTokens({ AppSettingModel }), []);

  await assert.rejects(() => createAgentToken({ AppSettingModel }), /ownerUserId/);
  await assert.rejects(
    () => createAgentToken({ AppSettingModel, ownerUserId: 1, name: 'x'.repeat(51) }),
    error => error.statusCode === 400
  );

  const first = await createAgentToken({ AppSettingModel, ownerUserId: 1, createdBy: 'admin', name: ' MacBook ' });
  assert.ok(first.token.startsWith(AGENT_TOKEN_PREFIX));
  assert.strictEqual(first.tokenInfo.last4, first.token.slice(-4));
  assert.strictEqual(first.tokenInfo.name, 'MacBook');
  assert.strictEqual(first.tokenInfo.canWrite, false, '默认只读');
  assert.ok(!AppSettingModel.rows.get('agent_api_token').value.includes(first.token), '库里不能存明文');
  assert.deepStrictEqual(
    await verifyAgentToken(first.token, { AppSettingModel }),
    { id: first.tokenInfo.id, ownerUserId: 1, canWrite: false }
  );
  assert.strictEqual(await verifyAgentToken(`${first.token}x`, { AppSettingModel }), null);

  // 多枚 Token 并存，各自的权限独立
  const second = await createAgentToken({ AppSettingModel, ownerUserId: 1, canWrite: true });
  assert.notStrictEqual(second.tokenInfo.id, first.tokenInfo.id);
  assert.strictEqual((await verifyAgentToken(first.token, { AppSettingModel })).canWrite, false);
  assert.strictEqual((await verifyAgentToken(second.token, { AppSettingModel })).canWrite, true);
  const listed = await listAgentTokens({ AppSettingModel });
  assert.deepStrictEqual(listed.map(item => item.id), [first.tokenInfo.id, second.tokenInfo.id]);
  assert.ok(listed.every(item => !('hash' in item) && !('ownerUserId' in item)), '列表不返回哈希');

  // 只有字面 true 才算勾选写入
  const truthy = await createAgentToken({ AppSettingModel, ownerUserId: 1, canWrite: 'true' });
  assert.strictEqual(truthy.tokenInfo.canWrite, false);

  // 吊销一枚不影响其他
  assert.strictEqual((await revokeAgentToken(first.tokenInfo.id, { AppSettingModel })).id, first.tokenInfo.id);
  assert.strictEqual(await verifyAgentToken(first.token, { AppSettingModel }), null);
  assert.ok(await verifyAgentToken(second.token, { AppSettingModel }));
  assert.strictEqual(await revokeAgentToken('missing', { AppSettingModel }), null);
  await revokeAgentToken(second.tokenInfo.id, { AppSettingModel });
  await revokeAgentToken(truthy.tokenInfo.id, { AppSettingModel });
  assert.deepStrictEqual(await listAgentTokens({ AppSettingModel }), []);
}

// 升级前库里存的是单个对象，升级后原 Token 必须继续可用、且仍是只读
async function testLegacySingleToken() {
  const AppSettingModel = createAppSettingModel();
  const { token, tokenInfo } = await createAgentToken({ AppSettingModel, ownerUserId: 3, createdBy: 'admin' });
  const [{ id, name, canWrite, ...legacy }] = JSON.parse(AppSettingModel.rows.get('agent_api_token').value);
  AppSettingModel.rows.set('agent_api_token', { key: 'agent_api_token', value: JSON.stringify(legacy) });

  assert.deepStrictEqual(
    await verifyAgentToken(token, { AppSettingModel }),
    { id: 'legacy', ownerUserId: 3, canWrite: false }
  );
  assert.deepStrictEqual(await listAgentTokens({ AppSettingModel }), [{
    id: 'legacy',
    name: '',
    last4: tokenInfo.last4,
    canWrite: false,
    createdAt: tokenInfo.createdAt,
    createdBy: 'admin',
  }]);

  // 新增一枚后旧 Token 依然有效
  await createAgentToken({ AppSettingModel, ownerUserId: 3 });
  assert.ok(await verifyAgentToken(token, { AppSettingModel }));
  await revokeAgentToken('legacy', { AppSettingModel });
  assert.strictEqual(await verifyAgentToken(token, { AppSettingModel }), null);
  assert.strictEqual((await listAgentTokens({ AppSettingModel })).length, 1);
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

  // 写入权限只多放行 POST /api/data/input，其他写接口依旧拒绝
  const writer = { canWrite: true };
  assert.strictEqual(isAgentRequestAllowed('POST', '/api/data/input'), false);
  assert.strictEqual(isAgentRequestAllowed('POST', '/api/data/input', writer), true);
  allowed.forEach(url => assert.strictEqual(isAgentRequestAllowed('GET', url, writer), true, url));
  [
    ['GET', '/api/data/input'],
    ['PUT', '/api/data/input'],
    ['POST', '/api/data/input?force=1'],
    ['POST', '/api/data/import-database'],
    ['POST', '/api/metrics'],
    ['POST', '/api/notifications'],
    ['POST', '/api/admin/agent-token'],
    ['POST', '/api/admin/../data/input'],
    ['POST', '/api/data/%69nput'],
  ].concat(denied).forEach(([method, url]) => (
    assert.strictEqual(isAgentRequestAllowed(method, url, writer), false, `writer ${method} ${url}`)
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

  // 勾选写入的 Token 能录入，但身份仍是 agent，过不了 requireAdmin
  const { token: writerToken } = await createAgentToken({ AppSettingModel, ownerUserId: 7, canWrite: true });
  const writerInput = await invoke(middleware, { token: writerToken, method: 'POST', url: '/api/data/input' });
  assert.strictEqual(writerInput.nextCalled, true);
  assert.strictEqual(writerInput.req.user.role, 'agent');
  assert.strictEqual(writerInput.req.user.agentCanWrite, true);
  const writerAdmin = await invoke(middleware, { token: writerToken, method: 'POST', url: '/api/admin/agent-token' });
  assert.strictEqual(writerAdmin.res.statusCode, 403);

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

  const [readerInfo] = await listAgentTokens({ AppSettingModel });
  await revokeAgentToken(readerInfo.id, { AppSettingModel });
  const revoked = await invoke(middleware, { token, url: '/api/data/latest' });
  assert.strictEqual(revoked.nextCalled, false);
  assert.strictEqual(revoked.res.statusCode, 401);
  const stillValid = await invoke(middleware, { token: writerToken, url: '/api/data/latest' });
  assert.strictEqual(stillValid.nextCalled, true, '吊销一枚不影响另一枚');
}

function testRequireAdminOrAgentWriter() {
  const run = (user) => {
    const res = createResponse();
    let nextCalled = false;
    requireAdminOrAgentWriter({ user }, res, () => { nextCalled = true; });
    return { nextCalled, statusCode: res.statusCode };
  };
  assert.strictEqual(run({ role: 'admin', status: 'active' }).nextCalled, true);
  assert.strictEqual(run({ role: 'agent', status: 'active', agent: true, agentCanWrite: true }).nextCalled, true);
  assert.strictEqual(run({ role: 'agent', status: 'active', agent: true, agentCanWrite: false }).statusCode, 403);
  // 普通用户伪造不出 agent 标记（req.user 由鉴权中间件生成），这里仍确认非 agent 不会被放行
  assert.strictEqual(run({ role: 'user', status: 'active', agentCanWrite: true }).statusCode, 403);
  assert.strictEqual(run(undefined).statusCode, 401);
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
  await testLegacySingleToken();
  testAllowlist();
  await testMiddleware();
  testRequireAdminOrAgentWriter();
  await testNotificationsReadOnly();
  console.log('agentToken tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
