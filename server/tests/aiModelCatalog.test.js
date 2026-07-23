const assert = require('assert');

const { listAvailableAIModels } = require('../services/aiModelCatalogService');
const adminRouter = require('../routes/admin');

async function run() {
  const constructorCalls = [];

  class FakeOpenAI {
    constructor(config) {
      constructorCalls.push(config);
      this.models = {
        list: async () => ({
          data: [
            { id: 'gpt-4o-mini' },
            { id: 'gpt-4o' },
            { id: 'gpt-4o-mini' },
            { id: '' },
            {},
          ],
        }),
      };
    }
  }

  const models = await listAvailableAIModels({
    apiKey: 'sk-test',
    baseURL: 'https://api.example.com/v1',
  }, { OpenAIClass: FakeOpenAI });

  assert.deepStrictEqual(models, ['gpt-4o', 'gpt-4o-mini']);
  assert.deepStrictEqual(constructorCalls[0], {
    apiKey: 'sk-test',
    baseURL: 'https://api.example.com/v1',
    maxRetries: 1,
    timeout: 15000,
  });

  await assert.rejects(
    () => listAvailableAIModels({ baseURL: 'https://api.example.com/v1' }),
    /API Key/
  );

  let resolvedRequest = null;
  const catalogResponse = await adminRouter.__test.buildOpenAIModelCatalogResponse({
    AppSettingModel: {
      async findAll() {
        return [];
      },
    },
    env: {
      OPENAI_API_KEY: 'docker-key',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
    },
    async listModels(settings) {
      resolvedRequest = settings;
      return ['deepseek-v4-flash'];
    },
  }, {
    provider: 'deepseek',
    baseURL: 'https://api.deepseek.com',
    apiKey: 'temporary-key',
  });
  assert.deepStrictEqual(resolvedRequest, {
    provider: 'deepseek',
    baseURL: 'https://api.deepseek.com',
    apiKey: 'temporary-key',
  });
  assert.deepStrictEqual(catalogResponse, {
    models: ['deepseek-v4-flash'],
  });
  assert.strictEqual(JSON.stringify(catalogResponse).includes('temporary-key'), false);

  console.log('aiModelCatalog.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
