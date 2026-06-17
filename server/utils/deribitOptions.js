const DERIBIT_PUBLIC_API_BASE_URL = 'https://www.deribit.com/api/v2';
const USER_AGENT = 'crypto-metrics-dashboard/0.1';
const INSTRUMENTS_CACHE_TTL_MS = 10 * 60 * 1000;
const BOOK_SUMMARY_CACHE_TTL_MS = 30 * 1000;
const TICKER_CACHE_TTL_MS = 10 * 1000;

const caches = {
  instruments: { expiresAt: 0, data: null },
  bookSummary: { expiresAt: 0, data: null },
  chain: { expiresAt: 0, data: null },
  tickers: new Map(),
};

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toNumber(value, fieldName) {
  const number = toNumberOrNull(value);
  if (number === null) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
  return number;
}

function buildDeribitPublicUrl(method, params = {}) {
  const normalizedMethod = String(method || '').replace(/^\/+/, '');
  const url = new URL(`${DERIBIT_PUBLIC_API_BASE_URL}/${normalizedMethod}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

async function fetchDeribitJson(method, params, fetchImpl = global.fetch) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable in this Node runtime');
  }

  const url = buildDeribitPublicUrl(method, params);
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json',
      'user-agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Deribit request failed: ${response.status} ${body}`.trim());
  }

  const payload = await response.json();
  if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'result')) {
    throw new Error(`Deribit response missing result for ${method}`);
  }
  return payload.result;
}

function formatExpirationDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function normalizeInstrument(row) {
  const expirationTimestamp = toNumber(row.expiration_timestamp, 'expiration_timestamp');
  return {
    instrumentName: String(row.instrument_name || ''),
    expirationTimestamp,
    expirationDate: formatExpirationDate(expirationTimestamp),
    strike: toNumber(row.strike, 'strike'),
    optionType: row.option_type,
    state: row.state || 'unknown',
    isActive: row.is_active !== false,
    minTradeAmount: toNumberOrNull(row.min_trade_amount),
    tickSize: toNumberOrNull(row.tick_size),
    raw: row,
  };
}

function normalizeBookSummary(row) {
  return {
    instrumentName: String(row.instrument_name || ''),
    bidPrice: toNumberOrNull(row.bid_price),
    askPrice: toNumberOrNull(row.ask_price),
    midPrice: toNumberOrNull(row.mid_price),
    markPrice: toNumberOrNull(row.mark_price),
    markIv: toNumberOrNull(row.mark_iv),
    openInterest: toNumberOrNull(row.open_interest),
    underlyingPrice: toNumberOrNull(row.underlying_price),
    underlyingIndex: row.underlying_index || null,
    interestRate: toNumberOrNull(row.interest_rate),
    volumeUsd: toNumberOrNull(row.volume_usd),
    volume: toNumberOrNull(row.volume),
    raw: row,
  };
}

function normalizeTicker(row, now = Date.now()) {
  const greeks = row.greeks || {};
  return {
    instrumentName: String(row.instrument_name || ''),
    bidPrice: toNumberOrNull(row.bid_price),
    askPrice: toNumberOrNull(row.ask_price),
    bestBidPrice: toNumberOrNull(row.best_bid_price),
    bestAskPrice: toNumberOrNull(row.best_ask_price),
    markPrice: toNumberOrNull(row.mark_price),
    markIv: toNumberOrNull(row.mark_iv),
    bidIv: toNumberOrNull(row.bid_iv),
    askIv: toNumberOrNull(row.ask_iv),
    underlyingPrice: toNumberOrNull(row.underlying_price),
    interestRate: toNumberOrNull(row.interest_rate),
    timestamp: row.timestamp ? new Date(toNumber(row.timestamp, 'timestamp')).toISOString() : new Date(now).toISOString(),
    greeks: {
      delta: toNumberOrNull(greeks.delta),
      gamma: toNumberOrNull(greeks.gamma),
      theta: toNumberOrNull(greeks.theta),
      vega: toNumberOrNull(greeks.vega),
      rho: toNumberOrNull(greeks.rho),
    },
    state: row.state || null,
    raw: row,
  };
}

function isOpenOption(option) {
  return Boolean(
    option.instrumentName &&
    option.state === 'open' &&
    option.isActive &&
    (option.optionType === 'call' || option.optionType === 'put')
  );
}

