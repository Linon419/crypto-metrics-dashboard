// src/services/optionsApi.js
// BTC 波动率与期权链、策略搭建、收益计算。
// 从 api.js 拆出，逻辑未改动；api.js 统一再导出，组件导入路径不变。
import { api, dataCache, callApiWithRetry } from './apiClient';

export const fetchBtcVolatility = async ({ refresh = false } = {}) => {
  const now = Date.now();
  if (!refresh && dataCache.btcVolatility && (now - dataCache.lastBtcVolatilityFetchTime < 60 * 1000)) {
    return dataCache.btcVolatility;
  }

  try {
    const response = await callApiWithRetry(() => api.get('/volatility/btc', {
      params: refresh ? { refresh: 1 } : undefined,
    }));
    if (response.data && response.data.success) {
      dataCache.btcVolatility = response.data;
      dataCache.lastBtcVolatilityFetchTime = now;
      return response.data;
    }
    throw new Error(response.data?.error || '获取BTC波动率失败');
  } catch (error) {
    console.error('获取BTC波动率失败:', error.displayMessage || error.message);
    throw new Error(error.displayMessage || '获取BTC波动率失败');
  }
};

export const fetchBtcVolatilityHistory = async ({ refresh = false, lookbackHours = 24 * 30, resolution = '60' } = {}) => {
  const now = Date.now();
  const cacheKey = `${lookbackHours}:${resolution}`;
  const cached = dataCache.btcVolatilityHistories.get(cacheKey);
  if (!refresh && cached && (now - cached.fetchTime < 60 * 1000)) {
    return cached.data;
  }

  try {
    const response = await callApiWithRetry(() => api.get('/volatility/btc/history', {
      params: {
        lookbackHours,
        resolution,
        ...(refresh ? { refresh: 1 } : {}),
      },
    }));
    if (response.data && response.data.success) {
      dataCache.btcVolatilityHistories.set(cacheKey, {
        fetchTime: now,
        data: response.data,
      });
      return response.data;
    }
    throw new Error(response.data?.error || '获取BTC隐含波动率历史失败');
  } catch (error) {
    console.error('获取BTC隐含波动率历史失败:', error.displayMessage || error.message);
    throw new Error(error.displayMessage || '获取BTC隐含波动率历史失败');
  }
};

export const fetchBtcOptionChain = async ({ refresh = false } = {}) => {
  const now = Date.now();
  if (!refresh && dataCache.btcOptionChain && (now - dataCache.lastBtcOptionChainFetchTime < 30 * 1000)) {
    return dataCache.btcOptionChain;
  }

  try {
    const response = await callApiWithRetry(() => api.get('/options/btc/chain', {
      params: refresh ? { refresh: 1 } : undefined,
    }));
    if (response.data && response.data.success) {
      dataCache.btcOptionChain = response.data;
      dataCache.lastBtcOptionChainFetchTime = now;
      return response.data;
    }
    throw new Error(response.data?.error || '获取BTC期权链失败');
  } catch (error) {
    console.error('获取BTC期权链失败:', error.displayMessage || error.message);
    throw new Error(error.displayMessage || '获取BTC期权链失败');
  }
};

export const fetchBtcOptionStrategySetup = async (
  strategyId,
  { refresh = false, priceBasis = 'mark', expirationDate = null } = {},
) => {
  if (!strategyId) {
    throw new Error('strategyId is required');
  }

  const cacheKey = `${strategyId}:${priceBasis}:${expirationDate || 'auto'}`;
  const now = Date.now();
  const cached = dataCache.btcOptionStrategySetups.get(cacheKey);
  if (!refresh && cached && (now - cached.fetchTime < 15 * 1000)) {
    return cached.data;
  }

  try {
    const response = await callApiWithRetry(() => api.get(`/options/btc/strategies/${strategyId}/setup`, {
      params: {
        priceBasis,
        ...(expirationDate ? { expirationDate } : {}),
        ...(refresh ? { refresh: 1 } : {}),
      },
    }));
    if (response.data && response.data.success) {
      dataCache.btcOptionStrategySetups.set(cacheKey, {
        fetchTime: now,
        data: response.data,
      });
      return response.data;
    }
    throw new Error(response.data?.error || '获取BTC期权策略搭建失败');
  } catch (error) {
    console.error('获取BTC期权策略搭建失败:', error.displayMessage || error.message);
    throw new Error(error.displayMessage || '获取BTC期权策略搭建失败');
  }
};

export const calculateBtcOptionPayoff = async ({ legs, underlyingPrice, pointCount = 81, ivShiftPoints = 10, timeScenarioDays = [1, 3, 7] }) => {
  try {
    const response = await callApiWithRetry(() => api.post('/options/btc/payoff', {
      legs,
      underlyingPrice,
      pointCount,
      ivShiftPoints,
      timeScenarioDays,
    }));
    if (response.data && response.data.success) {
      return response.data;
    }
    throw new Error(response.data?.error || '计算BTC期权盈亏失败');
  } catch (error) {
    console.error('计算BTC期权盈亏失败:', error.displayMessage || error.message);
    throw new Error(error.displayMessage || '计算BTC期权盈亏失败');
  }
};

