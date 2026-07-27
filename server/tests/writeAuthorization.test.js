const assert = require('assert');

/**
 * 写接口权限回归测试。
 *
 * 这些路由挂载在 authMiddleware 之后，但长期以来没有任何角色校验，
 * 任何登录用户（包括对外试用账号）都能改数据甚至覆盖整库。
 * 本测试锁定「哪些接口必须是管理员专属」，防止以后新增路由时漏掉。
 */

function collectRoutes(router) {
  const routes = [];
  (router.stack || []).forEach(layer => {
    if (!layer.route) return;
    const handlers = (layer.route.stack || []).map(entry => entry.handle?.name || '');
    Object.keys(layer.route.methods || {}).forEach(method => {
      routes.push({ method: method.toUpperCase(), path: layer.route.path, handlers });
    });
  });
  return routes;
}

function findRoute(routes, method, path) {
  const match = routes.find(route => route.method === method && route.path === path);
  assert.ok(match, `未找到路由 ${method} ${path}，请确认路径是否被改动`);
  return match;
}

function assertAdminOnly(routes, method, path) {
  const route = findRoute(routes, method, path);
  assert.ok(
    route.handlers.includes('requireAdmin'),
    `${method} ${path} 必须挂载 requireAdmin，当前处理链: [${route.handlers.join(', ')}]`
  );
}

function assertOpenToMembers(routes, method, path) {
  const route = findRoute(routes, method, path);
  assert.ok(
    !route.handlers.includes('requireAdmin'),
    `${method} ${path} 不应限制为管理员专属，否则普通用户无法正常浏览`
  );
}

function run() {
  const coins = collectRoutes(require('../routes/coins'));
  const data = collectRoutes(require('../routes/data'));
  const metrics = collectRoutes(require('../routes/metrics'));
  const liquidity = collectRoutes(require('../routes/liquidity'));

  // 落库、拉外部数据、整库导入导出：全部收敛为管理员专属
  assertAdminOnly(coins, 'POST', '/klines/backfill');
  // 回补任务只有管理员能发起，任务状态里带着日志和错误详情，读接口同样收敛为管理员专属
  assertAdminOnly(coins, 'GET', '/klines/backfill/status');
  assertAdminOnly(data, 'GET', '/debug/date-range');
  assertAdminOnly(coins, 'POST', '/');
  assertAdminOnly(coins, 'PUT', '/:id');
  assertAdminOnly(coins, 'DELETE', '/:id');

  assertAdminOnly(data, 'POST', '/input');
  assertAdminOnly(data, 'GET', '/export-all');
  assertAdminOnly(data, 'POST', '/import-database');
  assertAdminOnly(data, 'POST', '/debug/add-test-data');

  assertAdminOnly(metrics, 'POST', '/');
  assertAdminOnly(metrics, 'PUT', '/:id');
  assertAdminOnly(metrics, 'DELETE', '/:id');

  assertAdminOnly(liquidity, 'POST', '/');
  assertAdminOnly(liquidity, 'DELETE', '/:date');

  // 普通用户的正常浏览路径不能被误伤
  assertOpenToMembers(coins, 'GET', '/');
  assertOpenToMembers(coins, 'GET', '/:symbol');
  assertOpenToMembers(coins, 'GET', '/:symbol/klines');
  assertOpenToMembers(data, 'GET', '/latest');
  assertOpenToMembers(data, 'GET', '/by-date/:date');
  assertOpenToMembers(data, 'GET', '/available-dates');
  assertOpenToMembers(metrics, 'GET', '/');
  assertOpenToMembers(liquidity, 'GET', '/');
  assertOpenToMembers(liquidity, 'GET', '/:date');

  // 兜底：这四个路由文件里不应再出现未加 requireAdmin 的写接口
  const writeMethods = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
  [['coins', coins], ['data', data], ['metrics', metrics], ['liquidity', liquidity]]
    .forEach(([name, routes]) => {
      routes
        .filter(route => writeMethods.has(route.method))
        .forEach(route => {
          assert.ok(
            route.handlers.includes('requireAdmin'),
            `${name}.js 中 ${route.method} ${route.path} 是写接口但未挂载 requireAdmin`
          );
        });
    });

  console.log('writeAuthorization.test.js passed');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
