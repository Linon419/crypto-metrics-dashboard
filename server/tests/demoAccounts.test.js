const assert = require('assert');

const {
  enforceDemoReadOnly,
  getDemoUsernames,
  isDemoAccount,
  isDemoAccountMisconfigured,
  isDemoReadOnly,
} = require('../utils/demoAccounts');

function createResponse() {
  const captured = { statusCode: null, body: null };
  return {
    captured,
    res: {
      status(code) { captured.statusCode = code; return this; },
      json(payload) { captured.body = payload; return this; },
    },
  };
}

function withEnv(overrides, fn) {
  const previous = {};
  Object.entries(overrides).forEach(([key, value]) => {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  try {
    return fn();
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
}

function run() {
  const demoEnv = { DEMO_USERNAMES: 'test' };
  const demoUser = { id: 4, username: 'test', role: 'user' };

  // 解析与匹配
  assert.deepStrictEqual(getDemoUsernames({ DEMO_USERNAMES: ' Test , guest ' }), ['test', 'guest']);
  assert.strictEqual(isDemoAccount({ username: 'TEST', role: 'user' }, demoEnv), true);
  assert.strictEqual(isDemoAccount({ username: 'admin', role: 'admin' }, demoEnv), false);
  assert.strictEqual(isDemoAccount({ username: 'test', role: 'user' }, {}), false);
  assert.strictEqual(isDemoAccount({}, demoEnv), false);

  // 管理员不允许被登记为演示账号
  assert.strictEqual(isDemoAccount({ username: 'test', role: 'admin' }, demoEnv), false);
  assert.strictEqual(isDemoAccountMisconfigured({ username: 'test', role: 'admin' }, demoEnv), true);
  assert.strictEqual(isDemoAccountMisconfigured(demoUser, demoEnv), false);

  // 只读开关默认开启
  assert.strictEqual(isDemoReadOnly({}), true);
  assert.strictEqual(isDemoReadOnly({ DEMO_READONLY: 'false' }), false);
  assert.strictEqual(isDemoReadOnly({ DEMO_READONLY: '0' }), false);
  assert.strictEqual(isDemoReadOnly({ DEMO_READONLY: 'true' }), true);

  withEnv({ DEMO_USERNAMES: 'test', DEMO_READONLY: undefined }, () => {
    // 读接口放行
    {
      const { captured, res } = createResponse();
      let nextCalled = false;
      enforceDemoReadOnly({ method: 'GET', baseUrl: '/api/coins', path: '/', user: demoUser }, res, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, true);
      assert.strictEqual(captured.statusCode, null);
    }

    // 落库类写接口一律拦截
    const blocked = [
      ['POST', '/api/data', '/import-database'],
      ['POST', '/api/data', '/input'],
      ['POST', '/api/coins', '/'],
      ['DELETE', '/api/coins', '/12'],
      ['POST', '/api/coins', '/klines/backfill'],
      ['PUT', '/api/metrics', '/3'],
      ['DELETE', '/api/liquidity', '/2026-07-26'],
    ];
    blocked.forEach(([method, baseUrl, path]) => {
      const { captured, res } = createResponse();
      let nextCalled = false;
      enforceDemoReadOnly({ method, baseUrl, path, user: demoUser }, res, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, false, `${method} ${baseUrl}${path} 不应放行`);
      assert.strictEqual(captured.statusCode, 403);
      assert.strictEqual(captured.body.code, 'DEMO_ACCOUNT_READ_ONLY');
    });

    // 不落库或仅影响自身的操作放行，否则演示体验会被削掉一半
    const allowed = [
      ['POST', '/api/options', '/btc/payoff'],
      ['POST', '/api/favorites', '/'],
      ['DELETE', '/api/favorites', '/BTC'],
      ['PATCH', '/api/notifications', '/42/read'],
      ['POST', '/api/notifications', '/read-all'],
    ];
    allowed.forEach(([method, baseUrl, path]) => {
      const { captured, res } = createResponse();
      let nextCalled = false;
      enforceDemoReadOnly({ method, baseUrl, path, user: demoUser }, res, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, true, `${method} ${baseUrl}${path} 应放行`);
      assert.strictEqual(captured.statusCode, null);
    });

    // 白名单必须精确匹配，不能被前缀相同的路径蹭进来
    ['/btc/payoff/../../data/input', '/btc/payoffx'].forEach(path => {
      const { captured, res } = createResponse();
      let nextCalled = false;
      enforceDemoReadOnly({ method: 'POST', baseUrl: '/api/options', path, user: demoUser }, res, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, false, `POST /api/options${path} 不应放行`);
      assert.strictEqual(captured.statusCode, 403);
    });

    // 非演示账号不受影响
    {
      const { res } = createResponse();
      let nextCalled = false;
      enforceDemoReadOnly(
        { method: 'POST', user: { id: 1, username: 'admin', role: 'admin' } },
        res,
        () => { nextCalled = true; }
      );
      assert.strictEqual(nextCalled, true);
    }
  });

  // 未配置 DEMO_USERNAMES 时该机制完全不生效
  withEnv({ DEMO_USERNAMES: undefined }, () => {
    const { res } = createResponse();
    let nextCalled = false;
    enforceDemoReadOnly({ method: 'POST', user: demoUser }, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true);
  });

  // 显式关闭只读后允许写入
  withEnv({ DEMO_USERNAMES: 'test', DEMO_READONLY: 'false' }, () => {
    const { res } = createResponse();
    let nextCalled = false;
    enforceDemoReadOnly({ method: 'POST', user: demoUser }, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true);
  });

  console.log('demoAccounts.test.js passed');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
