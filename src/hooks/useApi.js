// src/hooks/useApi.js
import { useState, useEffect, useCallback } from 'react';
import { 
  fetchCoins, 
  fetchCoinMetrics, 
  fetchDashboardData, 
  submitRawData,
  fetchLiquidityOverview,
  fetchLatestMetrics
} from '../services/api';

// 通用API调用hook
export const useApiCall = (apiFunction) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const execute = useCallback(async (...args) => {
    try {
      setLoading(true);
      setError(null);
      const result = await apiFunction(...args);
      setData(result);
      return result;
    } catch (err) {
      setError(err.message || 'An error occurred');
      return null;
    } finally {
      setLoading(false);
    }
  }, [apiFunction]);
  
  return { data, loading, error, execute };
};

// 获取所有币种
export const useCoins = () => {
  const { data, loading, error, execute } = useApiCall(fetchCoins);
  
  useEffect(() => {
    execute();
  }, [execute]);
  
  return { coins: data, loading, error, refetch: execute };
};

// 获取币种指标数据
export const useCoinMetrics = (symbol, options = {}) => {
  const { data, loading, error, execute } = useApiCall(fetchCoinMetrics);
  
  useEffect(() => {
    if (symbol) {
      execute(symbol, options);
    }
  }, [symbol, options, execute]);
  
  return { metrics: data, loading, error, refetch: execute };
};

// 获取仪表盘数据
export const useDashboard = (date) => {
  const { data, loading, error, execute } = useApiCall(fetchDashboardData);
  
  useEffect(() => {
    execute(date);
  }, [date, execute]);
  
  return { dashboard: data, loading, error, refetch: execute };
};

// 提交原始数据
export const useDataSubmission = () => {
  const { data, loading, error, execute } = useApiCall(submitRawData);
  
  return { result: data, loading, error, submitData: execute };
};

// 获取流动性概况
export const useLiquidity = (date) => {
  const { data, loading, error, execute } = useApiCall(fetchLiquidityOverview);
  
  useEffect(() => {
    execute(date);
  }, [date, execute]);
  
  return { liquidity: data, loading, error, refetch: execute };
};

// 获取最新指标数据
export const useLatestMetrics = () => {
  const { data, loading, error, execute } = useApiCall(fetchLatestMetrics);
  
  useEffect(() => {
    execute();
  }, [execute]);
  
  return { latestData: data, loading, error, refetch: execute };
};