const { OpenAI } = require('openai');

const MODEL_CATALOG_TIMEOUT_MS = 15000;

function normalizeModelIds(data = []) {
  return Array.from(new Set(data
    .map(item => String(item?.id || '').trim())
    .filter(Boolean)))
    .sort((left, right) => left.localeCompare(right));
}

async function listAvailableAIModels({ apiKey, baseURL } = {}, {
  OpenAIClass = OpenAI,
} = {}) {
  if (!apiKey) {
    const error = new Error('请先配置 API Key，再同步模型列表');
    error.statusCode = 400;
    throw error;
  }

  const client = new OpenAIClass({
    apiKey,
    baseURL,
    maxRetries: 1,
    timeout: MODEL_CATALOG_TIMEOUT_MS,
  });

  try {
    const response = await client.models.list();
    return normalizeModelIds(response?.data);
  } catch (error) {
    const catalogError = new Error(
      [401, 403].includes(error?.status)
        ? '模型列表认证失败，请更新 API Key'
        : `模型列表请求失败：${error?.message || '供应商未返回可用模型'}`
    );
    catalogError.statusCode = [401, 403].includes(error?.status) ? 400 : 502;
    throw catalogError;
  }
}

module.exports = {
  MODEL_CATALOG_TIMEOUT_MS,
  listAvailableAIModels,
  normalizeModelIds,
};
