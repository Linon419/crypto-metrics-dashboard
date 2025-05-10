// src/services/api.js
import axios from 'axios';

// --- 1. 运行时 API 基地址配置 ---
// 默认的 API 基地址，主要用于本地开发或作为备用
let effectiveApiBaseUrl = 'http://localhost:3001/api'; // 本地开发默认指向后端开发端口

// 检查 window.runtimeConfig 是否存在并且包含 API_BASE_URL (由后端 /app-config.js 提供)
if (window.runtimeConfig && typeof window.runtimeConfig.API_BASE_URL === 'string') {
  effectiveApiBaseUrl = window.runtimeConfig.API_BASE_URL;
  console.log('[API Client] Using runtime API_BASE_URL:', effectiveApiBaseUrl);
} else {
  // 如果是生产环境但配置未加载，这可能是一个严重问题
  if (process.env.NODE_ENV === 'production') {
    console.error(
      '[API Client] CRITICAL: Runtime configuration (window.runtimeConfig.API_BASE_URL) not found in production. Falling back to default, which might be incorrect:',
      effectiveApiBaseUrl
    );
  } else {
    console.warn(
      '[API Client] Runtime configuration (window.runtimeConfig.API_BASE_URL) not found. Using default for development:',
      effectiveApiBaseUrl
    );
  }
  if (window.runtimeConfig && window.runtimeConfig.error) {
    console.error('[API Client] Server reported configuration error:', window.runtimeConfig.error);
  }
}
// --- 结束运行时 API 基地址配置 ---

// 创建统一数据缓存存储
const dataCache = {
  latestMetrics: null,
  lastFetchTime: 0,
  coinDetails: new Map(),
  allDatabaseData: null,
  lastDatabaseFetchTime: 0
};

// --- 2. 创建主 Axios 实例 ---
const api = axios.create({
  baseURL: effectiveApiBaseUrl, // 使用动态获取的基地址
  timeout: 60000, // 默认60秒超时
  headers: {
    'Content-Type': 'application/json'
  }
});

// --- 3. Axios 拦截器 ---
// 请求拦截器：添加认证 Token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    console.error('[API Request Interceptor Error]', error);
    return Promise.reject(error);
  }
);

