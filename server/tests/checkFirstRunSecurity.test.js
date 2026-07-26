const assert = require('assert');

const checkFirstRun = require('../middleware/checkFirstRun');

async function run() {
  const { resolveInitialAdminPassword } = checkFirstRun.__testUtils;

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

  console.log('checkFirstRunSecurity.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
