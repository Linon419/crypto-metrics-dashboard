const assert = require('assert');

const checkFirstRun = require('../middleware/checkFirstRun');
const { validatePassword } = require('../utils/authSecurity');

async function run() {
  const { resolveInitialAdminPassword } = checkFirstRun.__testUtils;

  const configured = resolveInitialAdminPassword('correct horse battery staple');
  assert.strictEqual(configured.password, 'correct horse battery staple');
  assert.strictEqual(configured.source, '环境变量');
  assert.strictEqual(configured.replacedWeakPassword, false);

  const replaced = resolveInitialAdminPassword('123456');
  assert.notStrictEqual(replaced.password, '123456');
  assert.strictEqual(replaced.source, '自动生成');
  assert.strictEqual(replaced.replacedWeakPassword, true);
  assert.doesNotThrow(() => validatePassword(replaced.password));

  const generated = resolveInitialAdminPassword('');
  assert.strictEqual(generated.source, '自动生成');
  assert.strictEqual(generated.replacedWeakPassword, false);
  assert.doesNotThrow(() => validatePassword(generated.password));

  console.log('checkFirstRunSecurity.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
