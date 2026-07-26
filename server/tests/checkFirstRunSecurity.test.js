const assert = require('assert');

const checkFirstRun = require('../middleware/checkFirstRun');

async function run() {
  const { isHardenedDeployment, resolveInitialAdminPassword } = checkFirstRun.__testUtils;

  const configured = resolveInitialAdminPassword('correct horse battery staple');
  assert.strictEqual(configured.password, 'correct horse battery staple');
  assert.strictEqual(configured.source, '环境变量');
  assert.strictEqual(configured.passwordChangeRecommended, false);

  const configuredInitial = resolveInitialAdminPassword('123456');
  assert.strictEqual(configuredInitial.password, '123456');
  assert.strictEqual(configuredInitial.source, '环境变量');
  assert.strictEqual(configuredInitial.passwordChangeRecommended, true);

  const defaultInitial = resolveInitialAdminPassword('');
  assert.strictEqual(defaultInitial.password, '123456');
  assert.strictEqual(defaultInitial.source, '默认值');
  assert.strictEqual(defaultInitial.passwordChangeRecommended, true);

  // 对外部署（生产且非本地模式）不允许用弱口令或占位值初始化管理员
  const blockedByDefault = resolveInitialAdminPassword('', { hardened: true });
  assert.strictEqual(blockedByDefault.password, null);
  assert.ok(blockedByDefault.blockedReason.includes('ADMIN_PASSWORD'));

  const blockedByWeak = resolveInitialAdminPassword('123456', { hardened: true });
  assert.strictEqual(blockedByWeak.password, null);
  assert.ok(blockedByWeak.blockedReason.includes('密码策略'));

  const blockedByPlaceholder = resolveInitialAdminPassword('please_set_a_strong_password', { hardened: true });
  assert.strictEqual(blockedByPlaceholder.password, null);
  assert.ok(blockedByPlaceholder.blockedReason.includes('占位值'));

  const hardenedOk = resolveInitialAdminPassword('correct horse battery staple', { hardened: true });
  assert.strictEqual(hardenedOk.password, 'correct horse battery staple');
  assert.strictEqual(hardenedOk.passwordChangeRecommended, false);
  assert.strictEqual(hardenedOk.blockedReason, null);

  // 本地一键启动虽然也是 NODE_ENV=production，但保留简易初始密码
  assert.strictEqual(isHardenedDeployment({ NODE_ENV: 'production' }), true);
  assert.strictEqual(
    isHardenedDeployment({ NODE_ENV: 'production', DASHBOARD_LOCAL_MODE: '1' }),
    false
  );
  assert.strictEqual(isHardenedDeployment({ NODE_ENV: 'development' }), false);

  console.log('checkFirstRunSecurity.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
