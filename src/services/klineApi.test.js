import {
  buildKlineWebSocketUrl,
  fetchCoinKlines,
  subscribeCoinKlineStream,
} from './klineApi';
import {
  api,
  callApiWithRetry,
  dataCache,
} from './apiClient';

jest.mock('./apiClient', () => ({
  api: { get: jest.fn() },
  callApiWithRetry: jest.fn(apiCall => apiCall()),
  dataCache: { coinKlines: new Map() },
  effectiveApiBaseUrl: 'http://localhost:3001/api',
}));

beforeEach(() => {
  jest.clearAllMocks();
  callApiWithRetry.mockImplementation(apiCall => apiCall());
  dataCache.coinKlines.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('builds the authenticated kline WebSocket endpoint', () => {
  const url = new URL(buildKlineWebSocketUrl(
    'btc',
    '4h',
    'https://dashboard.example/api',
  ));

  expect(url.protocol).toBe('wss:');
  expect(url.pathname).toBe('/ws/klines');
  expect(url.searchParams.get('symbol')).toBe('BTC');
  expect(url.searchParams.get('interval')).toBe('4h');
  expect(url.searchParams.has('token')).toBe(false);
});

test('sends the current JWT through the WebSocket protocol handshake', () => {
  const sockets = [];
  class FakeSocket {
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      sockets.push(this);
    }

    close() {}
  }
  window.localStorage.setItem('token', 'header.payload.signature');

  const unsubscribe = subscribeCoinKlineStream('BTC', {
    interval: '4h',
    WebSocketCtor: FakeSocket,
  });

  expect(sockets[0].protocols).toEqual(['bearer', 'header.payload.signature']);
  expect(sockets[0].url).not.toContain('token=');
  unsubscribe();
  window.localStorage.removeItem('token');
});

test('surfaces kline request failures to the chart', async () => {
  const error = new Error('upstream unavailable');
  error.displayMessage = 'K 线服务暂不可用';
  api.get.mockRejectedValue(error);
  jest.spyOn(console, 'error').mockImplementation(() => {});

  await expect(fetchCoinKlines('BTC', { interval: '4h' }))
    .rejects.toThrow('K 线服务暂不可用');
});
