// src/services/api.js - 增加超时时间并添加重试机制
import axios from 'axios';

// 创建统一数据缓存存储
const dataCache = {
  latestMetrics: null,
  lastFetchTime: 0,
  coinDetails: new Map()
};

// 创建axios实例 - 增加超时时间
const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3001/api',
  timeout: 60000, // 增加到60秒
  headers: {
    'Content-Type': 'application/json'
  }
});

// 添加响应拦截器用于调试
api.interceptors.response.use(
  response => {
    console.log(`API响应成功: ${response.config.url}`, response.data);
    return response;
  },
  error => {
    console.error(`API错误: ${error.config?.url || '未知请求'}`, error);
    const errorMsg = error.response?.data?.error || error.message || '网络请求失败';
    return Promise.reject(new Error(errorMsg));
  }
);

// 具有重试功能的API调用
async function callApiWithRetry(apiCall, maxRetries = 3, retryDelay = 2000) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`尝试API调用 (尝试 ${attempt}/${maxRetries})...`);
      return await apiCall();
    } catch (error) {
      lastError = error;
      console.error(`API调用失败 (尝试 ${attempt}/${maxRetries}):`, error.message);
      
      // 如果不是最后一次尝试，等待一段时间后重试
      if (attempt < maxRetries) {
        console.log(`${retryDelay / 1000}秒后重试...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        // 每次重试增加延迟
        retryDelay *= 1.5;
      }
    }
  }
  throw lastError; // 所有重试都失败，抛出最后一个错误
}

// 提交原始数据 - 添加重试机制和更长的超时
export const submitRawData = async (rawData) => {
  try {
    if (!rawData || typeof rawData !== 'string') {
      throw new Error('原始数据必须是字符串');
    }
    
    console.log('开始提交数据，长度:', rawData.length);
    console.log('前100个字符:', rawData.substring(0, 100));
    
    // 创建一个特殊的提交实例，超时时间更长
    const submitApi = axios.create({
      baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3001/api',
      timeout: 120000, // 2分钟超时
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    // 使用重试机制提交数据
    const response = await callApiWithRetry(
      () => submitApi.post('/data/input', { rawData }),
      3, // 最多重试3次
      3000 // 初始等待3秒
    );
    
    console.log('提交成功，响应:', response.data);
    
    // 重要：提交成功后，强制刷新缓存
    if (response.data && response.data.success) {
      console.log('数据提交成功，强制刷新缓存');
      dataCache.latestMetrics = null;
      dataCache.lastFetchTime = 0;
      dataCache.coinDetails.clear();
      
      // 立即获取最新数据
      try {
        await fetchLatestMetrics(true);
      } catch (refreshError) {
        console.warn('刷新数据失败，但数据已提交成功:', refreshError);
      }
    }
    
    return response.data;
  } catch (error) {
    console.error('提交数据失败:', error);
    let errorMessage = '提交数据失败';
    if (error.response) {
      errorMessage += `: 服务器返回 ${error.response.status} - ${JSON.stringify(error.response.data)}`;
    } else if (error.request) {
      errorMessage += ': 未收到服务器响应';
    } else {
      errorMessage += `: ${error.message}`;
    }
    throw new Error(errorMessage);
  }
};

// 获取特定币种的指标数据 - 确保与最新数据一致
export const fetchCoinMetrics = async (symbol, { startDate, endDate } = {}) => {
  try {
    // 首先确保我们有最新的单个币种数据
    await ensureLatestCoinData(symbol);
    
    const params = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    
    console.log(`获取 ${symbol} 的历史指标数据`);
    const response = await api.get(`/coins/${symbol}/metrics`, { params });
    
    if (!Array.isArray(response.data)) {
      console.warn(`fetchCoinMetrics: ${symbol} 响应不是数组格式`, response.data);
      return createMockHistoricalData(symbol);
    }
    
    // 确保每条指标记录都有必要的字段，防止NaN值
    const metrics = response.data.map(metric => ({
      date: metric.date || new Date().toISOString().split('T')[0],
      otc_index: typeof metric.otc_index === 'number' ? metric.otc_index : 0,
      explosion_index: typeof metric.explosion_index === 'number' ? metric.explosion_index : 0,
      schelling_point: typeof metric.schelling_point === 'number' ? metric.schelling_point : 0,
      entry_exit_type: metric.entry_exit_type || 'neutral',
      entry_exit_day: typeof metric.entry_exit_day === 'number' ? metric.entry_exit_day : 0
    }));
    
    // 关键步骤：确保最新的指标值与卡片上显示的一致
    if (metrics.length > 0) {
      const latestMetric = metrics[metrics.length - 1];
      const cachedData = dataCache.coinDetails.get(symbol);
      
      // 如果有缓存数据，替换最新一天的数据，确保一致性
      if (cachedData && latestMetric.date === cachedData.date) {
        console.log(`使用缓存数据更新 ${symbol} 的最新指标`);
        metrics[metrics.length - 1] = {
          date: latestMetric.date,
          otc_index: cachedData.otcIndex,
          explosion_index: cachedData.explosionIndex,
          schelling_point: cachedData.schellingPoint,
          entry_exit_type: cachedData.entryExitType,
          entry_exit_day: cachedData.entryExitDay
        };
      }
    }
    
    return metrics;
  } catch (error) {
    console.error(`获取${symbol}指标数据失败:`, error);
    return createMockHistoricalData(symbol);
  }
};

// 其他API函数，使用原来的实现
// ...

// 确保我们有最新的单个币种数据
async function ensureLatestCoinData(symbol) {
  const now = Date.now();
  const cachedData = dataCache.coinDetails.get(symbol);
  const isCacheValid = cachedData && now - cachedData.lastFetchTime < 5 * 60 * 1000;
  
  if (!isCacheValid) {
    console.log(`缓存中没有 ${symbol} 的最新数据，获取中...`);
    try {
      // 获取最新的所有币种数据
      await fetchLatestMetrics(true);
    } catch (error) {
      console.error(`无法获取 ${symbol} 的最新数据:`, error);
    }
  }
}

// 获取最新指标数据 - 确保数据一致性
export const fetchLatestMetrics = async (forceRefresh = false) => {
  try {
    // 检查缓存是否有效 (5分钟内)
    const now = Date.now();
    const isCacheValid = dataCache.latestMetrics && 
                         now - dataCache.lastFetchTime < 5 * 60 * 1000;
    
    // 如果缓存有效且不强制刷新，直接返回缓存数据
    if (isCacheValid && !forceRefresh) {
      console.log('使用缓存的最新指标数据');
      return dataCache.latestMetrics;
    }
    
    console.log('获取最新指标数据 (强制刷新:', forceRefresh, ')');
    const response = await api.get('/data/latest');
    
    if (!response.data || typeof response.data !== 'object') {
      console.warn('fetchLatestMetrics: 无效的响应数据', response.data);
      return getFallbackMetricsData();
    }
    
    // 确保date字段存在
    const date = response.data.date || new Date().toISOString().split('T')[0];
    
    // 处理币种和指标数据
    let coinsWithMetrics = [];
    if (Array.isArray(response.data.metrics)) {
      // 将API返回的复杂格式转换为前端所需的简单格式
      coinsWithMetrics = response.data.metrics.map(metric => {
        const coin = metric.coin || {};
        return {
          id: metric.coin_id || 0,
          symbol: coin.symbol || 'UNKNOWN',
          name: coin.name || coin.symbol || 'Unknown Coin',
          current_price: coin.current_price || 0,
          logo_url: coin.logo_url || null,
          otcIndex: metric.otc_index || 0,
          explosionIndex: metric.explosion_index || 0,
          schellingPoint: metric.schelling_point || 0,
          entryExitType: metric.entry_exit_type || 'neutral',
          entryExitDay: metric.entry_exit_day || 0,
          nearThreshold: !!metric.near_threshold
        };
      });
    }
    
    if (coinsWithMetrics.length === 0) {
      console.warn('fetchLatestMetrics: 未找到币种数据，使用备用数据');
      coinsWithMetrics = getFallbackCoins();
    }
    
    // 准备结果
    const result = {
      date,
      coins: coinsWithMetrics,
      liquidity: response.data.liquidity || getDefaultLiquidity(),
      trendingCoins: Array.isArray(response.data.trendingCoins) ? response.data.trendingCoins : []
    };
    
    // 更新缓存
    dataCache.latestMetrics = result;
    dataCache.lastFetchTime = now;
    
    // 同时更新单个币种缓存
    coinsWithMetrics.forEach(coin => {
      dataCache.coinDetails.set(coin.symbol, {
        ...coin,
        lastFetchTime: now
      });
    });
    
    return result;
  } catch (error) {
    console.error('获取最新指标数据失败:', error);
    return getFallbackMetricsData();
  }
};

// 创建模拟历史数据
function createMockHistoricalData(symbol) {
  console.log(`为 ${symbol} 创建模拟历史数据`);
  
  // 获取缓存中的币种数据作为基准
  const cachedData = dataCache.coinDetails.get(symbol);
  
  // 设置基准值 - 优先使用缓存数据
  const baseExplosionIndex = cachedData ? cachedData.explosionIndex : 180;
  const baseOtcIndex = cachedData ? cachedData.otcIndex : 1200;
  const baseSchellingPoint = cachedData ? cachedData.schellingPoint : 1000;
  const entryExitType = cachedData ? cachedData.entryExitType : 'neutral';
  const entryExitDay = cachedData ? cachedData.entryExitDay : 0;
  
  const mockData = [];
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 30);
  
  const dayCount = Math.floor((endDate - startDate) / (24 * 60 * 60 * 1000));
  
  // 生成每天的数据
  for (let i = 0; i <= dayCount; i++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + i);
    const dateStr = currentDate.toISOString().split('T')[0];
    
    const randomFactor = Math.sin(i / 10) * 20 + (Math.random() - 0.5) * 15;
    const explosionChange = i === 0 ? 0 : mockData[i-1].explosion_index - baseExplosionIndex + randomFactor;
    
    mockData.push({
      date: dateStr,
      explosion_index: Math.max(100, Math.min(300, baseExplosionIndex + explosionChange * 0.2)),
      otc_index: Math.max(500, Math.min(2000, baseOtcIndex + randomFactor * 5)),
      schelling_point: Math.max(100, baseSchellingPoint * (1 + (randomFactor / 1000))),
      entry_exit_type: entryExitType,
      entry_exit_day: entryExitType !== 'neutral' ? entryExitDay + i : 0
    });
  }
  
  // 确保最后一天的数据与缓存一致
  if (cachedData && mockData.length > 0) {
    mockData[mockData.length - 1].explosion_index = cachedData.explosionIndex;
    mockData[mockData.length - 1].otc_index = cachedData.otcIndex;
    mockData[mockData.length - 1].schelling_point = cachedData.schellingPoint;
    mockData[mockData.length - 1].entry_exit_type = cachedData.entryExitType;
    mockData[mockData.length - 1].entry_exit_day = cachedData.entryExitDay;
  }
  
  return mockData;
}

// 获取其他API功能 - 这些是占位符，实际项目需要实现完整功能
export const fetchCoins = async () => {
  // 实现此函数
};

export const fetchDashboardData = async (date) => {
  // 实现此函数
};

export const fetchLiquidityOverview = async (date) => {
  // 实现此函数
};

// 备用数据函数 - 这些是占位符，实际项目需要实现
function getFallbackCoins() {
  return []; // 返回备用币种数据
}

function getDefaultLiquidity() {
  return {}; // 返回默认流动性数据
}

function getFallbackMetricsData() {
  return {
    date: new Date().toISOString().split('T')[0],
    coins: getFallbackCoins(),
    liquidity: getDefaultLiquidity(),
    trendingCoins: []
  };
}