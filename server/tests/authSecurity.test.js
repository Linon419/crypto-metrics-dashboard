const assert = require('assert');
const bcrypt = require('bcryptjs');

const {
  signAuthToken,
  validatePassword,
} = require('../utils/authSecurity');
const {
  authenticateUser,
  changeOwnPassword,
} = require('../services/authService');
const { createLoginAttemptLimiter } = require('../utils/loginAttemptLimiter');
const { createAuthMiddleware } = require('../middleware/auth');

function createUser(overrides = {}) {
  return {
    id: 1,
    username: 'admin',
    email: 'admin@example.com',
    password: bcrypt.hashSync('correct horse battery staple', 10),
    role: 'admin',
    status: 'active',
    lastLogin: null,
    async update(values) {
      Object.assign(this, values);
      return this;
    },
    get() {
      return this;
    },
    ...overrides,
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
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function invokeMiddleware(middleware, token) {
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = createResponse();
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  return { req, res, nextCalled };
}

async function run() {
  const jwtSecret = 'test-secret-with-at-least-32-characters';
  let currentUser = createUser();
  const UserModel = {
    async findByPk(id) {
      return currentUser?.id === Number(id) ? currentUser : null;
    },
    async findOne({ where }) {
      return currentUser?.username === where.username ? currentUser : null;
    },
  };

  const middleware = createAuthMiddleware({
    UserModel,
    jwtSecret,
    allowDevBypass: false,
  });
  const token = signAuthToken(currentUser, { jwtSecret });

  const accepted = await invokeMiddleware(middleware, token);
  assert.strictEqual(accepted.nextCalled, true);
  assert.strictEqual(accepted.req.user.role, 'admin');

  currentUser.status = 'banned';
  const banned = await invokeMiddleware(middleware, token);
  assert.strictEqual(banned.nextCalled, false);
  assert.strictEqual(banned.res.statusCode, 401);

  currentUser.status = 'active';
  currentUser.role = 'user';
  const demoted = await invokeMiddleware(middleware, token);
  assert.strictEqual(demoted.nextCalled, false);
  assert.strictEqual(demoted.res.statusCode, 401);

  currentUser = null;
  const deleted = await invokeMiddleware(middleware, token);
  assert.strictEqual(deleted.nextCalled, false);
  assert.strictEqual(deleted.res.statusCode, 401);

  currentUser = createUser();
  const loginResult = await authenticateUser({ UserModel }, {
    username: 'admin',
    password: 'correct horse battery staple',
    ip: '127.0.0.1',
  });
  assert.ok(loginResult.token);
  assert.ok(currentUser.lastLogin instanceof Date);
  assert.strictEqual(loginResult.user.status, 'active');
  assert.strictEqual(loginResult.user.passwordChangeRecommended, false);

  currentUser.status = 'inactive';
  await assert.rejects(
    () => authenticateUser({ UserModel }, {
      username: 'admin',
      password: 'correct horse battery staple',
      ip: '127.0.0.1',
    }),
    error => error.statusCode === 401 && error.message === 'Invalid credentials'
  );

  assert.throws(() => validatePassword('short123'), /至少/);
  assert.doesNotThrow(() => validatePassword('correct horse battery staple'));

  currentUser.status = 'active';
  currentUser.role = 'admin';
  const oldToken = signAuthToken(currentUser, { jwtSecret });
  await changeOwnPassword({ UserModel }, currentUser.id, {
    currentPassword: 'correct horse battery staple',
    newPassword: 'a newly secured passphrase',
  });
  const passwordChanged = await invokeMiddleware(middleware, oldToken);
  assert.strictEqual(passwordChanged.nextCalled, false);
  assert.strictEqual(passwordChanged.res.statusCode, 401);

  let now = 1_000;
  const limiter = createLoginAttemptLimiter({
    maxAccountFailures: 2,
    maxIpFailures: 4,
    windowMs: 60_000,
    blockMs: 30_000,
    now: () => now,
  });
  limiter.recordFailure({ username: 'admin', ip: '127.0.0.1' });
  assert.strictEqual(limiter.check({ username: 'admin', ip: '127.0.0.1' }).allowed, true);
  limiter.recordFailure({ username: 'admin', ip: '127.0.0.1' });
  assert.strictEqual(limiter.check({ username: 'admin', ip: '127.0.0.1' }).allowed, false);
  now += 31_000;
  assert.strictEqual(limiter.check({ username: 'admin', ip: '127.0.0.1' }).allowed, true);

  const invalidInputLimiter = createLoginAttemptLimiter({
    maxAccountFailures: 2,
    maxIpFailures: 3,
  });
  await assert.rejects(
    () => authenticateUser({ UserModel, limiter: invalidInputLimiter }, {
      username: 'x',
      password: '',
      ip: '192.0.2.1',
    }),
    error => error.statusCode === 401
  );
  assert.deepStrictEqual(invalidInputLimiter.getTrackedEntryCounts(), { accounts: 1, ips: 1 });
  await assert.rejects(
    () => authenticateUser({ UserModel, limiter: invalidInputLimiter }, {
      username: 'x',
      password: '',
      ip: '192.0.2.1',
    }),
    error => error.statusCode === 401
  );
  await assert.rejects(
    () => authenticateUser({ UserModel, limiter: invalidInputLimiter }, {
      username: 'x',
      password: '',
      ip: '192.0.2.1',
    }),
    error => error.statusCode === 429
  );

  const boundedLimiter = createLoginAttemptLimiter({
    maxAccountFailures: 50,
    maxIpFailures: 50,
    maxTrackedEntries: 2,
  });
  boundedLimiter.recordFailure({ username: 'one', ip: '192.0.2.1' });
  boundedLimiter.recordFailure({ username: 'two', ip: '192.0.2.2' });
  boundedLimiter.recordFailure({ username: 'three', ip: '192.0.2.3' });
  assert.deepStrictEqual(boundedLimiter.getTrackedEntryCounts(), { accounts: 2, ips: 2 });

  currentUser = createUser({
    password: bcrypt.hashSync('123456', 10),
  });
  const initialPasswordLogin = await authenticateUser({ UserModel, jwtSecret }, {
    username: 'admin',
    password: '123456',
    ip: '127.0.0.1',
  });
  assert.strictEqual(initialPasswordLogin.user.passwordChangeRecommended, true);
  const initialPasswordSession = await invokeMiddleware(middleware, initialPasswordLogin.token);
  assert.strictEqual(initialPasswordSession.nextCalled, true);
  assert.strictEqual(initialPasswordSession.req.user.passwordChangeRecommended, true);

  console.log('authSecurity.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
