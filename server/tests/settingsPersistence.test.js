const assert = require('assert');

const {
  getSystemSettings,
  updateSystemSettings,
} = require('../utils/settings');

function createAppSettingModel() {
  const rows = new Map();
  return {
    rows,
    async findOne({ where }) {
      return rows.get(where.key) || null;
    },
    async create(payload) {
      const row = {
        ...payload,
        async update(values) {
          Object.assign(this, values);
          return this;
        },
        get() {
          return this;
        },
      };
      rows.set(payload.key, row);
      return row;
    },
  };
}

async function run() {
  const AppSettingModel = createAppSettingModel();
  const productionDefault = await getSystemSettings({
    AppSettingModel,
    env: { NODE_ENV: 'production' },
  });
  assert.strictEqual(productionDefault.registrationEnabled, false);

  await updateSystemSettings({ AppSettingModel }, { registrationEnabled: true });
  const persisted = await getSystemSettings({
    AppSettingModel,
    env: { NODE_ENV: 'production' },
  });
  assert.strictEqual(persisted.registrationEnabled, true);
  assert.strictEqual(AppSettingModel.rows.get('registration_enabled').value, 'true');

  await assert.rejects(
    () => updateSystemSettings({ AppSettingModel }, { registrationEnabled: 'yes' }),
    /boolean/
  );

  console.log('settingsPersistence.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
