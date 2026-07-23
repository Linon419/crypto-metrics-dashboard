const {
  decryptSettingSecret,
  encryptSettingSecret,
} = require('./settingSecretEncryption');

const OPENAI_MODEL_SETTING_KEYS = {
  provider: 'openai_provider',
  baseURL: 'openai_base_url',
  model: 'openai_model',
  apiKey: 'openai_api_key',
};

const PROVIDER_PRESETS = {
  openai: {
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  deepseek: {
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
  },
  custom: {
    baseURL: '',
    model: '',
  },
};

const MAX_BASE_URL_LENGTH = 2048;
const MAX_MODEL_LENGTH = 200;
const MAX_API_KEY_LENGTH = 4096;
const VALID_PROVIDERS = new Set(Object.keys(PROVIDER_PRESETS));

function getAppSettingModel() {
  try {
    return require('../models').AppSetting;
  } catch (error) {
    return null;
  }
}

function toPlainRow(row) {
  if (!row) return null;
  return typeof row.get === 'function' ? row.get({ plain: true }) : row;
}

function buildSettingMap(rows = []) {
  return new Map(rows.map(row => {
    const plain = toPlainRow(row);
    return [plain.key, typeof plain.value === 'string' ? plain.value : null];
  }));
}

async function getOpenAIModelSettings({
  AppSettingModel = getAppSettingModel(),
} = {}) {
  if (!AppSettingModel?.findAll) {
    return {
      provider: null,
      baseURL: null,
      model: null,
      apiKey: null,
    };
  }

  const rows = await AppSettingModel.findAll({
    where: {
      key: Object.values(OPENAI_MODEL_SETTING_KEYS),
    },
  });
  const settings = buildSettingMap(rows);

  const resolved = Object.fromEntries(Object.entries(OPENAI_MODEL_SETTING_KEYS).map(([field, key]) => (
    [field, settings.get(key) || null]
  )));
  resolved.apiKey = decryptSettingSecret(resolved.apiKey);
  return resolved;
}

function inferProvider(baseURL = '') {
  try {
    const hostname = new URL(baseURL).hostname.toLowerCase();
    if (hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')) {
      return 'deepseek';
    }
    if (hostname === 'api.openai.com' || hostname.endsWith('.openai.com')) {
      return 'openai';
    }
    return 'custom';
  } catch (error) {
    return 'openai';
  }
}

function resolveProvider(savedSettings, env) {
  if (VALID_PROVIDERS.has(savedSettings.provider)) {
    return { value: savedSettings.provider, source: 'database' };
  }
  if (VALID_PROVIDERS.has(env.OPENAI_PROVIDER)) {
    return { value: env.OPENAI_PROVIDER, source: 'env' };
  }
  if (env.OPENAI_BASE_URL) {
    return { value: inferProvider(env.OPENAI_BASE_URL), source: 'env' };
  }
  return { value: 'openai', source: 'default' };
}

function resolveProviderValue({ savedValue, envValue, provider, providerSource, field }) {
  if (savedValue) {
    return { value: savedValue, source: 'database' };
  }

  const providerDefault = PROVIDER_PRESETS[provider][field];
  if (providerSource === 'database' && providerDefault) {
    return { value: providerDefault, source: 'database' };
  }
  if (envValue) {
    return { value: envValue, source: 'env' };
  }
  if (providerDefault) {
    return { value: providerDefault, source: 'default' };
  }
  return { value: '', source: 'default' };
}

async function resolveOpenAIModelSettings({
  AppSettingModel = getAppSettingModel(),
  env = process.env,
} = {}) {
  const savedSettings = await getOpenAIModelSettings({ AppSettingModel });
  const providerResult = resolveProvider(savedSettings, env);
  const baseURLResult = resolveProviderValue({
    savedValue: savedSettings.baseURL,
    envValue: env.OPENAI_BASE_URL,
    provider: providerResult.value,
    providerSource: providerResult.source,
    field: 'baseURL',
  });
  const modelResult = resolveProviderValue({
    savedValue: savedSettings.model,
    envValue: env.OPENAI_MODEL,
    provider: providerResult.value,
    providerSource: providerResult.source,
    field: 'model',
  });
  const environmentApiKey = providerResult.value === 'deepseek'
    ? env.DEEPSEEK_API_KEY || env.OPENAI_API_KEY
    : env.OPENAI_API_KEY;
  const apiKey = savedSettings.apiKey || environmentApiKey || null;

  return {
    provider: providerResult.value,
    baseURL: baseURLResult.value,
    model: modelResult.value,
    apiKey,
    apiKeyConfigured: Boolean(apiKey),
    sources: {
      provider: providerResult.source,
      baseURL: baseURLResult.source,
      model: modelResult.source,
      apiKey: savedSettings.apiKey ? 'database' : (environmentApiKey ? 'env' : 'default'),
    },
  };
}

async function getOpenAIModelSettingsResponse(options = {}) {
  const resolved = await resolveOpenAIModelSettings(options);
  const { apiKey, ...safeSettings } = resolved;
  return safeSettings;
}

function normalizeString(value) {
  return String(value || '').trim();
}

function validateBaseURL(value) {
  const baseURL = normalizeString(value).replace(/\/+$/, '');
  if (!baseURL) {
    throw new Error('baseURL is required');
  }
  if (baseURL.length > MAX_BASE_URL_LENGTH) {
    throw new Error(`baseURL must be at most ${MAX_BASE_URL_LENGTH} characters`);
  }

  let parsedURL;
  try {
    parsedURL = new URL(baseURL);
  } catch (error) {
    throw new Error('baseURL must be a valid HTTP URL');
  }
  if (!['http:', 'https:'].includes(parsedURL.protocol) || parsedURL.username || parsedURL.password) {
    throw new Error('baseURL must be a valid HTTP URL');
  }
  return baseURL;
}

function validateOpenAIModelSettings(payload = {}) {
  const result = {};

  if (Object.prototype.hasOwnProperty.call(payload, 'provider')) {
    const provider = normalizeString(payload.provider).toLowerCase();
    if (!VALID_PROVIDERS.has(provider)) {
      throw new Error('provider must be openai, deepseek, or custom');
    }
    result.provider = provider;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'baseURL')) {
    result.baseURL = validateBaseURL(payload.baseURL);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'model')) {
    const model = normalizeString(payload.model);
    if (!model) throw new Error('model is required');
    if (model.length > MAX_MODEL_LENGTH) {
      throw new Error(`model must be at most ${MAX_MODEL_LENGTH} characters`);
    }
    result.model = model;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'apiKey')) {
    const apiKey = normalizeString(payload.apiKey);
    if (apiKey.length > MAX_API_KEY_LENGTH) {
      throw new Error(`apiKey must be at most ${MAX_API_KEY_LENGTH} characters`);
    }
    if (apiKey) result.apiKey = apiKey;
  }
  if (payload.clearApiKey === true) {
    if (result.apiKey) throw new Error('apiKey and clearApiKey cannot be used together');
    result.clearApiKey = true;
  }

  return result;
}

