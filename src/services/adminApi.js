// src/services/adminApi.js
// 管理后台：用户、系统设置、K 线映射与清理、AI 配置、日期记录。
// 从 api.js 拆出，逻辑未改动；api.js 统一再导出，组件导入路径不变。
import { api, dataCache, callApiWithRetry } from './apiClient';

export const getAllUsers = async () => {
  try {
    const response = await callApiWithRetry(() => api.get('/admin/users'));
    return response.data;
  } catch (error) {
    console.error('[getAllUsers] 获取用户列表失败:', error.displayMessage || error.message);
    throw error;
  }
};

export const getUserAuditLogs = async ({ limit = 50 } = {}) => {
  try {
    const response = await callApiWithRetry(() => api.get('/admin/users/audit-logs', {
      params: { limit },
    }));
    return response.data;
  } catch (error) {
    console.error('[getUserAuditLogs] 获取用户审计日志失败:', error.displayMessage || error.message);
    throw error;
  }
};

// 创建新用户
export const createUser = async (userData) => {
  try {
    const response = await callApiWithRetry(() => api.post('/admin/users', userData));
    return response.data;
  } catch (error) {
    console.error('[createUser] 创建用户失败:', error.displayMessage || error.message);
    throw error;
  }
};

// 更新用户信息
export const updateUser = async (userId, userData) => {
  try {
    const response = await callApiWithRetry(() => api.put(`/admin/users/${userId}`, userData));
    return response.data;
  } catch (error) {
    console.error('[updateUser] 更新用户失败:', error.displayMessage || error.message);
    throw error;
  }
};

// 删除用户
export const deleteUser = async (userId) => {
  try {
    const response = await callApiWithRetry(() => api.delete(`/admin/users/${userId}`));
    return response.data;
  } catch (error) {
    console.error('[deleteUser] 删除用户失败:', error.displayMessage || error.message);
    throw error;
  }
};

// 封禁用户
export const banUser = async (userId) => {
  try {
    const response = await callApiWithRetry(() => api.post(`/admin/users/${userId}/ban`));
    return response.data;
  } catch (error) {
    console.error('[banUser] 封禁用户失败:', error.displayMessage || error.message);
    throw error;
  }
};

// 解封用户
export const unbanUser = async (userId) => {
  try {
    const response = await callApiWithRetry(() => api.post(`/admin/users/${userId}/unban`));
    return response.data;
  } catch (error) {
    console.error('[unbanUser] 解封用户失败:', error.displayMessage || error.message);
    throw error;
  }
};

// 获取注册状态（公开接口，无需认证）
export const getRegistrationStatus = async () => {
  try {
    const response = await callApiWithRetry(() => api.get('/public/registration-status'));
    return response.data;
  } catch (error) {
    console.error('[getRegistrationStatus] 获取注册状态失败:', error.displayMessage || error.message);
    throw error;
  }
};

// 获取系统设置
export const getSystemSettings = async () => {
  try {
    const response = await callApiWithRetry(() => api.get('/admin/settings'));
    return response.data;
  } catch (error) {
    console.error('[getSystemSettings] 获取系统设置失败:', error.displayMessage || error.message);
    throw error;
  }
};

// 更新系统设置
export const updateSystemSettings = async (settings) => {
  try {
    const response = await callApiWithRetry(() => api.put('/admin/settings', settings));
    return response.data;
  } catch (error) {
    console.error('[updateSystemSettings] 更新系统设置失败:', error.displayMessage || error.message);
    throw error;
  }
};

export const fetchKlineMappings = async () => {
  try {
    const response = await callApiWithRetry(() => api.get('/admin/kline-mappings'));
    return response.data;
  } catch (error) {
    console.error('[fetchKlineMappings] 获取K线映射失败:', error.displayMessage || error.message);
    throw error;
  }
};

export const updateKlineMapping = async (coinId, payload) => {
  try {
    const response = await callApiWithRetry(() => api.put(`/admin/kline-mappings/${coinId}`, payload));
    dataCache.coinKlines.clear();
    return response.data;
  } catch (error) {
    console.error('[updateKlineMapping] 更新K线映射失败:', error.displayMessage || error.message);
    throw error;
  }
};

export const preferBinanceKlineMappings = async () => {
  try {
    const response = await callApiWithRetry(() => api.post('/admin/kline-mappings/prefer-binance'));
    dataCache.coinKlines.clear();
    return response.data;
  } catch (error) {
    console.error('[preferBinanceKlineMappings] 币安优先同步失败:', error.displayMessage || error.message);
    throw error;
  }
};

export const seedDefaultKlineMappings = async () => {
  try {
    const response = await callApiWithRetry(() => api.post('/admin/kline-mappings/seed-defaults'));
    dataCache.coinKlines.clear();
    return response.data;
  } catch (error) {
    console.error('[seedDefaultKlineMappings] 补齐默认K线映射失败:', error.displayMessage || error.message);
    throw error;
  }
};

export const fetchOpenAIPromptSettings = async () => {
  try {
    const response = await callApiWithRetry(() => api.get('/admin/openai-prompt-settings'));
    return response.data;
  } catch (error) {
    console.error('[fetchOpenAIPromptSettings] 获取AI解析Prompt设置失败:', error.displayMessage || error.message);
    throw error;
  }
};

export const fetchOpenAIModelSettings = async () => {
  try {
    const response = await callApiWithRetry(() => api.get('/admin/openai-model-settings'));
    return response.data;
  } catch (error) {
    console.error('[fetchOpenAIModelSettings] 获取AI模型设置失败:', error.displayMessage || error.message);
    throw error;
  }
};