function mergeOptionChain({ instruments, summaries, now = Date.now(), cached = false, isStale = false, warnings = [] }) {
  const summaryByName = new Map(summaries.map(summary => [summary.instrumentName, summary]));
  const options = instruments
    .filter(isOpenOption)
    .map(instrument => ({
      ...instrument,
      ...(summaryByName.get(instrument.instrumentName) || {}),
      instrumentName: instrument.instrumentName,
      expirationTimestamp: instrument.expirationTimestamp,
      expirationDate: instrument.expirationDate,
      strike: instrument.strike,
      optionType: instrument.optionType,
      state: instrument.state,
      isActive: instrument.isActive,
      minTradeAmount: instrument.minTradeAmount,
      tickSize: instrument.tickSize,
    }))
    .filter(option => option.markPrice !== null || option.bidPrice !== null || option.askPrice !== null)
    .sort((left, right) => (
      left.expirationTimestamp - right.expirationTimestamp ||
      left.strike - right.strike ||
      left.optionType.localeCompare(right.optionType)
    ));

  const expirations = [...new Set(options.map(option => option.expirationDate))];
  const underlyingPrice = options.find(option => option.underlyingPrice !== null)?.underlyingPrice || null;

  return {
    currency: 'BTC',
    source: 'Deribit public API',
    cached,
    isStale,
    warnings,
    options,
    expirations,
    underlyingPrice,
    updatedAt: new Date(now).toISOString(),
    cacheAgeMs: 0,
  };
}

function resolveCache(cache, now) {
  if (cache.data && cache.expiresAt > now) {
    return cache.data;
  }
  return null;
}

async function fetchBtcOptionInstruments({ fetchImpl = global.fetch, forceRefresh = false, now = Date.now() } = {}) {
  const cached = forceRefresh ? null : resolveCache(caches.instruments, now);
  if (cached) return cached;

  const result = await fetchDeribitJson('public/get_instruments', {
    currency: 'BTC',
    kind: 'option',
    expired: false,
  }, fetchImpl);

  const data = result.map(normalizeInstrument);
  caches.instruments = {
    expiresAt: now + INSTRUMENTS_CACHE_TTL_MS,
    data,
  };
  return data;
}

async function fetchBtcOptionBookSummary({ fetchImpl = global.fetch, forceRefresh = false, now = Date.now() } = {}) {
  const cached = forceRefresh ? null : resolveCache(caches.bookSummary, now);
  if (cached) return cached;

  const result = await fetchDeribitJson('public/get_book_summary_by_currency', {
    currency: 'BTC',
    kind: 'option',
  }, fetchImpl);

  const data = result.map(normalizeBookSummary);
  caches.bookSummary = {
    expiresAt: now + BOOK_SUMMARY_CACHE_TTL_MS,
    data,
  };
  return data;
}

async function getBtcOptionChain({ fetchImpl = global.fetch, forceRefresh = false, now = Date.now() } = {}) {
  const cachedChain = forceRefresh ? null : resolveCache(caches.chain, now);
  if (cachedChain) {
    return {
      ...cachedChain,
      cached: true,
      cacheAgeMs: Math.max(0, now - Date.parse(cachedChain.updatedAt)),
    };
  }

  try {
    const [instruments, summaries] = await Promise.all([
      fetchBtcOptionInstruments({ fetchImpl, forceRefresh, now }),
      fetchBtcOptionBookSummary({ fetchImpl, forceRefresh, now }),
    ]);
    const data = mergeOptionChain({ instruments, summaries, now });
    caches.chain = {
      expiresAt: now + BOOK_SUMMARY_CACHE_TTL_MS,
      data,
    };
    return data;
  } catch (error) {
    if (caches.chain.data) {
      return {
        ...caches.chain.data,
        cached: true,
        isStale: true,
        cacheAgeMs: Math.max(0, now - Date.parse(caches.chain.data.updatedAt)),
        warnings: [`Using stale Deribit option chain: ${error.message}`],
      };
    }
    throw error;
  }
}

async function getBtcOptionTicker({ instrumentName, fetchImpl = global.fetch, forceRefresh = false, now = Date.now() } = {}) {
  if (!instrumentName) {
    throw new Error('instrumentName is required');
  }

  const cached = caches.tickers.get(instrumentName);
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return {
      ...cached.data,
      cached: true,
      cacheAgeMs: Math.max(0, now - Date.parse(cached.data.updatedAt)),
    };
  }

  const result = await fetchDeribitJson('public/ticker', {
    instrument_name: instrumentName,
  }, fetchImpl);

  const data = {
    ...normalizeTicker(result, now),
    cached: false,
    isStale: false,
    updatedAt: new Date(now).toISOString(),
    cacheAgeMs: 0,
  };

  caches.tickers.set(instrumentName, {
    expiresAt: now + TICKER_CACHE_TTL_MS,
    data,
  });
  return data;
}

module.exports = {
  DERIBIT_PUBLIC_API_BASE_URL,
  buildDeribitPublicUrl,
  fetchBtcOptionBookSummary,
  fetchBtcOptionInstruments,
  getBtcOptionChain,
  getBtcOptionTicker,
  mergeOptionChain,
  normalizeBookSummary,
  normalizeInstrument,
  normalizeTicker,
  __testUtils: {
    clearCaches() {
      caches.instruments = { expiresAt: 0, data: null };
      caches.bookSummary = { expiresAt: 0, data: null };
      caches.chain = { expiresAt: 0, data: null };
      caches.tickers.clear();
    },
  },
};
