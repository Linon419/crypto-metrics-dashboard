const assert = require('assert');

const publicRouter = require('../routes/public');

function getRoute(path) {
  const layer = (publicRouter.stack || []).find(entry => entry.route?.path === path);
  assert.ok(layer, `未找到公开路由 ${path}`);
  return layer.route;
}

function getHandlerNames(path) {
  return getRoute(path).stack.map(layer => layer.handle?.name || '');
}

function run() {
  const registrationHandlers = getHandlerNames('/registration-status');
  assert.strictEqual(
    registrationHandlers.includes('authMiddleware'),
    false,
    '注册状态必须保持匿名可访问',
  );
  assert.strictEqual(
    registrationHandlers.includes('requireAdmin'),
    false,
    '注册状态必须保持匿名可访问',
  );

  ['/top-otc-crypto', '/bottom-otc-crypto'].forEach(path => {
    const handlers = getHandlerNames(path);
    assert.deepStrictEqual(
      handlers.slice(0, 2),
      ['authMiddleware', 'requireAdmin'],
      `${path} 必须按 JWT 验证、管理员校验的顺序执行，当前处理链: [${handlers.join(', ')}]`,
    );
  });

  console.log('publicAuthorization.test.js passed');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
