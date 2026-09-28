/**
 * Logo 相关配置：Brandfetch Client ID。
 *
 * 在 Admin 设置里填写后立即生效；网页上没填时沿用环境变量 BRANDFETCH_CLIENT_ID，
 * 已有部署不需要改动。Client ID 会出现在浏览器请求的 URL 里，属于公开标识而非密钥。
 */

const BRANDFETCH_CLIENT_ID_SETTING_KEY = 'brandfetch_client_id';
const BRANDFETCH_CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function getAppSettingModel() {
  try {
    return require('../models').AppSetting;
  } catch {
    return null;
  }
}

async function readStoredClientId(AppSettingModel) {
  if (!AppSettingModel?.findOne) return '';
  const row = await AppSettingModel.findOne({ where: { key: BRANDFETCH_CLIENT_ID_SETTING_KEY } });
  const plain = typeof row?.get === 'function' ? row.get({ plain: true }) : row;
  return String(plain?.value || '').trim();
}

async function getLogoSettings({
  AppSettingModel = getAppSettingModel(),
  env = process.env,
} = {}) {
  const stored = await readStoredClientId(AppSettingModel);
  const envClientId = String(env.BRANDFETCH_CLIENT_ID || '').trim();
  const effective = stored || envClientId;
  return {
    brandfetchClientId: stored,
    envConfigured: Boolean(envClientId),
    effectiveBrandfetchClientId: effective,
    source: stored ? 'settings' : (envClientId ? 'env' : 'none'),
  };
}

// 给 /app-config.js 用：数据库不可用时退回环境变量，不能让整页配置加载失败
async function resolveBrandfetchClientId(options = {}) {
  const env = options.env || process.env;
  try {
    const settings = await getLogoSettings(options);
    return settings.effectiveBrandfetchClientId;
  } catch (error) {
    console.error('读取 Logo 设置失败，改用环境变量:', error.message);
    return String(env.BRANDFETCH_CLIENT_ID || '').trim();
  }
}

async function updateLogoSettings({
  AppSettingModel = getAppSettingModel(),
  env = process.env,
} = {}, payload = {}) {
  if (typeof payload.brandfetchClientId !== 'string') {
    const error = new Error('brandfetchClientId 必须是字符串');
    error.statusCode = 400;
    throw error;
  }

  const clientId = payload.brandfetchClientId.trim();
  if (clientId && !BRANDFETCH_CLIENT_ID_PATTERN.test(clientId)) {
    const error = new Error('Brandfetch Client ID 只能包含字母、数字、下划线和短横线，最长 128 位');
    error.statusCode = 400;
    throw error;
  }
  if (!AppSettingModel?.findOne || !AppSettingModel?.create || !AppSettingModel?.destroy) {
    throw new Error('AppSetting model is unavailable');
  }

  // 清空即删除记录，回到环境变量
  if (!clientId) {
    await AppSettingModel.destroy({ where: { key: BRANDFETCH_CLIENT_ID_SETTING_KEY } });
  } else {
    const row = await AppSettingModel.findOne({ where: { key: BRANDFETCH_CLIENT_ID_SETTING_KEY } });
    if (row?.update) await row.update({ value: clientId });
    else await AppSettingModel.create({ key: BRANDFETCH_CLIENT_ID_SETTING_KEY, value: clientId });
  }

  return getLogoSettings({ AppSettingModel, env });
}

module.exports = {
  BRANDFETCH_CLIENT_ID_SETTING_KEY,
  getLogoSettings,
  resolveBrandfetchClientId,
  updateLogoSettings,
};