export const fetchAvailableAIModels = async (payload) => {
  try {
    const response = await callApiWithRetry(() => api.post('/admin/openai-model-settings/models', payload));
    return response.data;
  } catch (error) {
    console.error('[fetchAvailableAIModels] 同步AI模型列表失败:', error.displayMessage || error.message);
    throw error;
  }
};

export const updateOpenAIModelSettings = async (payload) => {
  try {
    const response = await callApiWithRetry(() => api.put('/admin/openai-model-settings', payload));
    return response.data;
  } catch (error) {
    console.error('[updateOpenAIModelSettings] 保存AI模型设置失败:', error.displayMessage || error.message);
    throw error;
  }
};

export const resetOpenAIModelSettings = async () => {
  try {
    const response = await callApiWithRetry(() => api.post('/admin/openai-model-settings/reset'));
    return response.data;
  } catch (error) {
    console.error('[resetOpenAIModelSettings] 恢复AI模型设置失败:', error.displayMessage || error.message);
    throw error;
  }
};

export const updateOpenAIPromptSettings = async (payload) => {
  try {
    const response = await callApiWithRetry(() => api.put('/admin/openai-prompt-settings', payload));
    return response.data;
  } catch (error) {
    console.error('[updateOpenAIPromptSettings] 保存AI解析Prompt设置失败:', error.displayMessage || error.message);
    throw error;
  }
};

export const resetOpenAIPromptSettings = async () => {
  try {
    const response = await callApiWithRetry(() => api.post('/admin/openai-prompt-settings/reset'));
    return response.data;
  } catch (error) {
    console.error('[resetOpenAIPromptSettings] 恢复AI解析Prompt设置失败:', error.displayMessage || error.message);
    throw error;
  }
};

export const previewKlineCleanup = async (payload) => {
  try {
    const response = await callApiWithRetry(() => api.post('/admin/kline-cleanup/preview', payload));
    return response.data;
  } catch (error) {
    console.error('[previewKlineCleanup] 预览K线清理失败:', error.displayMessage || error.message);
    throw error;
  }
};

export const deleteKlinesByCleanupFilters = async (payload) => {
  try {
    const response = await callApiWithRetry(() => api.post('/admin/kline-cleanup/delete', {
      ...payload,
      confirm: true,
    }));
    dataCache.coinKlines.clear();
    return response.data;
  } catch (error) {
    console.error('[deleteKlinesByCleanupFilters] 删除K线失败:', error.displayMessage || error.message);
    throw error;
  }
};

export const fetchAdminCoins = async () => {
  try {
    const response = await callApiWithRetry(() => api.get('/admin/coins'));
    return response.data;
  } catch (error) {
    console.error('[fetchAdminCoins] 获取币种列表失败:', error.displayMessage || error.message);
    throw error;
  }
};

export const createAdminCoin = async (payload) => {
  try {
    const response = await callApiWithRetry(() => api.post('/admin/coins', payload));
    dataCache.coinDetails.clear();
    dataCache.latestMetrics = null;
    return response.data;
  } catch (error) {
    console.error('[createAdminCoin] 创建币种失败:', error.displayMessage || error.message);
    throw error;
  }
};

export const updateAdminCoin = async (coinId, payload) => {
  try {
    const response = await callApiWithRetry(() => api.put(`/admin/coins/${coinId}`, payload));
    dataCache.coinDetails.clear();
    dataCache.latestMetrics = null;
    dataCache.coinKlines.clear();
    return response.data;
  } catch (error) {
    console.error('[updateAdminCoin] 更新币种失败:', error.displayMessage || error.message);
    throw error;
  }
};

export const deleteAdminCoin = async (coinId, { force = false } = {}) => {
  try {
    const response = await callApiWithRetry(() => api.delete(`/admin/coins/${coinId}`, {
      params: force ? { force: 'true' } : {},
    }));
    dataCache.coinDetails.clear();
    dataCache.latestMetrics = null;
    dataCache.coinKlines.clear();
    dataCache.favorites = null;
    return response.data;
  } catch (error) {
    console.error('[deleteAdminCoin] 删除币种失败:', error.displayMessage || error.message);
    throw error;
  }
};

export const getDateRecordSummary = async (date) => {
  try {
    const response = await api.get(`/admin/date-records/${encodeURIComponent(date)}/summary`);
    return response.data;
  } catch (error) {
    console.error('[getDateRecordSummary] 获取日期数据概况失败:', error.displayMessage || error.message);
    throw error;
  }
};

export const updateDateRecordTime = async (date, { time, timePrecision }) => {
  try {
    const response = await api.put(`/admin/date-records/${encodeURIComponent(date)}/time`, {
      time,
      timePrecision,
    });
    dataCache.latestMetrics = null;
    dataCache.lastFetchTime = 0;
    dataCache.coinDetails.clear();
    dataCache.allDatabaseData = null;
    dataCache.lastDatabaseFetchTime = 0;
    return response.data;
  } catch (error) {
    console.error('[updateDateRecordTime] 修改日期时间失败:', error.displayMessage || error.message);
    throw error;
  }
};

export const deleteDateRecordsByDate = async (date) => {
  try {
    const response = await api.delete(`/admin/date-records/${encodeURIComponent(date)}`);
    dataCache.latestMetrics = null;
    dataCache.lastFetchTime = 0;
    dataCache.coinDetails.clear();
    dataCache.allDatabaseData = null;
    dataCache.lastDatabaseFetchTime = 0;
    return response.data;
  } catch (error) {
    console.error('[deleteDateRecordsByDate] 删除日期数据失败:', error.displayMessage || error.message);
    throw error;
  }
};
// --- 结束用户管理 API 调用 ---
