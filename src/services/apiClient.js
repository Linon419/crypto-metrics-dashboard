// src/services/apiClient.js
// API 基地址解析、axios 实例与拦截器、数据缓存、通用重试。
// 从 api.js 拆出，逻辑未改动。
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
    // 账号仍在使用初始密码：后端锁定业务接口，等待用户在强制弹窗中改密，不清 token 也不跳转
    if (
      error.response
      && error.response.status === 403
      && error.response.data?.code === 'PASSWORD_CHANGE_REQUIRED'
    ) {
      error.passwordChangeRequired = true;
      return Promise.reject(error);
    }

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
        const currentDelay = retryDelay;
        console.log(`Retrying in ${currentDelay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, currentDelay));
        retryDelay = Math.min(retryDelay * 1.5, 30000); // 增加延迟，但设置上限
      }
    }
  }
  console.error(`API Call failed after ${maxRetries} retries.`);
  throw lastError;
}
// --- 结束重试功能封装 ---


// --- 6. 数据提交和获取 API 调用 ---

export { api, dataCache, callApiWithRetry, effectiveApiBaseUrl };
export default api;
