const assert = require('assert');

const {
  assertProductionSecrets,
  collectSecretProblems,
  isPasswordChangeEnforced,
  isPlaceholderSecret,
} = require('../utils/productionSecrets');

const STRONG_SECRET = 'f3a9c1d7e5b204689a1c3f7d2e8b40597c6d1a2f8e3b5904d7c6a1b2e3f40598';

function createLogger() {
  const errors = [];
  const warnings = [];
  return {
    logger: {
      error: message => errors.push(message),
      warn: message => warnings.push(message),
      log: () => {},
    },
    errors,
    warnings,
  };
}

function run() {
  // 仓库模板里实际出现过的占位值必须被识别
  assert.strictEqual(isPlaceholderSecret('please_generate_a_strong_secret_at_least_32_chars'), true);
  assert.strictEqual(isPlaceholderSecret('please_generate_another_stable_secret'), true);
  assert.strictEqual(isPlaceholderSecret('please_set_a_strong_token'), true);
  assert.strictEqual(isPlaceholderSecret('your_openai_api_key_here'), true);
  assert.strictEqual(isPlaceholderSecret('local-one-click-dashboard-secret-change-me-2026'), true);
  // 历史硬编码值
  assert.strictEqual(isPlaceholderSecret('your-secret-key-change-this-in-production'), true);
  // 随机密钥不应被误判
  assert.strictEqual(isPlaceholderSecret(STRONG_SECRET), false);
  assert.strictEqual(isPlaceholderSecret(''), false);
  assert.strictEqual(isPlaceholderSecret(undefined), false);

  // 占位 JWT_SECRET 长度足够，旧逻辑会放行，新逻辑必须拦截
  const placeholderProblems = collectSecretProblems({
    JWT_SECRET: 'please_generate_a_strong_secret_at_least_32_chars',
  });
  assert.strictEqual(placeholderProblems.length, 1);
  assert.strictEqual(placeholderProblems[0].name, 'JWT_SECRET');
  assert.strictEqual(placeholderProblems[0].level, 'fatal');

  // 多个密钥同时是占位值时应全部报告
  const allPlaceholder = collectSecretProblems({
    JWT_SECRET: 'please_generate_a_strong_secret_at_least_32_chars',
    AI_SETTINGS_ENCRYPTION_KEY: 'please_generate_another_stable_secret',
  });
  assert.deepStrictEqual(
    allPlaceholder.map(problem => problem.name).sort(),
    ['AI_SETTINGS_ENCRYPTION_KEY', 'JWT_SECRET']
  );
  assert.ok(allPlaceholder.every(problem => problem.level === 'fatal'));

  // 可选密钥留空是允许的
  assert.deepStrictEqual(collectSecretProblems({ JWT_SECRET: STRONG_SECRET }), []);

  // 可选密钥过短只告警，不阻断
  const shortOptional = collectSecretProblems({
    JWT_SECRET: STRONG_SECRET,
    AI_SETTINGS_ENCRYPTION_KEY: 'short-key',
  });
  assert.strictEqual(shortOptional.length, 1);
  assert.strictEqual(shortOptional[0].level, 'warn');

  // 开发环境不做校验
  const devRun = assertProductionSecrets({ NODE_ENV: 'development', JWT_SECRET: 'weak' }, {
    logger: createLogger().logger,
    onFatal: () => assert.fail('开发环境不应中止启动'),
  });
  assert.strictEqual(devRun.ok, true);

  // 生产环境 + 占位值 => 中止启动
  {
    const { logger, errors } = createLogger();
    let exited = false;
    const result = assertProductionSecrets({
      NODE_ENV: 'production',
      JWT_SECRET: 'please_generate_a_strong_secret_at_least_32_chars',
    }, { logger, onFatal: () => { exited = true; } });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(exited, true);
    assert.ok(errors.some(message => message.includes('JWT_SECRET')));
  }

  // 生产环境 + 强密钥 => 正常启动
  {
    const { logger } = createLogger();
    const result = assertProductionSecrets({
      NODE_ENV: 'production',
      JWT_SECRET: STRONG_SECRET,
    }, { logger, onFatal: () => assert.fail('强密钥不应中止启动') });
    assert.strictEqual(result.ok, true);
  }

  // 本地一键启动同样跑在 NODE_ENV=production，只告警不中断
  {
    const { logger, warnings } = createLogger();
    const result = assertProductionSecrets({
      NODE_ENV: 'production',
      DASHBOARD_LOCAL_MODE: '1',
      JWT_SECRET: 'local-one-click-dashboard-secret-change-me-2026',
    }, { logger, onFatal: () => assert.fail('本地模式不应中止启动') });

    assert.strictEqual(result.ok, true);
    assert.ok(warnings.some(message => message.includes('JWT_SECRET')));
  }

  // 强制改密仅对非本地部署生效
  assert.strictEqual(isPasswordChangeEnforced({}), true);
  assert.strictEqual(isPasswordChangeEnforced({ NODE_ENV: 'production' }), true);
  assert.strictEqual(isPasswordChangeEnforced({ DASHBOARD_LOCAL_MODE: '1' }), false);
  assert.strictEqual(isPasswordChangeEnforced({ DASHBOARD_LOCAL_MODE: 'true' }), false);

  console.log('productionSecrets.test.js passed');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
