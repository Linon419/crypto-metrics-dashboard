const { WebSocket, WebSocketServer } = require('ws');
const {
  buildBinanceKlineStreamUrl,
  buildCoinKlineUpsertPayload,
  parseBinanceKlineStreamMessage,
} = require('../utils/binanceKlineStream');

const CLIENT_OPEN = 1;
const DEFAULT_RECONNECT_DELAY_MS = 1500;

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

async function findCoin(db, symbol) {
  return db.Coin.findOne({
    where: { symbol: String(symbol || '').trim().toUpperCase() },
  });
}

function attachKlineWebSocketServer({
  server,
  db,
  path = '/ws/klines',
  WebSocketCtor = WebSocket,
  WebSocketServerCtor = WebSocketServer,
  reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS,
  logger = console,
} = {}) {
  if (!server) {
    throw new Error('HTTP server is required for kline WebSocket');
  }
  if (!db?.Coin || !db?.CoinKline) {
    throw new Error('Coin and CoinKline models are required for kline WebSocket');
  }

  const wss = new WebSocketServerCtor({ server, path });

  wss.on('connection', (client, request) => {
    const { symbol, interval } = readSubscriptionFromRequest(request.url);
    const state = {
      closed: false,
      upstream: null,
      reconnectTimer: null,
      coin: null,
    };

    const closeUpstream = () => {
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
      }
      if (state.upstream) {
        state.upstream.removeAllListeners?.();
        state.upstream.close?.();
        state.upstream = null;
      }
    };

    const scheduleReconnect = () => {
      if (state.closed || state.reconnectTimer) return;
      state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = null;
        connectUpstream();
      }, reconnectDelayMs);
    };

    const connectUpstream = async () => {
      try {
        if (!state.coin) {
          state.coin = await findCoin(db, symbol);
        }
        if (!state.coin) {
          sendJson(client, { type: 'error', message: `Coin ${symbol} not found` });
          client.close?.(1008, 'Coin not found');
          return;
        }

        const streamUrl = buildBinanceKlineStreamUrl({ symbol, interval });
        const upstream = new WebSocketCtor(streamUrl);
        state.upstream = upstream;

        upstream.on('open', () => {
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

    client.on('close', () => {
      state.closed = true;
      closeUpstream();
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
  readSubscriptionFromRequest,
  sendJson,
};