// 响应拦截器：处理认证错误 (401) - 应该先于通用错误/日志拦截器
api.interceptors.response.use(
  (response) => response, // 直接返回成功响应
  (error) => {
    if (error.response && error.response.status === 401) {
      console.warn('[API Auth Error] Received 401 Unauthorized. Clearing token and redirecting to login.');
      localStorage.removeItem('token');
      localStorage.removeItem('user'); // 假设你也存储了用户信息
      // 避免在测试环境或非浏览器环境中执行跳转
      if (typeof window !== 'undefined' && window.location) {
        // 如果当前不是登录页，则跳转，防止循环跳转
        if (window.location.pathname !== '/login') {
            window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error); // 重要的是将原始错误继续传递
  }
);

// 响应拦截器：通用日志和错误包装 - 在401处理之后
api.interceptors.response.use(
  response => {
    // console.log(`[API Success] ${response.config.method?.toUpperCase()} ${response.config.url}`, response.status, response.data);
    return response;
  },
  error => {
    const config = error.config || {};
    const url = config.url || '未知请求';
    const method = config.method?.toUpperCase() || '请求';

    if (error.response) {
      // 服务器响应了错误状态码
      console.error(`[API Error] ${method} ${url} responded with ${error.response.status}:`, error.response.data);
    } else if (error.request) {
      // 请求已发出，但没有收到响应 (例如网络错误, 超时)
      console.error(`[API Error] No response received for ${method} ${url}:`, error.request);
    } else {
      // 设置请求时发生了一些事情，触发了错误
      console.error(`[API Error] Error setting up request for ${method} ${url}:`, error.message);
    }

    // 为上层调用者提供一个统一的错误对象或消息
    // 保持原始错误信息，但可以附加一个更友好的消息
    const errorMessage = error.response?.data?.message || // 后端自定义的 message
                         error.response?.data?.error ||   // 后端自定义的 error
                         error.message ||                 // Axios 或网络错误消息
                         '网络请求失败，请稍后重试';
    
    // 可以创建一个新的错误对象，包含更多上下文，或者直接修改原始错误
    // 为了让上层 catch 块能访问 error.response.data，最好是 reject(error)
    // 但如果想统一错误消息，可以创建一个新 Error
    // return Promise.reject(new Error(errorMessage));
    // 或者，为了保留 error.response 等属性:
    error.displayMessage = errorMessage; // 添加一个易于显示的属性
    return Promise.reject(error);
  }
);
// --- 结束 Axios 拦截器 ---


// --- 4. 认证 API 调用 ---
export const login = async (credentials) => {
  try {
    const response = await api.post('/auth/login', credentials);
    return response.data;
  } catch (error) {
    console.error('Login API call failed:', error.displayMessage || error.message);
    throw error; // 抛出经过拦截器处理的错误
  }
};

export const register = async (userData) => {
  try {
    const response = await api.post('/auth/register', userData);
    return response.data;
  } catch (error) {
    console.error('Register API call failed:', error.displayMessage || error.message);
    throw error;
  }
};

export const verifyToken = async () => {
  try {
    const response = await api.get('/auth/verify');
    return response.data;
  } catch (error) {
    console.error('Token verification API call failed:', error.displayMessage || error.message);
    throw error;
  }
};

export const changePassword = async (passwordData) => {
  try {
    const response = await api.put('/auth/change-password', passwordData);
    return response.data;
  } catch (error) {
    console.error('Change password API call failed:', error.displayMessage || error.message);
    throw error;
  }
};
// --- 结束认证 API 调用 ---


// --- 5. 具有重试功能的 API 调用封装 ---
async function callApiWithRetry(apiCall, maxRetries = 3, initialRetryDelay = 2000) {
  let lastError;
  let retryDelay = initialRetryDelay;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // console.log(`API Call Attempt ${attempt}/${maxRetries}...`);
      return await apiCall();
    } catch (error) {
      lastError = error;
      console.warn(`API Call Attempt ${attempt}/${maxRetries} failed:`, error.displayMessage || error.message);
      // 不对 401 或 403 (权限问题) 进行重试，因为它们通常不是临时性网络问题
      if (error.response && (error.response.status === 401 || error.response.status === 403)) {
        console.log(`Skipping retry for ${error.response.status} error.`);
        throw lastError;
      }
      if (attempt < maxRetries) {
        console.log(`Retrying in ${retryDelay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        retryDelay = Math.min(retryDelay * 1.5, 30000); // 增加延迟，但设置上限
      }
    }
  }
  console.error(`API Call failed after ${maxRetries} retries.`);
  throw lastError;
}
// --- 结束重试功能封装 ---


// --- 6. 数据提交和获取 API 调用 ---
export const submitRawData = async (rawData) => {
  if (!rawData || typeof rawData !== 'string') {
    // 这种客户端验证错误不应该重试
    throw new Error('原始数据必须是字符串且不能为空');
  }
  try {
    // 对于大数据量提交，使用独立的 Axios 实例配置（如果需要不同的超时或特定头）
    // 但如果拦截器（如token）也需要，则需要确保它们也被应用
    // 为了简单起见，如果baseURL是相同的，可以考虑使用全局api实例并覆盖特定配置
    const response = await callApiWithRetry(
      () => api.post('/data/input', { rawData }, { timeout: 120000 }), // 使用全局api，覆盖超时
      3,
      3000
    );

    if (response.data && response.data.success) {
      console.log('数据提交成功，清除相关缓存...');
      dataCache.latestMetrics = null;
      dataCache.lastFetchTime = 0;
      dataCache.coinDetails.clear();
      dataCache.allDatabaseData = null; // 如果导出数据也依赖于此，也清除
      dataCache.lastDatabaseFetchTime = 0;
      try {
        // 尝试在后台静默刷新数据，不阻塞提交成功的用户体验
        fetchLatestMetrics(true).catch(refreshError => {
          console.warn('后台刷新数据失败 (数据已提交成功):', refreshError.displayMessage || refreshError.message);
        });
      } catch (e) { /* no-op, already caught by inner promise */ }
    }
    return response.data;
  } catch (error) {
    console.error('提交数据最终失败:', error.displayMessage || error.message);
    // 抛出错误，让调用者处理UI提示
    throw new Error(error.displayMessage || '提交数据时发生未知错误');
  }
};

export const fetchLatestMetrics = async (forceRefresh = false) => {
  const now = Date.now();
  if (!forceRefresh && dataCache.latestMetrics && (now - dataCache.lastFetchTime < 5 * 60 * 1000)) {
    // console.log('Using cached latest metrics.');
    return dataCache.latestMetrics;
  }

  try {
    // console.log('Fetching latest metrics from server...');
    const response = await callApiWithRetry(() => api.get('/data/latest')); // 使用重试

    if (!response.data || typeof response.data !== 'object') {
      console.warn('fetchLatestMetrics: Invalid response data from /data/latest', response.data);
      return getFallbackMetricsData(); // 返回备用数据
    }

    const latestDate = response.data.date || new Date().toISOString().split('T')[0];
    let coinsWithMetrics = [];

    if (Array.isArray(response.data.metrics)) {
      coinsWithMetrics = response.data.metrics.map(metric => {
        const coinData = metric.coin || {};
        let otcIndexChangePercent = metric.otc_index_change_percent; // 直接使用后端计算的值
        let explosionIndexChangePercent = metric.explosion_index_change_percent; // 直接使用后端计算的值
        
        // 如果后端没有提供 change_percent, 可以尝试前端计算 (如果 previous_day_data 存在)
        // 但理想情况是后端提供这些，以保证数据一致性
        if (otcIndexChangePercent === undefined && metric.previous_day_data) {
            const currentOtc = metric.otc_index;
            const prevOtc = metric.previous_day_data.otc_index;
            if (typeof currentOtc === 'number' && typeof prevOtc === 'number') {
                if (prevOtc !== 0) otcIndexChangePercent = ((currentOtc - prevOtc) / prevOtc) * 100;
                else if (currentOtc !== 0) otcIndexChangePercent = Infinity;
                else otcIndexChangePercent = 0;
            }
        }
         if (explosionIndexChangePercent === undefined && metric.previous_day_data) {
            const currentExplosion = metric.explosion_index;
            const prevExplosion = metric.previous_day_data.explosion_index;
            if (typeof currentExplosion === 'number' && typeof prevExplosion === 'number') {
                if (prevExplosion !== 0) explosionIndexChangePercent = ((currentExplosion - prevExplosion) / prevExplosion) * 100;
                else if (currentExplosion !== 0) explosionIndexChangePercent = Infinity;
                else explosionIndexChangePercent = 0;
            }
        }


        return {
          id: metric.coin_id || coinData.id || Date.now() + Math.random(), // Fallback ID
          symbol: coinData.symbol || 'UNKNOWN',
          name: coinData.name || coinData.symbol || 'Unknown Coin',
          current_price: coinData.current_price === null ? undefined : (typeof coinData.current_price === 'number' ? coinData.current_price : 0),
          logo_url: coinData.logo_url || null,
          otcIndex: typeof metric.otc_index === 'number' ? metric.otc_index : 0,
          explosionIndex: typeof metric.explosion_index === 'number' ? metric.explosion_index : 0,
          schellingPoint: metric.schelling_point === null ? 0 : (typeof metric.schelling_point === 'number' ? metric.schelling_point : 0),
          entryExitType: metric.entry_exit_type || 'neutral',
          entryExitDay: typeof metric.entry_exit_day === 'number' ? metric.entry_exit_day : 0,
          nearThreshold: !!metric.near_threshold,
          otcIndexChangePercent: otcIndexChangePercent,
          explosionIndexChangePercent: explosionIndexChangePercent,
          date: metric.date || latestDate, // 添加日期到每个币的指标中
        };
      });
    }
    
    // 合并 trendingCoins (如果它们不由 metrics 提供)
    // 假设 trendingCoins 结构与 metrics 结构类似或可以映射
    if (Array.isArray(response.data.trendingCoins)) {
      response.data.trendingCoins.forEach(trendingCoinRaw => {
        const trendingCoin = trendingCoinRaw.coin || trendingCoinRaw; // 适应后端可能嵌套coin对象
        if (trendingCoin.symbol) {
          const existingCoin = coinsWithMetrics.find(c => c.symbol === trendingCoin.symbol);
          if (!existingCoin) {
            // 假设 trendingCoin 也有 change_percent 或 previous_day_data
            let trendOtcChangePercent = trendingCoin.otc_index_change_percent;
            let trendExplosionChangePercent = trendingCoin.explosion_index_change_percent;

            coinsWithMetrics.push({
              id: trendingCoin.id || Date.now() + Math.random(),
              symbol: trendingCoin.symbol,
              name: trendingCoin.name || trendingCoin.symbol,
              current_price: trendingCoin.current_price === null ? undefined : (typeof trendingCoin.current_price === 'number' ? trendingCoin.current_price : 0),
              logo_url: trendingCoin.logo_url || null,
              otcIndex: typeof trendingCoin.otc_index === 'number' ? trendingCoin.otc_index : 0,
              explosionIndex: typeof trendingCoin.explosion_index === 'number' ? trendingCoin.explosion_index : 0,
              schellingPoint: trendingCoin.schelling_point === null ? 0 : (typeof trendingCoin.schelling_point === 'number' ? trendingCoin.schelling_point : 0),
              entryExitType: trendingCoin.entry_exit_type || 'neutral',
              entryExitDay: typeof trendingCoin.entry_exit_day === 'number' ? trendingCoin.entry_exit_day : 0,
              nearThreshold: !!trendingCoin.near_threshold,
              otcIndexChangePercent: trendOtcChangePercent,
              explosionIndexChangePercent: trendExplosionChangePercent,
              date: trendingCoin.date || latestDate,
            });
          }
        }
      });
    }

    if (coinsWithMetrics.length === 0 && process.env.NODE_ENV !== 'test') { // 测试时可能期望空数组
      console.warn('No coins with metrics found, returning fallback.');
      coinsWithMetrics = getFallbackCoins();
    }

    const result = {
      date: latestDate,
      coins: coinsWithMetrics,
      liquidity: response.data.liquidity || getDefaultLiquidity(),
      trendingCoins: Array.isArray(response.data.trendingCoins) ? response.data.trendingCoins.map(tc => tc.coin || tc) : [] // 确保是扁平结构
    };

    dataCache.latestMetrics = result;
    dataCache.lastFetchTime = now;

    // 更新单个币种的缓存 (coinDetails)
    coinsWithMetrics.forEach(coin => {
      dataCache.coinDetails.set(coin.symbol, {
        ...coin, // 包含所有处理过的字段，如 change% 和 date
        lastFetchTime: now
      });
    });

    return result;
  } catch (error) {
    console.error('获取最新指标数据最终失败:', error.displayMessage || error.message);
    return getFallbackMetricsData(); // 发生错误时返回备用数据
  }
};

async function ensureLatestCoinData(symbol, forceRefresh = false) {
  const now = Date.now();
  const cachedData = dataCache.coinDetails.get(symbol);
  const isCacheValid = cachedData && (now - cachedData.lastFetchTime < 1 * 60 * 1000); // 缩短单个币种缓存时间

  if (forceRefresh || !isCacheValid) {
    // console.log(`Cache for ${symbol} is invalid or refresh forced. Fetching latest metrics...`);
    try {
      await fetchLatestMetrics(true); // 强制刷新所有最新指标，这将更新 coinDetails
    } catch (error) {
      console.error(`Error ensuring latest data for ${symbol} (during fetchLatestMetrics):`, error.displayMessage || error.message);
      // 即使刷新失败，也可能从旧缓存中获取
    }
  }
  // 返回缓存中的数据（可能是刚更新的，也可能是旧的但仍然是最佳可用）
  return dataCache.coinDetails.get(symbol);
}

export const fetchCoinMetrics = async (symbol, { startDate, endDate } = {}) => {
  if (!symbol || symbol === 'UNKNOWN') {
    console.warn('fetchCoinMetrics called with invalid symbol:', symbol);
    return createMockHistoricalData(symbol || 'UNKNOWN_SYMBOL');
  }

  try {
    // 首先确保 coinDetails 缓存中有相对新的数据，这有助于 createMockHistoricalData
    await ensureLatestCoinData(symbol);

    const params = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;

    // 获取历史指标数据
    const response = await callApiWithRetry(() => api.get(`/coins/${symbol}/metrics`, { params }));

    if (!Array.isArray(response.data)) {
      console.warn(`fetchCoinMetrics: API response for ${symbol} is not an array.`, response.data);
      return createMockHistoricalData(symbol);
    }
    
    if (response.data.length === 0) {
        // console.log(`fetchCoinMetrics: No historical data from API for ${symbol}. Using mock.`);
        return createMockHistoricalData(symbol);
    }

    const metrics = response.data.map(metric => ({
      date: metric.date || new Date().toISOString().split('T')[0], // Fallback date
      otc_index: typeof metric.otc_index === 'number' ? metric.otc_index : 0,
      explosion_index: typeof metric.explosion_index === 'number' ? metric.explosion_index : 0,
      schelling_point: typeof metric.schelling_point === 'number' ? metric.schelling_point : 0,
      entry_exit_type: metric.entry_exit_type || 'neutral',
      entry_exit_day: typeof metric.entry_exit_day === 'number' ? metric.entry_exit_day : 0
    }));

    // 如果获取的历史数据包含今天的日期，并且 coinDetails 缓存中有今天的最新数据，则用缓存的最新数据替换历史数据中的今天条目
    const latestCachedCoinData = dataCache.coinDetails.get(symbol);
    if (latestCachedCoinData && metrics.length > 0) {
      const lastHistoricalEntry = metrics[metrics.length - 1];
      if (lastHistoricalEntry.date === latestCachedCoinData.date) { // 假设 latestCachedCoinData 也包含 date
        // console.log(`Updating last historical entry for ${symbol} with latest cached data for date ${latestCachedCoinData.date}`);
        metrics[metrics.length - 1] = {
          date: latestCachedCoinData.date,
          otc_index: latestCachedCoinData.otcIndex,
          explosion_index: latestCachedCoinData.explosionIndex,
          schelling_point: latestCachedCoinData.schellingPoint,
          entry_exit_type: latestCachedCoinData.entryExitType,
          entry_exit_day: latestCachedCoinData.entryExitDay,
        };
      }
    }
    return metrics;
  } catch (error) {
    console.error(`获取 ${symbol} 指标历史数据失败:`, error.displayMessage || error.message);
    return createMockHistoricalData(symbol); // 出错时返回模拟数据
  }
};

export const exportAllData = async (forceRefresh = false) => {
  const now = Date.now();
  if (!forceRefresh && dataCache.allDatabaseData && (now - dataCache.lastDatabaseFetchTime < 10 * 60 * 1000)) {
    // console.log('Using cached database export data.');
    return dataCache.allDatabaseData;
  }

  console.log('Fetching all data for export...');
  try {
    // 确保最新的指标数据被获取，它将填充 dataCache.latestMetrics
    await fetchLatestMetrics(true); // 强制刷新以获取最新状态

    const [coinsResponse, allMetricsResponse, liquidityResponse, datesResponse] = await Promise.all([
      callApiWithRetry(() => api.get('/coins')), // 获取所有币种基础信息
      callApiWithRetry(() => api.get('/metrics')), // 获取数据库中所有历史指标原始数据
      callApiWithRetry(() => api.get('/liquidity')), // 获取流动性概览历史
      callApiWithRetry(() => api.get('/data/debug/date-range')), // 获取数据日期范围
    ]);

    const historicalChartData = {};
    const symbolsForChartHistory = Array.from(
      new Set([
        'BTC', 'ETH', // 核心币种
        ...(dataCache.latestMetrics?.coins?.map(c => c.symbol).filter(Boolean) || []),
        ...(dataCache.latestMetrics?.trendingCoins?.map(c => c.symbol).filter(Boolean) || [])
      ])
    );

    for (const symbol of symbolsForChartHistory) {
      if (!symbol || symbol === 'UNKNOWN') continue;
      try {
        // fetchCoinMetrics 用于获取图表所需的处理过的历史数据
        const chartMetrics = await fetchCoinMetrics(symbol); // 这会使用其内部的缓存和API调用
        historicalChartData[symbol] = chartMetrics;
      } catch (err) {
        console.warn(`[ExportAllData] Failed to fetch chart history for ${symbol}:`, err.displayMessage || err.message);
        historicalChartData[symbol] = createMockHistoricalData(symbol); // 出错时也填充模拟数据
      }
    }

    const exportData = {
      metadata: {
        exportDate: new Date().toISOString(),
        appVersion: process.env.REACT_APP_VERSION || '1.0.0', // 从env获取版本
        dataRangeStart: datesResponse.data?.startDate,
        dataRangeEnd: datesResponse.data?.endDate,
      },
      allCoinsInfo: coinsResponse.data || [],
      allHistoricalMetricsRaw: allMetricsResponse.data || [], // 后端 /metrics 返回的原始数据
      allLiquidityHistory: liquidityResponse.data || [],
      latestProcessedData: dataCache.latestMetrics || getFallbackMetricsData(), // 包含处理过的最新指标和变化率
      historicalChartData: historicalChartData, // 为图表准备的处理过的历史数据
    };

    dataCache.allDatabaseData = exportData;
    dataCache.lastDatabaseFetchTime = now;
    console.log('All data fetched and processed for export.');
    return exportData;
  } catch (error) {
    console.error('导出所有数据库数据最终失败:', error.displayMessage || error.message);
    return {
      metadata: { exportDate: new Date().toISOString(), error: true, errorMessage: error.displayMessage || error.message },
      // 返回部分数据或空结构
      allCoinsInfo: [], allHistoricalMetricsRaw: [], allLiquidityHistory: [],
      latestProcessedData: dataCache.latestMetrics || getFallbackMetricsData(),
      historicalChartData: {}
    };
  }
};

export const importDatabaseDump = async (dumpData) => {
  if (!dumpData || typeof dumpData !== 'object') {
    throw new Error('导入数据不能为空且必须是对象');
  }
  try {
    console.log('Starting database import. Data size (keys):', Object.keys(dumpData).length);
    const response = await api.post('/data/import-database', dumpData, {
      timeout: 300000, // 5分钟超时
      headers: {
        'Content-Type': 'application/json',
        'X-Database-Import': 'true' // 自定义头，供后端识别
      }
    });
    console.log('Database import successful:', response.data);
    // 导入成功后，清除所有缓存以强制重新获取
    dataCache.latestMetrics = null;
    dataCache.lastFetchTime = 0;
    dataCache.coinDetails.clear();
    dataCache.allDatabaseData = null;
    dataCache.lastDatabaseFetchTime = 0;
    return response.data;
  } catch (error) {
    console.error('数据库批量导入失败:', error);
    const details = error.response?.data?.error || error.response?.data?.details || error.displayMessage || error.message;
    throw new Error(`导入失败: ${details}`);
  }
};
// --- 结束数据提交和获取 API 调用 ---


// --- 7. 其他辅助 API 调用 ---
export const fetchCoins = async () => { // 获取所有币种列表（基础信息）
  try {
    const response = await callApiWithRetry(() => api.get('/coins'));
    return response.data || [];
  } catch (error) {
    console.error('Failed to fetch coins list:', error.displayMessage || error.message);
    return []; // 返回空数组作为备用
  }
};

// 占位符，根据需要实现
export const fetchDashboardData = async (date) => { console.warn("fetchDashboardData not implemented"); return {}; };
export const fetchLiquidityOverview = async (date) => { console.warn("fetchLiquidityOverview not implemented"); return {}; };
// --- 结束其他辅助 API 调用 ---


// --- 8. 备用数据函数 ---
function getFallbackCoins() { return []; }
function getDefaultLiquidity() { return { btc_fund_change: 0, eth_fund_change: 0, sol_fund_change: 0, total_market_fund_change: 0, comments: "暂无流动性数据" }; }

function getFallbackMetricsData() {
  return {
    date: new Date().toISOString().split('T')[0],
    coins: getFallbackCoins(),
    liquidity: getDefaultLiquidity(),
    trendingCoins: []
  };
}

function createMockHistoricalData(symbol = 'UNKNOWN') {
  // console.log(`Creating mock historical data for ${symbol}`);
  const latestCoinData = dataCache.coinDetails.get(symbol);

  const baseData = {
    otc_index: latestCoinData?.otcIndex ?? (1000 + Math.random() * 500),
    explosion_index: latestCoinData?.explosionIndex ?? (150 + Math.random() * 100),
    schelling_point: latestCoinData?.schellingPoint ?? (800 + Math.random() * 400),
    entry_exit_type: latestCoinData?.entryExitType ?? 'neutral',
    entry_exit_day: latestCoinData?.entryExitDay ?? 0,
  };

  const mockHistory = [];
  const today = new Date();
  for (let i = 30; i >= 0; i--) { // 生成过去30天的数据
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    if (i === 0 && latestCoinData && latestCoinData.date === dateStr) { // 如果是今天且有最新数据
      mockHistory.push({
        date: dateStr,
        otc_index: latestCoinData.otcIndex,
        explosion_index: latestCoinData.explosionIndex,
        schelling_point: latestCoinData.schellingPoint,
        entry_exit_type: latestCoinData.entryExitType,
        entry_exit_day: latestCoinData.entryExitDay,
      });
    } else {
      const factor = Math.sin((30 - i) / 5) * 0.1 + (Math.random() - 0.5) * 0.15; // 模拟波动
      mockHistory.push({
        date: dateStr,
        otc_index: Math.max(100, Math.round(baseData.otc_index * (1 + factor))),
        explosion_index: Math.max(50, Math.round(baseData.explosion_index * (1 + factor * 0.5))),
        schelling_point: Math.max(50, Math.round(baseData.schelling_point * (1 + factor * 0.2))),
        entry_exit_type: baseData.entry_exit_type, // 简化模拟，不改变历史类型
        entry_exit_day: baseData.entry_exit_type !== 'neutral' ? Math.max(0, baseData.entry_exit_day - i) : 0,
      });
    }
  }
  return mockHistory;
}
// --- 结束备用数据函数 ---