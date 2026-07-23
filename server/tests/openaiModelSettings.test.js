const assert = require('assert');

const {
  OPENAI_MODEL_SETTING_KEYS,
  getOpenAIModelSettingsResponse,
  resetOpenAIModelSettings,
  resolveOpenAIModelSettings,
  updateOpenAIModelSettings,
  validateOpenAIModelSettings,
} = require('../utils/openaiModelSettings');

function createFakeAppSettingModel() {
  const rows = new Map();

  return {
    rows,
    async findAll() {
      return Array.from(rows.values());
    },
    async findOne(options) {
      return rows.get(options.where.key) || null;
    },
    async create(payload) {
      const row = {
        ...payload,
        update(nextPayload) {
          Object.assign(this, nextPayload);
          return Promise.resolve(this);
        },
        get() {
          return this;
        },
      };
      rows.set(payload.key, row);
      return row;
    },
    async destroy(options) {
      const keys = Array.isArray(options.where.key) ? options.where.key : [options.where.key];
      let deleted = 0;
      keys.forEach(key => {
        if (rows.delete(key)) deleted += 1;
      });
      return deleted;
    },
  };
}

async function run() {
  const AppSettingModel = createFakeAppSettingModel();
  const env = {
    OPENAI_API_KEY: 'docker-openai-key',
    OPENAI_BASE_URL: 'https://docker.example.com/v1',
    OPENAI_MODEL: 'docker-model',
  };

  const environmentSettings = await resolveOpenAIModelSettings({ AppSettingModel, env });
  assert.strictEqual(environmentSettings.provider, 'custom');
  assert.strictEqual(environmentSettings.baseURL, 'https://docker.example.com/v1');
  assert.strictEqual(environmentSettings.model, 'docker-model');
  assert.strictEqual(environmentSettings.apiKey, 'docker-openai-key');
  assert.strictEqual(environmentSettings.sources.model, 'env');

  const providerOverrideModel = createFakeAppSettingModel();
  await updateOpenAIModelSettings({ AppSettingModel: providerOverrideModel }, {
    provider: 'deepseek',
  });
  const providerOverride = await resolveOpenAIModelSettings({
    AppSettingModel: providerOverrideModel,
    env,
  });
  assert.strictEqual(providerOverride.baseURL, 'https://api.deepseek.com');
  assert.strictEqual(providerOverride.model, 'deepseek-v4-flash');
  assert.strictEqual(providerOverride.sources.model, 'database');

  const saved = await updateOpenAIModelSettings({ AppSettingModel }, {
    provider: 'deepseek',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    apiKey: 'database-deepseek-key',
  });
  assert.strictEqual(saved.provider, 'deepseek');
  assert.strictEqual(saved.model, 'deepseek-v4-flash');
  const storedApiKey = AppSettingModel.rows.get(OPENAI_MODEL_SETTING_KEYS.apiKey).value;
  assert.notStrictEqual(storedApiKey, 'database-deepseek-key');
  assert.match(storedApiKey, /^enc:v1:/);

  const databaseSettings = await resolveOpenAIModelSettings({ AppSettingModel, env });
  assert.strictEqual(databaseSettings.provider, 'deepseek');
  assert.strictEqual(databaseSettings.baseURL, 'https://api.deepseek.com');
  assert.strictEqual(databaseSettings.model, 'deepseek-v4-flash');
  assert.strictEqual(databaseSettings.apiKey, 'database-deepseek-key');
  assert.strictEqual(databaseSettings.sources.provider, 'database');
  assert.strictEqual(databaseSettings.sources.apiKey, 'database');

  const response = await getOpenAIModelSettingsResponse({ AppSettingModel, env });
  assert.strictEqual(response.apiKeyConfigured, true);
  assert.strictEqual(response.apiKey, undefined);
  assert.strictEqual(JSON.stringify(response).includes('database-deepseek-key'), false);

  await updateOpenAIModelSettings({ AppSettingModel }, {
    provider: 'deepseek',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
    apiKey: '',
  });
  const preservedKey = await resolveOpenAIModelSettings({ AppSettingModel, env });
  assert.strictEqual(preservedKey.apiKey, 'database-deepseek-key');
  assert.strictEqual(preservedKey.model, 'deepseek-v4-pro');

  await updateOpenAIModelSettings({ AppSettingModel }, { clearApiKey: true });
  const clearedKey = await resolveOpenAIModelSettings({
    AppSettingModel,
    env: { ...env, DEEPSEEK_API_KEY: 'docker-deepseek-key' },
  });
  assert.strictEqual(clearedKey.apiKey, 'docker-deepseek-key');
  assert.strictEqual(clearedKey.sources.apiKey, 'env');

  assert.throws(
    () => validateOpenAIModelSettings({ provider: 'unknown' }),
    /provider/
  );
  assert.throws(
    () => validateOpenAIModelSettings({ baseURL: 'javascript:alert(1)' }),
    /baseURL/
  );

  await resetOpenAIModelSettings({ AppSettingModel });
  Object.values(OPENAI_MODEL_SETTING_KEYS).forEach(key => {
    assert.strictEqual(AppSettingModel.rows.has(key), false);
  });

  console.log('openaiModelSettings.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