async function upsertSetting(AppSettingModel, key, value) {
  const existing = await AppSettingModel.findOne({ where: { key } });
  if (existing?.update) return existing.update({ value });
  return AppSettingModel.create({ key, value });
}

async function updateOpenAIModelSettings({
  AppSettingModel = getAppSettingModel(),
} = {}, payload = {}) {
  if (!AppSettingModel?.findOne || !AppSettingModel?.create || !AppSettingModel?.destroy) {
    throw new Error('AppSetting model is unavailable');
  }

  const normalized = validateOpenAIModelSettings(payload);
  if (Object.keys(normalized).length === 0) {
    throw new Error('No model settings provided');
  }

  for (const field of ['provider', 'baseURL', 'model', 'apiKey']) {
    if (Object.prototype.hasOwnProperty.call(normalized, field)) {
      const value = field === 'apiKey' ? encryptSettingSecret(normalized[field]) : normalized[field];
      await upsertSetting(AppSettingModel, OPENAI_MODEL_SETTING_KEYS[field], value);
    }
  }
  if (normalized.clearApiKey) {
    await AppSettingModel.destroy({
      where: { key: OPENAI_MODEL_SETTING_KEYS.apiKey },
    });
  }

  return getOpenAIModelSettings({ AppSettingModel });
}

async function resetOpenAIModelSettings({
  AppSettingModel = getAppSettingModel(),
} = {}) {
  if (!AppSettingModel?.destroy) {
    throw new Error('AppSetting model is unavailable');
  }

  await AppSettingModel.destroy({
    where: { key: Object.values(OPENAI_MODEL_SETTING_KEYS) },
  });

  return {
    provider: null,
    baseURL: null,
    model: null,
    apiKey: null,
  };
}

module.exports = {
  OPENAI_MODEL_SETTING_KEYS,
  PROVIDER_PRESETS,
  getOpenAIModelSettings,
  getOpenAIModelSettingsResponse,
  inferProvider,
  resetOpenAIModelSettings,
  resolveOpenAIModelSettings,
  updateOpenAIModelSettings,
  validateOpenAIModelSettings,
};
