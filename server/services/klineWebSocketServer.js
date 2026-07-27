const { WebSocket, WebSocketServer } = require('ws');
const {
  buildBinanceKlineStreamUrl,
  buildCoinKlineUpsertPayload,
  parseBinanceKlineStreamMessage,
} = require('../utils/binanceKlineStream');
const {
  KLINE_MARKETS,
  resolveEffectiveKlineMapping,
} = require('../utils/coinKlineMappings');
const { createAuthMiddleware, requirePasswordChange } = require('../middleware/auth');

const CLIENT_CONNECTING = 0;
const CLIENT_OPEN = 1;
const CLIENT_CLOSING = 2;
const DEFAULT_RECONNECT_DELAY_MS = 1500;
const DEFAULT_MAX_RECONNECT_DELAY_MS = 60 * 1000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 1000;

function sendJson(socket, payload) {
  if (!socket || socket.readyState !== CLIENT_OPEN) return;
  socket.send(JSON.stringify(payload));
}

function readSubscriptionFromRequest(requestUrl) {
  const url = new URL(requestUrl || '/', 'http://localhost');
  return {
    symbol: String(url.searchParams.get('symbol') || 'BTC').trim().toUpperCase(),
    interval: String(url.searchParams.get('interval') || '1d').trim(),
  };
}

function readAuthorizationFromWebSocketRequest(request) {
  const authorization = String(request?.headers?.authorization || '').trim();
  if (authorization) return authorization;

  const protocols = String(request?.headers?.['sec-websocket-protocol'] || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const bearerIndex = protocols.findIndex(value => value.toLowerCase() === 'bearer');
  const token = bearerIndex >= 0 ? protocols[bearerIndex + 1] : '';
  return token ? `Bearer ${token}` : '';
}

async function authenticateKlineWebSocketRequest({ request, db } = {}) {
  if (!db?.User) {
    return { ok: false, statusCode: 503, message: 'Authentication service unavailable' };
  }

  const req = {
    headers: { authorization: readAuthorizationFromWebSocketRequest(request) },
    socket: request?.socket,
  };
  const verifyToken = createAuthMiddleware({ UserModel: db.User });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const makeResponse = (fallbackStatus) => ({
      statusCode: fallbackStatus,
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      json(payload = {}) {
        finish({
          ok: false,
          statusCode: this.statusCode,
          message: payload.error || 'Authentication required',
          code: payload.code,
        });
        return payload;
      },
    });

    Promise.resolve(verifyToken(req, makeResponse(401), () => {
      try {
        requirePasswordChange(req, makeResponse(403), () => {
          finish({ ok: true, user: req.user });
        });
      } catch (error) {
        finish({ ok: false, statusCode: 500, message: 'Authentication service unavailable' });
      }
    })).catch(() => {
      finish({ ok: false, statusCode: 500, message: 'Authentication service unavailable' });
    });
  });
}

function detachUpstreamListeners(socket) {
  if (!socket?.removeAllListeners) return;
  socket.removeAllListeners('open');
  socket.removeAllListeners('message');
  socket.removeAllListeners('close');
  socket.removeAllListeners('error');
}

function closeWebSocket(socket) {
  if (!socket) return;
  const readyState = socket.readyState;
  detachUpstreamListeners(socket);

  if (readyState === CLIENT_CONNECTING) {
    socket.once?.('error', () => {});
    socket.terminate?.();
    return;
  }

  if (readyState === CLIENT_OPEN || readyState === CLIENT_CLOSING) {
    socket.close?.();
  }
}

async function findCoin(db, symbol) {
  return db.Coin.findOne({
    where: { symbol: String(symbol || '').trim().toUpperCase() },
  });
}

async function findKlineMapping(db, coin) {
  if (!db?.CoinKlineMapping?.findOne || !coin?.id) return null;
  const rawMapping = await db.CoinKlineMapping.findOne({
    where: { coin_id: coin.id },
    raw: true,
  });
  return resolveEffectiveKlineMapping(coin, rawMapping);
}

