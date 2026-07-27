// src/services/klineApi.js
// K 线查询、回补任务与 WebSocket 实时流。
// 从 api.js 拆出，逻辑未改动；api.js 统一再导出，组件导入路径不变。
import { api, dataCache, callApiWithRetry, effectiveApiBaseUrl } from './apiClient';

function readAccessToken() {
  try {
    return typeof window !== 'undefined' ? String(window.localStorage?.getItem('token') || '') : '';
  } catch (error) {
    return '';
  }
}

export function buildKlineWebSocketUrl(
  symbol,
  interval = '1d',
  apiBaseUrl = effectiveApiBaseUrl,
) {
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

  const token = readAccessToken();
  const socket = new SocketCtor(
    buildKlineWebSocketUrl(symbol, interval),
    token ? ['bearer', token] : undefined,
  );

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
    // 静默返回空数组会让图表画出一张没有任何说明的空白图，这里把失败抛给调用方展示错误态
    throw new Error(error.displayMessage || error.message || `获取 ${symbol} K线失败`);
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
