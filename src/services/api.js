// src/services/api.js
import axios from 'axios';
import { getRawDataTimezoneOffset } from '../utils/inputPreprocess';

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
  lastDatabaseFetchTime: 0,
  favorites: null,
  lastFavoritesFetchTime: 0,
  btcVolatility: null,
  lastBtcVolatilityFetchTime: 0,
  btcVolatilityHistory: null,
  lastBtcVolatilityHistoryFetchTime: 0,
  btcVolatilityHistories: new Map(),
  btcOptionChain: null,
  lastBtcOptionChainFetchTime: 0,
  btcOptionStrategySetups: new Map(),
  coinKlines: new Map()
};

function parseMomentumIndicators(value) {
  if (Array.isArray(value)) {
    return value
      .map(indicator => String(indicator).trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    if (!trimmedValue) return [];

    try {
      return parseMomentumIndicators(JSON.parse(trimmedValue));
    } catch (error) {
      return [trimmedValue];
    }
  }

  return [];
}

function buildMetricVersionKey(item = {}) {
  const timestamp = item.timestamp || item.timeStamp || null;
  if (!timestamp) return `${item.date || ''}|day`;

  const parsed = new Date(timestamp);
  return `${item.date || ''}|${Number.isNaN(parsed.getTime()) ? timestamp : parsed.getTime()}`;
}

// --- 2. 创建主 Axios 实例 ---
const api = axios.create({
  baseURL: effectiveApiBaseUrl, // 使用动态获取的基地址
  timeout: 60000, // 默认60秒超时
  headers: {
    'Content-Type': 'application/json'
  }
});

export function buildKlineWebSocketUrl(symbol, interval = '1d', apiBaseUrl = effectiveApiBaseUrl) {
  const browserOrigin = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'http://localhost:3001';
  const url = new URL(apiBaseUrl || 'http://localhost:3001/api', browserOrigin);
  const basePath = url.pathname.replace(/\/api\/?$/, '').replace(/\/$/, '');

  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${basePath}/ws/klines`;
  url.search = '';
  url.searchParams.set('symbol', String(symbol || '').toUpperCase());
  url.searchParams.set('interval', interval);
  return url.toString();
}

export function subscribeCoinKlineStream(symbol, {
  interval = '1d',
  onMessage,
  onStatus,
  onError,
  WebSocketCtor,
} = {}) {
  const SocketCtor = WebSocketCtor || (typeof window !== 'undefined' ? window.WebSocket : null);
  if (!SocketCtor || !symbol) {
    return () => {};
  }

  const socket = new SocketCtor(buildKlineWebSocketUrl(symbol, interval));

  socket.onopen = () => {
    onStatus?.({ type: 'status', status: 'open' });
  };
  socket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'kline') {
        onMessage?.(payload);
        return;
      }
      if (payload.type === 'status') {
        onStatus?.(payload);
        return;
      }
      if (payload.type === 'error') {
        onError?.(new Error(payload.message || 'Kline WebSocket error'));
      }
    } catch (error) {
      onError?.(error);
    }
  };
  socket.onerror = (event) => {
    onError?.(event);
  };

  return () => {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.close?.();
  };
}

// --- 3. Axios 拦截器 ---
// 请求拦截器：添加认证 Token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    // 收藏功能现在只使用用户ID，不需要设备ID
    
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


// --- 设备ID函数已移除，收藏功能现在只使用用户ID ---


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
    const requestBody = {
      rawData,
      clientTimezoneOffsetMinutes: getRawDataTimezoneOffset(rawData),
    };
    const response = await callApiWithRetry(
      () => api.post('/data/input', requestBody, { timeout: 420000 }), // 7分钟超时，处理大量数据（留出比服务器更多的缓冲时间）
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
    console.error('完整错误对象:', error);

    // 保留原始错误对象的response属性
    const enhancedError = new Error(error.displayMessage || error.message || '提交数据时发生未知错误');
    enhancedError.response = error.response;
    enhancedError.displayMessage = error.displayMessage;
    enhancedError.name = error.name || 'Error';

    // 抛出增强的错误对象
    throw enhancedError;
  }
};

// 按日期获取数据
export const fetchDataByDate = async (date) => {
  try {
    console.log(`获取 ${date} 的数据...`);
    const response = await callApiWithRetry(() => api.get(`/data/by-date/${date}`));

    if (response.data && response.data.success) {
      console.log(`成功获取 ${date} 的数据，包含 ${response.data.totalCoins} 个币种`);
      return response.data;
    } else {
      throw new Error(response.data?.error || '获取数据失败');
    }
  } catch (error) {
    console.error(`获取 ${date} 数据失败:`, error.displayMessage || error.message);
    throw new Error(error.displayMessage || `获取 ${date} 数据失败`);
  }
};

export const fetchAvailableDataDates = async () => {
  try {
    const response = await callApiWithRetry(() => api.get('/data/available-dates'));

    if (response.data && response.data.success) {
      return response.data;
    }

    throw new Error(response.data?.error || '获取可用日期失败');
  } catch (error) {
    console.error('获取可用日期失败:', error.displayMessage || error.message);
    throw new Error(error.displayMessage || '获取可用日期失败');
  }
};

export const fetchLatestMetrics = async (forceRefresh = false) => {
  const now = Date.now();
  if (!forceRefresh && dataCache.latestMetrics && (now - dataCache.lastFetchTime < 5 * 60 * 1000)) {
    // console.log('Using cached latest metrics.');
    return dataCache.latestMetrics;
  }

  try {
    const response = await callApiWithRetry(() => api.get('/data/latest'));
    // console.log('[API SERVICE - RAW RESPONSE DATA] /data/latest:', JSON.stringify(response.data, null, 2));


    if (!response.data || typeof response.data !== 'object') {
      console.warn('fetchLatestMetrics: Invalid response data from /data/latest', response.data);
      return getFallbackMetricsData();
    }

    const latestDate = response.data.date || new Date().toISOString().split('T')[0];
    let coinsWithMetrics = [];

    if (Array.isArray(response.data.metrics)) {
      coinsWithMetrics = response.data.metrics.map(metric => {
        const coinData = metric.coin || {};
        let otcIndexChangePercent = metric.otc_index_change_percent;
        let explosionIndexChangePercent = metric.explosion_index_change_percent;

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
          id: metric.coin_id || coinData.id || Date.now() + Math.random(),
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
          momentumIndicators: parseMomentumIndicators(metric.momentum_indicators || metric.momentumIndicators),
          otcIndexChangePercent: otcIndexChangePercent,
          explosionIndexChangePercent: explosionIndexChangePercent,
          date: metric.date || latestDate,
          timestamp: metric.timestamp || null,
          timePrecision: metric.time_precision || metric.timePrecision || 'day',
          time_precision: metric.time_precision || metric.timePrecision || 'day',
          previousDayData: metric.previous_day_data, // Ensure this is passed through
          period_quality: metric.period_quality,
          riskNotes: Array.isArray(metric.risk_notes) ? metric.risk_notes : [],
          strategySignal: metric.strategy_signal || metric.strategySignal || null,
          strategy_signal: metric.strategy_signal || metric.strategySignal || null,
        };
      });
      // if (coinsWithMetrics.length > 0) {
      //   console.log('[API SERVICE - MAPPED coinsWithMetrics[0]]', JSON.stringify(coinsWithMetrics[0], null, 2));
      // } else {
      //   console.log('[API SERVICE - MAPPED coinsWithMetrics] is empty');
      // }
    }

    if (Array.isArray(response.data.trendingCoins)) {
      response.data.trendingCoins.forEach(trendingCoinRaw => {
        const trendingCoin = trendingCoinRaw.coin || trendingCoinRaw;
        if (trendingCoin.symbol) {
          const existingCoin = coinsWithMetrics.find(c => c.symbol === trendingCoin.symbol);
          if (!existingCoin) {
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
              momentumIndicators: parseMomentumIndicators(trendingCoin.momentum_indicators || trendingCoin.momentumIndicators),
              otcIndexChangePercent: trendOtcChangePercent,
              explosionIndexChangePercent: trendExplosionChangePercent,
              date: trendingCoin.date || latestDate,
              timestamp: trendingCoin.timestamp || null,
              timePrecision: trendingCoin.time_precision || trendingCoin.timePrecision || 'day',
              time_precision: trendingCoin.time_precision || trendingCoin.timePrecision || 'day',
              previousDayData: trendingCoin.previous_day_data, // Also pass for trending coins if available
              period_quality: trendingCoin.period_quality,
              riskNotes: Array.isArray(trendingCoin.risk_notes) ? trendingCoin.risk_notes : [],
              strategySignal: trendingCoin.strategy_signal || trendingCoin.strategySignal || null,
              strategy_signal: trendingCoin.strategy_signal || trendingCoin.strategySignal || null,
            });
          }
        }
      });
    }

    if (coinsWithMetrics.length === 0 && process.env.NODE_ENV !== 'test') {
      console.warn('No coins with metrics found, returning fallback.');
      coinsWithMetrics = getFallbackCoins();
    }

    const result = {
      date: latestDate,
      coins: coinsWithMetrics,
      liquidity: response.data.liquidity || getDefaultLiquidity(),
      optionTuning: response.data.optionTuning || null,
      trendingCoins: Array.isArray(response.data.trendingCoins) ? response.data.trendingCoins.map(tc => tc.coin || tc) : []
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
    console.error('获取最新指标数据最终失败:', error.displayMessage || error.message);
    return getFallbackMetricsData();
  }
};

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
      timestamp: metric.timestamp || null,
      time_precision: metric.time_precision || 'day',
      otc_index: typeof metric.otc_index === 'number' ? metric.otc_index : 0,
      explosion_index: typeof metric.explosion_index === 'number' ? metric.explosion_index : 0,
      schelling_point: typeof metric.schelling_point === 'number' ? metric.schelling_point : 0,
      entry_exit_type: metric.entry_exit_type || 'neutral',
      entry_exit_day: typeof metric.entry_exit_day === 'number' ? metric.entry_exit_day : 0,
      near_threshold: !!metric.near_threshold,
      period_quality: metric.period_quality || null,
    }));

    // 如果获取的历史数据包含今天的日期，并且 coinDetails 缓存中有今天的最新数据，则用缓存的最新数据替换历史数据中的今天条目
    const latestCachedCoinData = dataCache.coinDetails.get(symbol);
    if (latestCachedCoinData && metrics.length > 0) {
      const lastHistoricalEntry = metrics[metrics.length - 1];
      if (
        lastHistoricalEntry.date === latestCachedCoinData.date &&
        buildMetricVersionKey(lastHistoricalEntry) === buildMetricVersionKey(latestCachedCoinData)
      ) {
        // console.log(`Updating last historical entry for ${symbol} with latest cached data for date ${latestCachedCoinData.date}`);
        metrics[metrics.length - 1] = {
          date: latestCachedCoinData.date,
          timestamp: latestCachedCoinData.timestamp || lastHistoricalEntry.timestamp || null,
          time_precision: latestCachedCoinData.timePrecision || latestCachedCoinData.time_precision || lastHistoricalEntry.time_precision || 'day',
          otc_index: latestCachedCoinData.otcIndex,
          explosion_index: latestCachedCoinData.explosionIndex,
          schelling_point: latestCachedCoinData.schellingPoint,
          entry_exit_type: latestCachedCoinData.entryExitType,
          entry_exit_day: latestCachedCoinData.entryExitDay,
          near_threshold: !!latestCachedCoinData.nearThreshold,
          period_quality: latestCachedCoinData.period_quality || lastHistoricalEntry.period_quality || null,
        };
      }
    }
    return metrics;
  } catch (error) {
    console.error(`获取 ${symbol} 指标历史数据失败:`, error.displayMessage || error.message);
    return createMockHistoricalData(symbol); // 出错时返回模拟数据
  }
};

export const fetchCoinKlines = async (symbol, {
  interval = '1d',
  limit = 365,
  refresh = false,
  startTime,
  endTime,
  includePrePost = false,
} = {}) => {
  if (!symbol) {
    return { symbol: '', interval, klines: [] };
  }

  const now = Date.now();
  const sessionKey = includePrePost ? 'prepost' : 'regular';
  const cacheKey = `${String(symbol).toUpperCase()}:${interval}:${limit}:${startTime || ''}:${endTime || ''}:${sessionKey}`;
  const cached = dataCache.coinKlines.get(cacheKey);
  if (!refresh && cached && (now - cached.fetchTime < 60 * 1000)) {
    return cached.data;
  }

  try {
    const params = {
      interval,
      limit,
      includePrePost: includePrePost ? 1 : 0,
      ...(refresh ? { refresh: 1 } : {}),
    };
    if (startTime) params.startTime = startTime;
    if (endTime) params.endTime = endTime;

    const response = await callApiWithRetry(() => api.get(`/coins/${symbol}/klines`, { params }));
    const data = response.data || { symbol, interval, klines: [] };
    dataCache.coinKlines.set(cacheKey, {
      fetchTime: now,
      data,
    });
    return data;
  } catch (error) {
    console.error(`获取 ${symbol} K线失败:`, error.displayMessage || error.message);
    return { symbol, interval, klines: [] };
  }
};

export const startKlineBackfill = async ({
  mode,
  intervals = ['15m', '1h', '4h', '1d'],
  delayMs = 5000,
  limit = 1500,
  maxChunksPerCoin = 40,
} = {}) => {
  try {
    const response = await callApiWithRetry(() => api.post('/coins/klines/backfill', {
      mode,
      intervals,
      delayMs,
      limit,
      maxChunksPerCoin,
    }));
    dataCache.coinKlines.clear();
    return response.data;
  } catch (error) {
    console.error('启动K线回补失败:', error.displayMessage || error.message);
    throw new Error(error.displayMessage || '启动K线回补失败');
  }
};

export const fetchKlineBackfillStatus = async () => {
  try {
    const response = await callApiWithRetry(() => api.get('/coins/klines/backfill/status'));
    return response.data;
  } catch (error) {
    console.error('获取K线回补进度失败:', error.displayMessage || error.message);
    throw new Error(error.displayMessage || '获取K线回补进度失败');
  }
};

export const fetchLiquidityHistory = async ({ startDate, endDate } = {}) => {
  try {
    const params = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;

    const response = await callApiWithRetry(() => api.get('/liquidity', { params }));
    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    console.error('获取流动性历史数据失败:', error.displayMessage || error.message);
    return [];
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

// 在api.js中的importDatabaseDump函数中添加以下代码

export const importDatabaseDump = async (dumpData) => {
    if (!dumpData || typeof dumpData !== 'object') {
      throw new Error('导入数据不能为空且必须是对象');
    }
    
    // 检测简单JSON格式并转换为数据库导入格式
    if (dumpData.coins && Array.isArray(dumpData.coins) && !dumpData.allCoinsInfo && !dumpData.allHistoricalMetricsRaw) {
      console.log('检测到简单JSON格式，转换为数据库导入格式');
      dumpData = transformSimpleFormatToImportFormat(dumpData);
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
      dataCache.favorites = null;
      dataCache.lastFavoritesFetchTime = 0;
      return response.data;
    } catch (error) {
      console.error('数据库批量导入失败:', error);
      const details = error.response?.data?.error || error.response?.data?.details || error.displayMessage || error.message;
      throw new Error(`导入失败: ${details}`);
    }
  };
  
  // 添加一个新函数，用于转换简单JSON格式为完整导入格式
  function transformSimpleFormatToImportFormat(inputData) {
    const now = new Date().toISOString();
    
    // 处理日期
    let dateValue = inputData.date;
    if (!dateValue) {
      // 如果没有提供日期，使用今天的日期
      dateValue = new Date().toISOString().split('T')[0];
    }
    
    // 处理币种
    const allCoinsInfo = [];
    const allHistoricalMetricsRaw = [];
    
    // 处理输入的币种数据
    if (Array.isArray(inputData.coins)) {
      inputData.coins.forEach(coin => {
        // 添加到币种列表
        allCoinsInfo.push({
          symbol: coin.symbol.toUpperCase(),
          name: coin.name || coin.symbol.toUpperCase(),
          current_price: coin.current_price || 0,
          logo_url: coin.logo_url || null
        });
        
        // 添加到指标列表
        allHistoricalMetricsRaw.push({
          date: dateValue,
          symbol: coin.symbol.toUpperCase(), // 添加symbol字段，便于后端处理
          otc_index: coin.otcIndex,
          explosion_index: coin.explosionIndex,
          schelling_point: coin.schellingPoint,
          entry_exit_type: coin.entryExitType || 'neutral',
          entry_exit_day: coin.entryExitDay || 0,
          near_threshold: !!coin.nearThreshold,
          momentum_indicators: JSON.stringify(parseMomentumIndicators(coin.momentumIndicators))
        });
      });
    }
    
    // 处理流动性数据
    let allLiquidityHistory = [];
    if (inputData.liquidity) {
      allLiquidityHistory.push({
        date: dateValue,
        btc_fund_change: inputData.liquidity.btcFundChange || 0,
        eth_fund_change: inputData.liquidity.ethFundChange || 0,
        sol_fund_change: inputData.liquidity.solFundChange || 0,
        total_market_fund_change: inputData.liquidity.totalMarketFundChange || 0,
        comments: inputData.liquidity.comments || ''
      });
    }
    
    // 处理热门币种
    let allTrendingCoinsHistory = [];
    if (Array.isArray(inputData.trendingCoins)) {
      inputData.trendingCoins.forEach(coin => {
        allTrendingCoinsHistory.push({
          date: dateValue,
          symbol: coin.symbol.toUpperCase(),
          otc_index: coin.otcIndex,
          explosion_index: coin.explosionIndex,
          schelling_point: coin.schellingPoint,
          entry_exit_type: coin.entryExitType || 'neutral',
          entry_exit_day: coin.entryExitDay || 0
        });
      });
    }
    
    // 构建完整的导入格式
    return {
      metadata: {
        exportDate: now,
        appVersion: process.env.REACT_APP_VERSION || '1.0.0',
        importType: 'simple_json',
        overwriteExisting: true // 默认覆盖重复数据
      },
      allCoinsInfo: allCoinsInfo,
      allHistoricalMetricsRaw: allHistoricalMetricsRaw,
      allLiquidityHistory: allLiquidityHistory,
      allTrendingCoinsHistory: allTrendingCoinsHistory
    };
  }
// --- 结束数据提交和获取 API 调用 ---


// --- 7. 收藏功能 API 调用 ---
// 获取用户收藏的币种 - 只使用用户ID
export const fetchFavorites = async (forceRefresh = false) => {
  const now = Date.now();

  // 使用缓存，除非强制刷新或缓存过期（5分钟）
  if (!forceRefresh && dataCache.favorites && (now - dataCache.lastFavoritesFetchTime < 5 * 60 * 1000)) {
    return dataCache.favorites;
  }

  try {
    console.log('[fetchFavorites] 开始获取用户收藏列表');

    // 调用收藏API（需要用户登录）
    const response = await callApiWithRetry(() => api.get('/favorites'));
    const serverFavorites = response.data;
    console.log('[fetchFavorites] 服务器返回数据:', serverFavorites);

    // 更新缓存
    if (Array.isArray(serverFavorites)) {
      localStorage.setItem('favoriteCrypto', JSON.stringify(serverFavorites));
      dataCache.favorites = serverFavorites;
      dataCache.lastFavoritesFetchTime = now;
      console.log('[fetchFavorites] 缓存已更新');
      return serverFavorites;
    } else {
      console.warn('[fetchFavorites] 服务器返回无效数据');
      return [];
    }
  } catch (error) {
    console.error('[fetchFavorites] 获取收藏数据失败:', error.displayMessage || error.message);

    // 如果是401错误（未登录），返回空数组
    if (error.response?.status === 401) {
      console.log('[fetchFavorites] 用户未登录，返回空收藏列表');
      return [];
    }

    // 其他错误，尝试使用本地缓存
    const cachedFavorites = JSON.parse(localStorage.getItem('favoriteCrypto') || '[]');
    console.log('[fetchFavorites] 使用本地缓存数据:', cachedFavorites);
    return cachedFavorites;
  }
};

// 添加收藏 - 只使用用户ID
export const addFavorite = async (symbol) => {
  if (!symbol) {
    throw new Error('Symbol is required');
  }

  try {
    console.log(`[addFavorite] 开始添加收藏: ${symbol}`);

    // 发送请求到服务器（需要用户登录）
    const response = await callApiWithRetry(() => api.post('/favorites', { symbol }));
    console.log(`[addFavorite] 服务器响应成功: ${symbol}`, response.data);

    // 服务器请求成功后，更新本地缓存
    const currentFavorites = dataCache.favorites || JSON.parse(localStorage.getItem('favoriteCrypto') || '[]');
    console.log(`[addFavorite] 当前缓存: ${currentFavorites}`);

    if (!currentFavorites.includes(symbol)) {
      const newFavorites = [...currentFavorites, symbol];
      localStorage.setItem('favoriteCrypto', JSON.stringify(newFavorites));
      dataCache.favorites = newFavorites;
      console.log(`[addFavorite] 缓存已更新: ${newFavorites}`);
    } else {
      console.log(`[addFavorite] ${symbol} 已在缓存中，无需更新`);
    }

    return response.data;
  } catch (error) {
    console.error(`[addFavorite] 添加收藏失败: ${symbol}`, error.displayMessage || error.message);
    throw error;
  }
};

// 删除收藏 - 只使用用户ID
export const removeFavorite = async (symbol) => {
  if (!symbol) {
    throw new Error('Symbol is required');
  }

  try {
    console.log(`[removeFavorite] 开始删除收藏: ${symbol}`);

    // 发送请求到服务器（需要用户登录）
    const response = await callApiWithRetry(() => api.delete(`/favorites/${symbol}`));
    console.log(`[removeFavorite] 服务器响应成功: ${symbol}`, response.data);

    // 服务器请求成功后，更新本地缓存
    const currentFavorites = dataCache.favorites || JSON.parse(localStorage.getItem('favoriteCrypto') || '[]');
    console.log(`[removeFavorite] 当前缓存: ${currentFavorites}`);

    const newFavorites = currentFavorites.filter(s => s !== symbol);
    localStorage.setItem('favoriteCrypto', JSON.stringify(newFavorites));
    dataCache.favorites = newFavorites;
    console.log(`[removeFavorite] 缓存已更新: ${newFavorites}`);

    return response.data;
  } catch (error) {
    console.error(`[removeFavorite] 删除收藏失败: ${symbol}`, error.displayMessage || error.message);
    throw error;
  }
};

// 切换收藏状态
export const toggleFavorite = async (symbol) => {
  if (!symbol) {
    throw new Error('Symbol is required');
  }

  // 使用缓存的收藏列表状态，避免重新获取导致的竞态条件
  const favorites = dataCache.favorites || JSON.parse(localStorage.getItem('favoriteCrypto') || '[]');
  const isFavorite = favorites.includes(symbol);

  // 根据当前状态添加或删除收藏
  if (isFavorite) {
    return removeFavorite(symbol);
  } else {
    return addFavorite(symbol);
  }
};
// --- 结束收藏功能 API 调用 ---


// --- 8. 其他辅助 API 调用 ---
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


// --- 9. 备用数据函数 ---
function getFallbackCoins() { return []; }
function getDefaultLiquidity() { return { btc_fund_change: 0, eth_fund_change: 0, sol_fund_change: 0, total_market_fund_change: 0, comments: "暂无流动性数据" }; }

function getFallbackMetricsData() {
  return {
    date: new Date().toISOString().split('T')[0],
    coins: getFallbackCoins(),
    liquidity: getDefaultLiquidity(),
    optionTuning: null,
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

// --- 8. 用户管理 API 调用 ---
// 获取所有用户列表
export const getAllUsers = async () => {
  try {
    const response = await callApiWithRetry(() => api.get('/admin/users'));
    return response.data;
  } catch (error) {
    console.error('[getAllUsers] 获取用户列表失败:', error.displayMessage || error.message);
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
