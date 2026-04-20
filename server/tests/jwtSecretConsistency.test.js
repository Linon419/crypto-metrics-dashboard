const assert = require('assert');

const authRoutePath = require.resolve('../routes/auth');
const authMiddlewarePath = require.resolve('../middleware/auth');

function reloadAuthModules() {
  delete require.cache[authRoutePath];
  delete require.cache[authMiddlewarePath];

  const authRouter = require('../routes/auth');
  const authMiddlewareModule = require('../middleware/auth');

  return {
    authRouter,
    authMiddlewareModule,
  };
}

function run() {
  const originalJwtSecret = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;

  const { authRouter, authMiddlewareModule } = reloadAuthModules();
  const routeSecret = authRouter.__authTestUtils?.resolvedJwtSecret;
  const middlewareSecret = authMiddlewareModule.__authTestUtils?.resolvedJwtSecret;

  assert.ok(routeSecret, 'auth route should expose resolved jwt secret for tests');
  assert.ok(middlewareSecret, 'auth middleware should expose resolved jwt secret for tests');
  assert.strictEqual(
    routeSecret,
    middlewareSecret,
    'login token signing secret and auth middleware verification secret must stay identical'
  );

  if (originalJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = originalJwtSecret;
  }

  console.log('jwtSecretConsistency.test.js passed');
}

run();
