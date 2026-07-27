const assert = require('assert');
const { EventEmitter } = require('events');

const {
  attachKlineWebSocketServer,
  authenticateKlineWebSocketRequest,
  readAuthorizationFromWebSocketRequest,
} = require('../services/klineWebSocketServer');
const { signAuthToken } = require('../utils/authSecurity');
const {
  buildBinanceKlineStreamName,
  buildBinanceKlineStreamUrl,
  buildCoinKlineUpsertPayload,
  parseBinanceKlineStreamMessage,
} = require('../utils/binanceKlineStream');

class FakeClientSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1;
    this.sentMessages = [];
    this.closeCalls = [];
  }

  send(message) {
    this.sentMessages.push(message);
  }

  close(code, reason) {
    this.closeCalls.push({ code, reason });
  }
}

class FakeUpstreamSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    this.terminated = false;
  }

  close() {
    throw new Error('WebSocket was closed before the connection was established');
  }

  terminate() {
    this.terminated = true;
    this.readyState = 3;
    this.emit('error', new Error('WebSocket was closed before the connection was established'));
  }
}

class FakeWebSocketServer extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
  }
}

async function run() {
  assert.strictEqual(
    buildBinanceKlineStreamName({ symbol: 'BTC', interval: '4h' }),
    'btcusdt@kline_4h',
  );
  assert.strictEqual(
    buildBinanceKlineStreamUrl({ symbol: 'BTC', interval: '4h' }),
    'wss://fstream.binance.com/market/ws/btcusdt@kline_4h',
  );

  const parsed = parseBinanceKlineStreamMessage({
    e: 'kline',
    E: 1771420800123,
    s: 'BTCUSDT',
    k: {
      t: 1771420800000,
      T: 1771435199999,
      s: 'BTCUSDT',
      i: '4h',
      o: '81000.10',
      c: '81234.50',
      h: '82000.00',
      l: '80500.25',
      v: '1234.56',
      n: 9876,
      x: true,
      q: '100000000.12',
    },
  });

  assert.deepStrictEqual(parsed, {
    type: 'kline',
    eventTime: '2026-02-18T13:20:00.123Z',
    coinSymbol: 'BTC',
    tradingSymbol: 'BTCUSDT',
    interval: '4h',
    isClosed: true,
    kline: {
      openTime: '2026-02-18T13:20:00.000Z',
      closeTime: '2026-02-18T17:19:59.999Z',
      market: 'binance_usdm_perpetual',
      tradingSymbol: 'BTCUSDT',
      open: 81000.1,
      high: 82000,
      low: 80500.25,
      close: 81234.5,
      volume: 1234.56,
      quoteVolume: 100000000.12,
      tradeCount: 9876,
    },
  });

  assert.deepStrictEqual(buildCoinKlineUpsertPayload(parsed, { id: 7, symbol: 'BTC' }), {
    coin_id: 7,
    coin_symbol: 'BTC',
    trading_symbol: 'BTCUSDT',
    market: 'binance_usdm_perpetual',
    interval: '4h',
    open_time: new Date('2026-02-18T13:20:00.000Z'),
    close_time: new Date('2026-02-18T17:19:59.999Z'),
    open_price: 81000.1,
    high_price: 82000,
    low_price: 80500.25,
    close_price: 81234.5,
    volume: 1234.56,
    quote_volume: 100000000.12,
    trade_count: 9876,
  });

  const authUser = {
    id: 12,
    username: 'kline-viewer',
    password: 'stored-password-hash',
    role: 'user',
    status: 'active',
  };
  const authToken = signAuthToken(authUser);
  const authRequest = {
    url: '/ws/klines?symbol=BTC&interval=4h',
    headers: { 'sec-websocket-protocol': `bearer, ${authToken}` },
  };
  assert.strictEqual(
    readAuthorizationFromWebSocketRequest(authRequest),
    `Bearer ${authToken}`,
    'WebSocket 子协议应转换成 Bearer 凭据'
  );
  const authResult = await authenticateKlineWebSocketRequest({
    request: authRequest,
    db: {
      User: {
        findByPk: async id => (Number(id) === authUser.id ? authUser : null),
      },
    },
  });
  assert.strictEqual(authResult.ok, true, '有效登录会话应允许订阅 K 线流');
  assert.strictEqual(authResult.user.id, authUser.id);

  let anonymousUpstreamCount = 0;
  const anonymousWss = attachKlineWebSocketServer({
    server: {},
    db: {
      Coin: { findOne: async () => ({ id: 1, symbol: 'BTC' }) },
      CoinKline: { upsert: async () => {} },
    },
    WebSocketCtor: class extends FakeUpstreamSocket {
      constructor(url) {
        super(url);
        anonymousUpstreamCount += 1;
      }
    },
    WebSocketServerCtor: FakeWebSocketServer,
    authenticateRequest: async () => ({ ok: false, statusCode: 401, message: 'Authentication required' }),
    logger: { warn: () => {} },
  });
  const anonymousClient = new FakeClientSocket();
  anonymousWss.emit('connection', anonymousClient, { url: '/ws/klines?symbol=BTC&interval=4h' });
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(anonymousUpstreamCount, 0, '匿名连接不得创建上游行情连接');
  assert.deepStrictEqual(anonymousClient.closeCalls[0], {
    code: 1008,
    reason: 'Authentication required',
  });

  let upstreamSocket;
  const db = {
    Coin: {
      findOne: async () => ({ id: 79, symbol: 'AXTI' }),
    },
    CoinKline: {
      upsert: async () => {},
    },
  };
  const wss = attachKlineWebSocketServer({
    server: {},
    db,
    WebSocketCtor: class extends FakeUpstreamSocket {
      constructor(url) {
        super(url);
        upstreamSocket = this;
      }
    },
    WebSocketServerCtor: FakeWebSocketServer,
    authenticateRequest: async () => ({ ok: true, user: authUser }),
    logger: { warn: () => {} },
  });
  const client = new FakeClientSocket();
  wss.emit('connection', client, { url: '/ws/klines?symbol=AXTI&interval=4h' });
  await new Promise(resolve => setImmediate(resolve));

  assert.doesNotThrow(() => {
    client.emit('close');
  });
  assert.strictEqual(upstreamSocket.terminated, true);

  // 回归：浏览器在查库期间断开时，不能再建出一个永远没人回收的上游连接
  let resolveCoinLookup;
  const createdUpstreams = [];
  const slowDb = {
    Coin: {
      findOne: () => new Promise((resolve) => {
        resolveCoinLookup = () => resolve({ id: 79, symbol: 'AXTI' });
      }),
    },
    CoinKline: {
      upsert: async () => {},
    },
  };
  const slowWss = attachKlineWebSocketServer({
    server: {},
    db: slowDb,
    WebSocketCtor: class extends FakeUpstreamSocket {
      constructor(url) {
        super(url);
        createdUpstreams.push(this);
      }
    },
    WebSocketServerCtor: FakeWebSocketServer,
    authenticateRequest: async () => ({ ok: true, user: authUser }),
    logger: { warn: () => {} },
  });
  const earlyCloseClient = new FakeClientSocket();
  slowWss.emit('connection', earlyCloseClient, { url: '/ws/klines?symbol=AXTI&interval=4h' });
  await new Promise(resolve => setImmediate(resolve));

  earlyCloseClient.emit('close');
  resolveCoinLookup();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.strictEqual(createdUpstreams.length, 0, '客户端已断开后不应再创建上游连接');

  console.log('klineWebSocket.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
