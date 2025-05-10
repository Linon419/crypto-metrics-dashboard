// src/services/api.js - 增加超时时间并添加重试机制 + 导出数据库功能
import axios from 'axios';

// 创建统一数据缓存存储
const dataCache = {
  latestMetrics: null,
  lastFetchTime: 0,
  coinDetails: new Map(),
  allDatabaseData: null,
  lastDatabaseFetchTime: 0
};

// 创建axios实例 - 增加超时时间
const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3001/api',
  timeout: 60000, // 增加到60秒
  headers: {
    'Content-Type': 'application/json'
  }
});
// Add interceptor to include authorization token in all requests
api.interceptors.request.use(
    (config) => {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error) => {
      return Promise.reject(error);
    }
  );
  
  // Add response interceptor to handle authentication errors
  api.interceptors.response.use(
    (response) => {
      return response;
    },
    (error) => {
      if (error.response && error.response.status === 401) {
        // Clear authentication data and redirect to login
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }
  );
  
  // Authentication API calls
  export const login = async (credentials) => {
    try {
      const response = await api.post('/auth/login', credentials);
      return response.data;
    } catch (error) {
      console.error('Login error:', error);
      throw error.response?.data || error;
    }
  };
  
  export const register = async (userData) => {
    try {
      const response = await api.post('/auth/register', userData);
      return response.data;
    } catch (error) {
      console.error('Registration error:', error);
      throw error.response?.data || error;
    }
  };
  
  export const verifyToken = async () => {
    try {
      const response = await api.get('/auth/verify');
      return response.data;
    } catch (error) {
      console.error('Token verification error:', error);
      throw error.response?.data || error;
    }
  };
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
      if (attempt < maxRetries) {
        console.log(`${retryDelay / 1000}秒后重试...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        retryDelay *= 1.5;
      }
    }
  }
  throw lastError;
}

// 提交原始数据 - 添加重试机制和更长的超时
export const submitRawData = async (rawData) => {
  try {
    if (!rawData || typeof rawData !== 'string') {
      throw new Error('原始数据必须是字符串');
    }
    const submitApi = axios.create({
      baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3001/api',
      timeout: 120000, // 2分钟超时
      headers: { 'Content-Type': 'application/json' }
    });
    const response = await callApiWithRetry(
      () => submitApi.post('/data/input', { rawData }), 3, 3000
    );
    if (response.data && response.data.success) {
      console.log('数据提交成功，强制刷新缓存');
      dataCache.latestMetrics = null;
      dataCache.lastFetchTime = 0;
      dataCache.coinDetails.clear();
      dataCache.allDatabaseData = null;
      dataCache.lastDatabaseFetchTime = 0;
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
    await ensureLatestCoinData(symbol); // Ensures latest single coin data is in cache if needed
    const params = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    const response = await api.get(`/coins/${symbol}/metrics`, { params });
    if (!Array.isArray(response.data)) {
      console.warn(`fetchCoinMetrics: ${symbol} 响应不是数组格式`, response.data);
      return createMockHistoricalData(symbol);
    }
    const metrics = response.data.map(metric => ({
      date: metric.date || new Date().toISOString().split('T')[0],
      otc_index: typeof metric.otc_index === 'number' ? metric.otc_index : 0,
      explosion_index: typeof metric.explosion_index === 'number' ? metric.explosion_index : 0,
      schelling_point: typeof metric.schelling_point === 'number' ? metric.schelling_point : 0,
      entry_exit_type: metric.entry_exit_type || 'neutral',
      entry_exit_day: typeof metric.entry_exit_day === 'number' ? metric.entry_exit_day : 0
    }));
    if (metrics.length > 0) {
      const latestMetricEntry = metrics[metrics.length - 1];
      const cachedData = dataCache.coinDetails.get(symbol);
      if (cachedData && latestMetricEntry.date === cachedData.date) {
        metrics[metrics.length - 1] = {
          date: latestMetricEntry.date,
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

// 确保我们有最新的单个币种数据
async function ensureLatestCoinData(symbol) {
  const now = Date.now();
  const cachedData = dataCache.coinDetails.get(symbol);
  const isCacheValid = cachedData && now - cachedData.lastFetchTime < 5 * 60 * 1000;
  if (!isCacheValid) {
    console.log(`缓存中没有 ${symbol} 的最新数据，获取中...`);
    try {
      await fetchLatestMetrics(true); // This will populate dataCache.coinDetails
    } catch (error) {
      console.error(`无法获取 ${symbol} 的最新数据:`, error);
    }
  }
}

// 获取最新指标数据 (利用后端返回的 previous_day_data)
export const fetchLatestMetrics = async (forceRefresh = false) => {
  try {
    const now = Date.now();
    if (!forceRefresh && dataCache.latestMetrics && (now - dataCache.lastFetchTime < 5 * 60 * 1000)) {
      console.log('使用缓存的最新指标数据');
      return dataCache.latestMetrics;
    }
    
    console.log('获取最新指标数据 (后端已增强)');
    const response = await api.get('/data/latest');
    
    if (!response.data || typeof response.data !== 'object') {
      console.warn('fetchLatestMetrics: 无效的响应数据', response.data);
      return getFallbackMetricsData();
    }
    
    const latestDate = response.data.date || new Date().toISOString().split('T')[0];
    let coinsWithMetrics = [];
    
    if (Array.isArray(response.data.metrics)) {
      coinsWithMetrics = response.data.metrics.map(metric => {
        const coinData = metric.coin || {}; // Backend now nests coin object inside each metric
        let otcIndexChangePercent = null;
        let explosionIndexChangePercent = null;

        if (metric.previous_day_data) {
          const currentOtc = metric.otc_index;
          const prevOtc = metric.previous_day_data.otc_index;
          if (typeof currentOtc === 'number' && typeof prevOtc === 'number') {
            if (prevOtc !== 0) {
              otcIndexChangePercent = ((currentOtc - prevOtc) / prevOtc) * 100;
            } else if (currentOtc !== 0) { // Current is non-zero, previous was zero
              otcIndexChangePercent = Infinity; 
            }
          }

          const currentExplosion = metric.explosion_index;
          const prevExplosion = metric.previous_day_data.explosion_index;
          if (typeof currentExplosion === 'number' && typeof prevExplosion === 'number') {
            if (prevExplosion !== 0) {
              explosionIndexChangePercent = ((currentExplosion - prevExplosion) / prevExplosion) * 100;
            } else if (currentExplosion !== 0) { // Current is non-zero, previous was zero
              explosionIndexChangePercent = Infinity;
            }
          }
        }

        return {
          id: metric.coin_id || coinData.id || 0, 
          symbol: coinData.symbol || 'UNKNOWN',
          name: coinData.name || coinData.symbol || 'Unknown Coin',
          current_price: coinData.current_price === null ? undefined : (coinData.current_price || 0), // Handle null price from backend
          logo_url: coinData.logo_url || null,
          otcIndex: metric.otc_index || 0,
          explosionIndex: metric.explosion_index || 0,
          schellingPoint: metric.schelling_point === null ? 0 : (metric.schelling_point || 0), // Handle null schelling_point
          entryExitType: metric.entry_exit_type || 'neutral',
          entryExitDay: metric.entry_exit_day || 0,
          nearThreshold: !!metric.near_threshold,
          otcIndexChangePercent: otcIndexChangePercent,
          explosionIndexChangePercent: explosionIndexChangePercent,
        };
      });
    }

    // Merge trendingCoins (they might not have previous_day_data from backend unless also modified)
    if (Array.isArray(response.data.trendingCoins)) {
      response.data.trendingCoins.forEach(trendingCoin => {
        if (trendingCoin.symbol) {
          const existingCoin = coinsWithMetrics.find(c => c.symbol === trendingCoin.symbol);
          if (!existingCoin) {
            // For trending coins, if backend provides previous_day_data, it should be handled here.
            // Assuming for now it does not, or is not part of this specific requirement.
            let trendOtcChangePercent = null;
            let trendExplosionChangePercent = null;

            // Hypothetical: if trendingCoin object itself contained a 'previous_day_data' field from backend
            if (trendingCoin.previous_day_data) {
                 const currentOtc = trendingCoin.otc_index;
                 const prevOtc = trendingCoin.previous_day_data.otc_index;
                 if (typeof currentOtc === 'number' && typeof prevOtc === 'number') {
                    if (prevOtc !== 0) trendOtcChangePercent = ((currentOtc - prevOtc) / prevOtc) * 100;
                    else if (currentOtc !== 0) trendOtcChangePercent = Infinity;
                 }
                 const currentExplosion = trendingCoin.explosion_index;
                 const prevExplosion = trendingCoin.previous_day_data.explosion_index;
                 if (typeof currentExplosion === 'number' && typeof prevExplosion === 'number') {
                    if (prevExplosion !== 0) trendExplosionChangePercent = ((currentExplosion - prevExplosion) / prevExplosion) * 100;
                    else if (currentExplosion !== 0) trendExplosionChangePercent = Infinity;
                 }
            }


            coinsWithMetrics.push({
              id: typeof trendingCoin.id === 'number' ? trendingCoin.id : 0, 
              symbol: trendingCoin.symbol,
              name: trendingCoin.name || trendingCoin.symbol,
              current_price: trendingCoin.current_price === null ? undefined : (trendingCoin.current_price || 0),
              logo_url: trendingCoin.logo_url || null,
              otcIndex: trendingCoin.otc_index || 0,
              explosionIndex: trendingCoin.explosion_index || 0,
              schellingPoint: trendingCoin.schelling_point === null ? 0 : (trendingCoin.schelling_point || 0),
              entryExitType: trendingCoin.entry_exit_type || 'neutral',
              entryExitDay: trendingCoin.entry_exit_day || 0,
              nearThreshold: !!trendingCoin.near_threshold,
              otcIndexChangePercent: trendOtcChangePercent, 
              explosionIndexChangePercent: trendExplosionChangePercent,
            });
          }
        }
      });
    }
    
    if (coinsWithMetrics.length === 0) {
      coinsWithMetrics = getFallbackCoins();
    }
    
    const result = {
      date: latestDate,
      coins: coinsWithMetrics,
      liquidity: response.data.liquidity || getDefaultLiquidity(),
      trendingCoins: Array.isArray(response.data.trendingCoins) ? response.data.trendingCoins : []
    };
    
    dataCache.latestMetrics = result;
    dataCache.lastFetchTime = now;
    
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

// 新增: 导出所有数据库数据 - 使用缓存和重试机制
export const exportAllData = async (forceRefresh = false) => {
  try {
    const now = Date.now();
    if (!forceRefresh && dataCache.allDatabaseData && (now - dataCache.lastDatabaseFetchTime < 10 * 60 * 1000)) {
      console.log('使用缓存的数据库导出数据');
      return dataCache.allDatabaseData;
    }
    
    console.log('开始获取所有数据库数据以供导出');
    // Ensure latest metrics (which now include change%) are fetched if needed, they populate dataCache.latestMetrics
    // Pass forceRefresh to this call as well, so it behaves consistently with the exportAllData call.
    await fetchLatestMetrics(forceRefresh); 
    
    const [coinsResponse, metricsResponse, liquidityResponse, datesResponse] = await Promise.all([
      callApiWithRetry(() => api.get('/coins')),
      callApiWithRetry(() => api.get('/metrics')), // This gets ALL metrics from DB
      callApiWithRetry(() => api.get('/liquidity')),
      callApiWithRetry(() => api.get('/data/debug/date-range')),
    ]);
    
    let historicalData = {};
    try {
      const allDisplayableCoinsSymbols = (dataCache.latestMetrics?.coins || []).map(c => c.symbol).filter(Boolean);
      const symbolsToFetchHistoryFor = Array.from(new Set([
        'BTC', 'ETH', 'BNB', 'SOL', // Core coins
        ...allDisplayableCoinsSymbols
      ]));

      for (const symbol of symbolsToFetchHistoryFor) {
        if (!symbol || symbol === 'UNKNOWN') continue;
        try {
          // fetchCoinMetrics will get full history for the chart for this symbol
          const metrics = await fetchCoinMetrics(symbol); 
          if (Array.isArray(metrics) && metrics.length > 0) {
            historicalData[symbol] = metrics;
          } else if (!historicalData[symbol]) {
            historicalData[symbol] = createMockHistoricalData(symbol);
          }
        } catch (err) {
          console.warn(`[exportAllData] 获取 ${symbol} 历史数据失败:`, err.message);
          if (!historicalData[symbol]) {
            historicalData[symbol] = createMockHistoricalData(symbol);
          }
        }
      }
    } catch (historyError) {
      console.warn('[exportAllData] 获取历史数据主逻辑失败', historyError);
    }
    
    const exportData = {
      metadata: {
        exportDate: new Date().toISOString(),
        appVersion: '1.0.0',
        dataLatest: dataCache.latestMetrics?.date || new Date().toISOString().split('T')[0],
        availableDates: datesResponse.data.dates || [],
      },
      coins: coinsResponse.data || [],
      metrics: metricsResponse.data || [], // Full historical metrics from /api/metrics
      liquidity: liquidityResponse.data || [],
      latestData: dataCache.latestMetrics || {}, // This already contains coins with change%
      historicalData: historicalData, // Full history for selected coins for charts/details
    };
    
    dataCache.allDatabaseData = exportData;
    dataCache.lastDatabaseFetchTime = now;
    return exportData;
  } catch (error) {
    console.error('导出数据库数据失败:', error);
    return {
      metadata: { /* ... error metadata ... */ partialExport: true, exportError: error.message },
      coins: [], metrics: [], liquidity: {}, latestData: dataCache.latestMetrics || {}, historicalData: {}
    };
  }
};

// 创建模拟历史数据
function createMockHistoricalData(symbol) {
  console.log(`为 ${symbol} 创建模拟历史数据`);
  const cachedData = dataCache.coinDetails.get(symbol); // coinDetails now has change% if backend worked
  
  const baseExplosionIndex = cachedData?.explosionIndex ?? 180;
  const baseOtcIndex = cachedData?.otcIndex ?? 1200;
  const baseSchellingPoint = cachedData?.schellingPoint ?? 1000;
  const entryExitType = cachedData?.entryExitType ?? 'neutral';
  const entryExitDay = cachedData?.entryExitDay ?? 0;
  
  const mockData = [];
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 30);
  const dayCount = Math.floor((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
  
  for (let i = 0; i <= dayCount; i++) {
    const currentDate = new Date(startDate.getTime());
    currentDate.setDate(startDate.getDate() + i);
    const dateStr = currentDate.toISOString().split('T')[0];
    const randomFactor = Math.sin(i / 10) * 20 + (Math.random() - 0.5) * 15;
    
    mockData.push({
      date: dateStr,
      explosion_index: Math.max(100, Math.min(300, baseExplosionIndex + (i > 0 ? (mockData[i-1].explosion_index - baseExplosionIndex) * 0.2 : 0) + randomFactor * 0.2)),
      otc_index: Math.max(500, Math.min(2000, baseOtcIndex + randomFactor * 5)),
      schelling_point: Math.max(100, baseSchellingPoint * (1 + (randomFactor / 1000))),
      entry_exit_type: entryExitType,
      entry_exit_day: entryExitType !== 'neutral' ? Math.max(0, entryExitDay - (dayCount - i)) : 0 // Mock E/E day decreasing towards past
    });
  }
  
  if (cachedData && mockData.length > 0) {
    const lastMockEntry = mockData[mockData.length - 1];
    // Only overwrite if the last mock date corresponds to "today" or the cached data's date
    const todayStr = new Date().toISOString().split('T')[0];
    if (lastMockEntry.date === todayStr || lastMockEntry.date === cachedData.date) {
        lastMockEntry.explosion_index = cachedData.explosionIndex;
        lastMockEntry.otc_index = cachedData.otcIndex;
        lastMockEntry.schelling_point = cachedData.schellingPoint;
        lastMockEntry.entry_exit_type = cachedData.entryExitType;
        lastMockEntry.entry_exit_day = cachedData.entryExitDay;
    }
  }
  return mockData;
}

// 获取其他API功能
export const fetchCoins = async () => {
  try {
    const response = await api.get('/coins');
    return response.data;
  } catch (error) {
    console.error('Failed to fetch coins list:', error);
    return [];
  }
};

export const fetchDashboardData = async (date) => { /* ... placeholder ... */ };
export const fetchLiquidityOverview = async (date) => { /* ... placeholder ... */ };

// 备用数据函数
function getFallbackCoins() { return []; }
function getDefaultLiquidity() { return { btc_fund_change: 0, eth_fund_change: 0, sol_fund_change: 0, total_market_fund_change: 0, comments: "暂无数据" }; }
function getFallbackMetricsData() {
  return {
    date: new Date().toISOString().split('T')[0],
    coins: getFallbackCoins(),
    liquidity: getDefaultLiquidity(),
    trendingCoins: []
  };
}
export const importDatabaseDump = async (dumpData) => {
    try {
        console.log('开始批量导入数据库，数据大小:', JSON.stringify(dumpData).length);
        
        // 设置更长的超时时间，因为大型数据集导入可能需要更多时间
        const response = await api.post('/data/import-database', dumpData, {
          timeout: 300000, // 60秒超时
          headers: {
            'Content-Type': 'application/json',
            'X-Database-Import': 'true' // 添加自定义头，标识这是数据库导入请求
          }
        });
        
        console.log('批量导入成功，响应:', response.data);
        return response.data;
      }catch (error) {
        console.error('批量导入数据库失败:', error);
    
        // 详细的错误日志
        if (error.response) {
          console.error('响应状态码:', error.response.status);
          console.error('响应数据:', error.response.data);
          throw { 
            error: '导入失败', 
            details: error.response.data?.error || error.response.data?.details || error.message,
            statusCode: error.response.status
          };
        } else if (error.request) {
          console.error('未收到响应，请求超时或网络问题');
          throw { 
            error: '导入失败', 
            details: '请求超时或网络连接失败。数据可能太大或服务器未响应。',
            statusCode: 0
          };
        }
        throw { error: '导入失败', details: error.message };
    }
  };
// Change password
export const changePassword = async (passwordData) => {
    try {
      const response = await api.put('/auth/change-password', passwordData);
      return response.data;
    } catch (error) {
      console.error('Password change error:', error);
      if (error.response && error.response.data) {
        throw error.response.data;
      } else {
        throw { error: '密码修改失败，请稍后重试' };
      }
    }
  };