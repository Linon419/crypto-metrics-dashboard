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

    // 403 PASSWORD_CHANGE_REQUIRED：通知用户如何解决，且 6 小时内不重复提醒
    const notifications = [];
    UserAuth.setUserNotifier(async (chatId, message) => {
      notifications.push({ chatId, message });
    });
    UserAuth.notifiedActionableErrors = new Map();
    UserAuth.getUserAuthenticatedAxios = async () => ({
      async get() {
        const error = new Error('Forbidden');
        error.response = { status: 403, data: { code: 'PASSWORD_CHANGE_REQUIRED' } };
        throw error;
      },
    });

    await assert.rejects(() => UserAuth.makeUserAuthenticatedRequest(456, 'get', '/data/latest'));
    await assert.rejects(() => UserAuth.makeUserAuthenticatedRequest(456, 'get', '/favorites'));
    assert.strictEqual(notifications.length, 1, '同一错误码应只提醒一次');
    assert.strictEqual(notifications[0].chatId, 456);
    assert.ok(notifications[0].message.includes('初始密码'));
    assert.ok(notifications[0].message.includes('/auth'));

    // 不同 chatId 独立提醒；无法识别的 403 不打扰用户
    await assert.rejects(() => UserAuth.makeUserAuthenticatedRequest(789, 'get', '/data/latest'));
    assert.strictEqual(notifications.length, 2);
    UserAuth.getUserAuthenticatedAxios = async () => ({
      async get() {
        const error = new Error('Forbidden');
        error.response = { status: 403, data: { error: 'Admin access required' } };
        throw error;
      },
    });
    await assert.rejects(() => UserAuth.makeUserAuthenticatedRequest(456, 'get', '/data/input'));
    assert.strictEqual(notifications.length, 2, '未知 403 不应产生用户提醒');

    // 通知回调抛错不得影响原始错误的抛出
    UserAuth.notifiedActionableErrors = new Map();
    UserAuth.setUserNotifier(async () => { throw new Error('telegram send failed'); });
    UserAuth.getUserAuthenticatedAxios = async () => ({
      async get() {
        const error = new Error('Forbidden');
        error.response = { status: 403, data: { code: 'PASSWORD_CHANGE_REQUIRED' } };
        throw error;
      },
    });
    await assert.rejects(
      () => UserAuth.makeUserAuthenticatedRequest(456, 'get', '/data/latest'),
      /Forbidden/
    );
  } finally {
    UserAuth.setUserNotifier(null);
    UserAuth.notifiedActionableErrors = new Map();
    Object.assign(UserAuth, originals);
  }

  console.log('telegramUserAuth.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
