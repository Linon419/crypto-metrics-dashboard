const REGISTRATION_SETTING_KEY = 'registration_enabled';

function getAppSettingModel() {
  try {
    return require('../models').AppSetting;
  } catch {
    return null;
  }
}

function getDefaultRegistrationEnabled(env = process.env) {
  const configured = String(env.REGISTRATION_ENABLED || '').trim().toLowerCase();
  if (['true', '1', 'yes'].includes(configured)) return true;
  if (['false', '0', 'no'].includes(configured)) return false;
  return env.NODE_ENV !== 'production';
}

async function getSystemSettings({
  AppSettingModel = getAppSettingModel(),
  env = process.env,
} = {}) {
  const fallback = getDefaultRegistrationEnabled(env);
  if (!AppSettingModel?.findOne) return { registrationEnabled: fallback };

  const row = await AppSettingModel.findOne({ where: { key: REGISTRATION_SETTING_KEY } });
  const plain = typeof row?.get === 'function' ? row.get({ plain: true }) : row;
  if (!plain) return { registrationEnabled: fallback };
  return { registrationEnabled: plain.value === 'true' };
}

async function updateSystemSettings({
  AppSettingModel = getAppSettingModel(),
} = {}, payload = {}) {
  if (typeof payload.registrationEnabled !== 'boolean') {
    throw new Error('registrationEnabled must be a boolean');
  }
  if (!AppSettingModel?.findOne || !AppSettingModel?.create) {
    throw new Error('AppSetting model is unavailable');
  }

  const value = String(payload.registrationEnabled);
  const row = await AppSettingModel.findOne({ where: { key: REGISTRATION_SETTING_KEY } });
  if (row?.update) await row.update({ value });
  else await AppSettingModel.create({ key: REGISTRATION_SETTING_KEY, value });
  return { registrationEnabled: payload.registrationEnabled };
}

module.exports = {
  REGISTRATION_SETTING_KEY,
  getSystemSettings,
  updateSystemSettings,
};
