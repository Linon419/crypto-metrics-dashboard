const assert = require('assert');

const UserAuth = require('../../telegram-bot/user-auth');

async function run() {
  const originals = {
    getUserAuthenticatedAxios: UserAuth.getUserAuthenticatedAxios,
    getUserCredentials: UserAuth.getUserCredentials,
    loginUser: UserAuth.loginUser,
    clearUserCredentials: UserAuth.clearUserCredentials,
  };
  let axiosRequestCount = 0;
  let loginCount = 0;
  let clearCount = 0;

  UserAuth.getUserAuthenticatedAxios = async () => ({
    async get() {
      axiosRequestCount += 1;
      if (axiosRequestCount === 1) {
        const error = new Error('Unauthorized');
        error.response = { status: 401 };
        throw error;
      }
      return { data: { success: true } };
    },
  });
  UserAuth.getUserCredentials = async () => ({
    username: 'dashboard-user',
    password: 'stored-password',
  });
  UserAuth.loginUser = async () => {
    loginCount += 1;
    return { success: true, token: 'refreshed-token' };
  };
  UserAuth.clearUserCredentials = async () => {
    clearCount += 1;
  };

  try {
    const result = await UserAuth.makeUserAuthenticatedRequest(123, 'get', '/data/latest');
    assert.deepStrictEqual(result, { success: true });
    assert.strictEqual(loginCount, 1);
    assert.strictEqual(clearCount, 0);
    assert.strictEqual(axiosRequestCount, 2);

    axiosRequestCount = 0;
    UserAuth.loginUser = async () => ({ success: false, status: 401, error: 'Invalid credentials' });
    await assert.rejects(
      () => UserAuth.makeUserAuthenticatedRequest(123, 'get', '/data/latest'),
      /Unauthorized/
    );
    assert.strictEqual(clearCount, 1);
  } finally {
    Object.assign(UserAuth, originals);
  }

  console.log('telegramUserAuth.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
