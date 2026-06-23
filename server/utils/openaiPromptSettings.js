const PROMPT_SETTING_KEYS = {
  systemPrompt: 'openai_system_prompt',
  userPromptTemplate: 'openai_user_prompt_template',
};

const MAX_SYSTEM_PROMPT_LENGTH = 20000;
const MAX_USER_PROMPT_LENGTH = 120000;

function getAppSettingModel() {
  try {
    return require('../models').AppSetting;
  } catch (error) {
    return null;
  }
}

function getRowValue(row) {
  if (!row) return null;
  const plain = typeof row.get === 'function' ? row.get({ plain: true }) : row;
  return typeof plain.value === 'string' ? plain.value : null;
}

function buildSettingMap(rows = []) {
  const map = new Map();
  rows.forEach(row => {
    const plain = typeof row.get === 'function' ? row.get({ plain: true }) : row;
    if (plain?.key) {
      map.set(plain.key, getRowValue(plain));
    }
  });
  return map;
}

async function getOpenAIPromptSettings({
  AppSettingModel = getAppSettingModel(),
} = {}) {
  if (!AppSettingModel?.findAll) {
    return {
      systemPrompt: null,
      userPromptTemplate: null,
    };
  }

  const rows = await AppSettingModel.findAll({
    where: {
      key: Object.values(PROMPT_SETTING_KEYS),
    },
  });
  const map = buildSettingMap(rows);

  return {
    systemPrompt: map.get(PROMPT_SETTING_KEYS.systemPrompt) || null,
    userPromptTemplate: map.get(PROMPT_SETTING_KEYS.userPromptTemplate) || null,
  };
}

function normalizePromptValue(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function validateOpenAIPromptSettings(payload = {}) {
  const result = {};

  if (Object.prototype.hasOwnProperty.call(payload, 'systemPrompt')) {
    const systemPrompt = normalizePromptValue(payload.systemPrompt);
    if (!systemPrompt) {
      throw new Error('systemPrompt is required');
    }
    if (systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
      throw new Error(`systemPrompt must be at most ${MAX_SYSTEM_PROMPT_LENGTH} characters`);
    }
    result.systemPrompt = systemPrompt;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'userPromptTemplate')) {
    const userPromptTemplate = normalizePromptValue(payload.userPromptTemplate);
    if (!userPromptTemplate) {
      throw new Error('userPromptTemplate is required');
    }
    if (!userPromptTemplate.includes('{{processedText}}')) {
      throw new Error('userPromptTemplate must include {{processedText}}');
    }
    if (userPromptTemplate.length > MAX_USER_PROMPT_LENGTH) {
      throw new Error(`userPromptTemplate must be at most ${MAX_USER_PROMPT_LENGTH} characters`);
    }
    result.userPromptTemplate = userPromptTemplate;
  }

  return result;
}

async function upsertSetting(AppSettingModel, key, value) {
  const existing = await AppSettingModel.findOne({ where: { key } });
  if (existing?.update) {
    return existing.update({ value });
  }
  return AppSettingModel.create({ key, value });
}

async function updateOpenAIPromptSettings({
  AppSettingModel = getAppSettingModel(),
} = {}, payload = {}) {
  if (!AppSettingModel?.findOne || !AppSettingModel?.create) {
    throw new Error('AppSetting model is unavailable');
  }

  const normalized = validateOpenAIPromptSettings(payload);
  if (Object.keys(normalized).length === 0) {
    throw new Error('No prompt settings provided');
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'systemPrompt')) {
    await upsertSetting(AppSettingModel, PROMPT_SETTING_KEYS.systemPrompt, normalized.systemPrompt);
  }
  if (Object.prototype.hasOwnProperty.call(normalized, 'userPromptTemplate')) {
    await upsertSetting(AppSettingModel, PROMPT_SETTING_KEYS.userPromptTemplate, normalized.userPromptTemplate);
  }

  return getOpenAIPromptSettings({ AppSettingModel });
}

async function resetOpenAIPromptSettings({
  AppSettingModel = getAppSettingModel(),
} = {}) {
  if (!AppSettingModel?.destroy) {
    throw new Error('AppSetting model is unavailable');
  }

  await AppSettingModel.destroy({
    where: {
      key: Object.values(PROMPT_SETTING_KEYS),
    },
  });

  return {
    systemPrompt: null,
    userPromptTemplate: null,
  };
}

function renderPromptTemplate(template, {
  processedText,
  currentDate = new Date(),
} = {}) {
  const dateString = currentDate instanceof Date
    ? currentDate.toISOString().split('T')[0]
    : String(currentDate || '').slice(0, 10);

  return String(template || '')
    .replaceAll('{{currentDate}}', dateString)
    .replaceAll('{{processedText}}', String(processedText || ''));
}

module.exports = {
  PROMPT_SETTING_KEYS,
  getOpenAIPromptSettings,
  renderPromptTemplate,
  resetOpenAIPromptSettings,
  updateOpenAIPromptSettings,
  validateOpenAIPromptSettings,
};