function attachKlineWebSocketServer({
  server,
  db,
  path = '/ws/klines',
  WebSocketCtor = WebSocket,
  WebSocketServerCtor = WebSocketServer,
  reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS,
  maxReconnectDelayMs = DEFAULT_MAX_RECONNECT_DELAY_MS,
  maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS,
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
  authenticateRequest = authenticateKlineWebSocketRequest,
  logger = console,
} = {}) {
  if (!server) {
    throw new Error('HTTP server is required for kline WebSocket');
  }
  if (!db?.Coin || !db?.CoinKline) {
    throw new Error('Coin and CoinKline models are required for kline WebSocket');
  }

  const wss = new WebSocketServerCtor({ server, path });
  const connections = new Set();

  // 浏览器休眠/切网会留下半开连接，不做心跳探活上游会一直挂着
  const heartbeatTimer = setInterval(() => {
    connections.forEach((connection) => {
      if (!connection.state.alive) {
        connection.teardown();
        if (typeof connection.client.terminate === 'function') {
          connection.client.terminate();
        } else {
          connection.client.close?.(1001, 'Heartbeat timeout');
        }
        return;
      }

      connection.state.alive = false;
      connection.client.ping?.();
    });
  }, heartbeatIntervalMs);
  heartbeatTimer.unref?.();

  wss.on('close', () => {
    clearInterval(heartbeatTimer);
    Array.from(connections).forEach(connection => connection.teardown());
  });

  wss.on('connection', async (client, request) => {
    let authentication;
    try {
      authentication = await authenticateRequest({ request, db });
    } catch (error) {
      logger.warn?.('[kline-ws] Authentication failed:', error.message);
      authentication = { ok: false, message: 'Authentication service unavailable' };
    }
    if (!authentication?.ok) {
      sendJson(client, {
        type: 'error',
        code: 'AUTHENTICATION_REQUIRED',
        message: authentication?.message || 'Authentication required',
      });
      client.close?.(1008, 'Authentication required');
      return;
    }
    if (client.readyState !== CLIENT_OPEN) return;

    const { symbol, interval } = readSubscriptionFromRequest(request.url);
    const state = {
      closed: false,
      alive: true,
      upstream: null,
      reconnectTimer: null,
      reconnectAttempts: 0,
      coin: null,
      klineMapping: null,
    };

    const closeUpstream = () => {
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
      }
      if (state.upstream) {
        closeWebSocket(state.upstream);
        state.upstream = null;
      }
    };

    const teardown = () => {
      state.closed = true;
      connections.delete(connection);
      closeUpstream();
    };

    const connection = { state, client, teardown };
    connections.add(connection);

    const scheduleReconnect = () => {
      if (state.closed || state.reconnectTimer) return;
      if (state.reconnectAttempts >= maxReconnectAttempts) {
        sendJson(client, {
          type: 'error',
          message: `Binance upstream reconnect gave up after ${maxReconnectAttempts} attempts`,
        });
        logger.warn?.('[kline-ws] Upstream reconnect attempts exhausted:', symbol, interval);
        client.close?.(1011, 'Upstream unavailable');
        return;
      }

      // 指数退避 + 抖动，避免单个标签页每分钟几十次外连打爆 Binance 的连接数限制
      const backoffMs = Math.min(
        reconnectDelayMs * (2 ** state.reconnectAttempts),
        maxReconnectDelayMs
      );
      const delayMs = Math.round(backoffMs * (0.5 + Math.random() * 0.5));
      state.reconnectAttempts += 1;
      state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = null;
        connectUpstream();
      }, delayMs);
      state.reconnectTimer.unref?.();
    };

    const connectUpstream = async () => {
      try {
        if (state.closed) return;

        if (!state.coin) {
          state.coin = await findCoin(db, symbol);
          if (state.closed) return;
        }
        if (!state.coin) {
          sendJson(client, { type: 'error', message: `Coin ${symbol} not found` });
          client.close?.(1008, 'Coin not found');
          return;
        }

        if (!state.klineMapping) {
          state.klineMapping = await findKlineMapping(db, state.coin);
          if (state.closed) return;
        }

        if (state.klineMapping && state.klineMapping.market !== KLINE_MARKETS.BINANCE_USDM_PERPETUAL) {
          sendJson(client, {
            type: 'status',
            status: 'polling-source',
            symbol,
            interval,
            market: state.klineMapping.market,
            message: `${state.klineMapping.market} uses REST refresh instead of Binance WebSocket`,
          });
          return;
        }

        const streamSymbol = state.klineMapping?.trading_symbol || symbol;
        const streamUrl = buildBinanceKlineStreamUrl({ symbol: streamSymbol, interval });
        const upstream = new WebSocketCtor(streamUrl);
        state.upstream = upstream;
        // 查库期间浏览器可能已经断开，这里兜底回收，避免上游连接永久泄漏
        if (state.closed) {
          closeUpstream();
          return;
        }

        upstream.on('open', () => {
          state.reconnectAttempts = 0;
          sendJson(client, {
            type: 'status',
            status: 'connected',
            symbol,
            interval,
            upstream: streamUrl,
          });
        });

        upstream.on('message', async (data) => {
          try {
            const liveMessage = parseBinanceKlineStreamMessage(data);
            sendJson(client, liveMessage);

            if (liveMessage.isClosed) {
              await db.CoinKline.upsert(buildCoinKlineUpsertPayload(liveMessage, state.coin));
            }
          } catch (error) {
            sendJson(client, { type: 'error', message: error.message });
            logger.warn?.('[kline-ws] Failed to process Binance kline message:', error.message);
          }
        });

        upstream.on('close', () => {
          if (state.closed) return;
          sendJson(client, { type: 'status', status: 'reconnecting', symbol, interval });
          scheduleReconnect();
        });

        upstream.on('error', (error) => {
          sendJson(client, { type: 'error', message: error.message });
          logger.warn?.('[kline-ws] Binance upstream error:', error.message);
        });
      } catch (error) {
        sendJson(client, { type: 'error', message: error.message });
        logger.warn?.('[kline-ws] Failed to connect upstream:', error.message);
        scheduleReconnect();
      }
    };

    client.on('pong', () => {
      state.alive = true;
    });

    client.on('close', () => {
      teardown();
    });

    client.on('error', (error) => {
      logger.warn?.('[kline-ws] Client error:', error.message);
    });

    connectUpstream();
  });

  return wss;
}

module.exports = {
  attachKlineWebSocketServer,
  authenticateKlineWebSocketRequest,
  closeWebSocket,
  readAuthorizationFromWebSocketRequest,
  readSubscriptionFromRequest,
  sendJson,
};
