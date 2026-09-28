const assert = require('assert');
const {
  getLogoSettings,
  resolveBrandfetchClientId,
  updateLogoSettings,
} = require('../utils/logoSettings');

/**
 * Logo 设置回归测试：网页配置优先，留空回到环境变量，数据库故障不能拖垮 /app-config.js。
 */

function createAppSettingModel() {
  const rows = new Map();
  return {
    rows,
    async findOne({ where }) {
      const row = rows.get(where.key);
      if (!row) return null;
      return {
        ...row,
        async update(values) {
          rows.set(where.key, { ...rows.get(where.key), ...values });
        },
      };
    },
    async create(values) {
      rows.set(values.key, { ...values });
    },
    async destroy({ where }) {
      rows.delete(where.key);
    },
  };
}

async function run() {
  const AppSettingModel = createAppSettingModel();
  const env = { BRANDFETCH_CLIENT_ID: 'env-client' };

  // 未在网页配置：沿用环境变量
  assert.deepStrictEqual(await getLogoSettings({ AppSettingModel, env }), {
    brandfetchClientId: '',
    envConfigured: true,
    effectiveBrandfetchClientId: 'env-client',
    source: 'env',
  });

  // 网页配置优先，并去掉首尾空格
  const saved = await updateLogoSettings({ AppSettingModel, env }, { brandfetchClientId: '  1idAbc_123-x  ' });
  assert.strictEqual(saved.brandfetchClientId, '1idAbc_123-x');
  assert.strictEqual(saved.source, 'settings');
  assert.strictEqual(await resolveBrandfetchClientId({ AppSettingModel, env }), '1idAbc_123-x');

  // 再次保存走更新而不是新增
  await updateLogoSettings({ AppSettingModel, env }, { brandfetchClientId: 'second' });
  assert.strictEqual(AppSettingModel.rows.size, 1);
  assert.strictEqual(await resolveBrandfetchClientId({ AppSettingModel, env }), 'second');

  // 非法字符（会被拼进 URL）与非字符串一律拒绝
  await assert.rejects(
    () => updateLogoSettings({ AppSettingModel, env }, { brandfetchClientId: 'abc?x=1' }),
    error => error.statusCode === 400
  );
  await assert.rejects(
    () => updateLogoSettings({ AppSettingModel, env }, { brandfetchClientId: null }),
    error => error.statusCode === 400
  );
  assert.strictEqual(await resolveBrandfetchClientId({ AppSettingModel, env }), 'second');

  // 清空即回到环境变量
  const cleared = await updateLogoSettings({ AppSettingModel, env }, { brandfetchClientId: '' });
  assert.strictEqual(cleared.source, 'env');
  assert.strictEqual(AppSettingModel.rows.size, 0);

  // 都没配置
  assert.strictEqual((await getLogoSettings({ AppSettingModel, env: {} })).source, 'none');

  // 数据库故障时 /app-config.js 仍能拿到环境变量
  const brokenModel = {
    async findOne() {
      throw new Error('database is locked');
    },
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.strictEqual(await resolveBrandfetchClientId({ AppSettingModel: brokenModel, env }), 'env-client');
  } finally {
    console.error = originalError;
  }

  console.log('logoSettings tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
