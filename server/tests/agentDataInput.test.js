const assert = require('assert');
const path = require('path');

/**
 * 录入接口的可选 model 参数：
 * 不传就用 Admin 设置里的默认模型，传了只替换本次解析的模型名。
 */

function stubModule(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

// 供应商侧：记录每次请求用的模型，返回一份最小可用的解析结果
const providerCalls = [];
class FakeOpenAI {
  constructor(options) {
    this.options = options;
    this.chat = {
      completions: {
        create: async (body) => {
          providerCalls.push({ model: body.model, baseURL: options.baseURL });
          return { choices: [{ message: { content: '{"date":"2026-11-01","coins":[]}' } }] };
        },
      },
    };
  }
}

stubModule('openai', { OpenAI: FakeOpenAI });
const realModelSettings = require('../utils/openaiModelSettings');
stubModule(path.join(__dirname, '../utils/openaiModelSettings'), {
  ...realModelSettings,
  resolveOpenAIModelSettings: async () => ({
    provider: 'deepseek',
    baseURL: 'https://api.deepseek.com',
    model: 'default-model',
    apiKey: 'sk-test',
    sources: { model: 'database' },
  }),
});
stubModule(path.join(__dirname, '../utils/openaiPromptSettings'), {
  getOpenAIPromptSettings: async () => ({ systemPrompt: null, userPromptTemplate: null }),
});

async function testProcessRawDataModel() {
  const openaiService = require('../services/openaiService');

  await openaiService.processRawData('11.1\nBTC 场外 1000');
  await openaiService.processRawData('11.1\nBTC 场外 1000', { model: 'deepseek-v4-pro' });

  assert.deepStrictEqual(providerCalls, [
    { model: 'default-model', baseURL: 'https://api.deepseek.com' },
    { model: 'deepseek-v4-pro', baseURL: 'https://api.deepseek.com' },
  ], '指定模型只替换模型名，供应商地址不变');
}

async function testInputRouteModel() {
  const openaiService = require('../services/openaiService');
  const router = require('../routes/data');
  const layer = router.stack.find(item => item.route?.path === '/input' && item.route.methods.post);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  const received = [];
  const original = openaiService.processRawData;
  // 在落库前中断，只检查传给解析的参数
  openaiService.processRawData = async (rawData, options) => {
    received.push(options);
    throw new Error('stop before storage');
  };

  try {
    const call = async (body) => {
      const res = createResponse();
      await handler({ body }, res);
      return res;
    };

    await call({ rawData: '11.1\nBTC' });
    await call({ rawData: '11.1\nBTC', model: '' });
    await call({ rawData: '11.1\nBTC', model: '  deepseek-v4-pro  ' });
    assert.deepStrictEqual(received, [{ model: null }, { model: null }, { model: 'deepseek-v4-pro' }]);

    for (const model of ['x'.repeat(201), '   ', 123, ['a'], { name: 'x' }, true]) {
      const res = await call({ rawData: '11.1\nBTC', model });
      assert.strictEqual(res.statusCode, 400, `model=${JSON.stringify(model).slice(0, 20)}`);
    }
    assert.strictEqual(received.length, 3, '非法模型名不能进入解析');
  } finally {
    openaiService.processRawData = original;
  }
}

async function run() {
  await testProcessRawDataModel();
  await testInputRouteModel();
  console.log('agentDataInput tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
