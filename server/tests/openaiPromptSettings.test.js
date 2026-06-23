const assert = require('assert');

const {
  getOpenAIPromptSettings,
  renderPromptTemplate,
  resetOpenAIPromptSettings,
  updateOpenAIPromptSettings,
  validateOpenAIPromptSettings,
} = require('../utils/openaiPromptSettings');

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
  assert.throws(
    () => validateOpenAIPromptSettings({ userPromptTemplate: '缺少变量' }),
    /processedText/
  );

  const rendered = renderPromptTemplate('今天 {{currentDate}}\n{{processedText}}', {
    processedText: 'BTC 场外指数1000',
    currentDate: new Date('2026-06-23T00:00:00.000Z'),
  });
  assert.strictEqual(rendered, '今天 2026-06-23\nBTC 场外指数1000');

  const AppSettingModel = createFakeAppSettingModel();
  const empty = await getOpenAIPromptSettings({ AppSettingModel });
  assert.strictEqual(empty.systemPrompt, null);
  assert.strictEqual(empty.userPromptTemplate, null);

  const saved = await updateOpenAIPromptSettings({ AppSettingModel }, {
    systemPrompt: '系统规则',
    userPromptTemplate: '输入：{{processedText}}',
  });
  assert.strictEqual(saved.systemPrompt, '系统规则');
  assert.strictEqual(saved.userPromptTemplate, '输入：{{processedText}}');

  const updated = await updateOpenAIPromptSettings({ AppSettingModel }, {
    userPromptTemplate: '日期 {{currentDate}}\n{{processedText}}',
  });
  assert.strictEqual(updated.systemPrompt, '系统规则');
  assert.strictEqual(updated.userPromptTemplate, '日期 {{currentDate}}\n{{processedText}}');

  const reset = await resetOpenAIPromptSettings({ AppSettingModel });
  assert.strictEqual(reset.systemPrompt, null);
  assert.strictEqual(reset.userPromptTemplate, null);
  assert.strictEqual(AppSettingModel.rows.size, 0);

  console.log('openaiPromptSettings.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
