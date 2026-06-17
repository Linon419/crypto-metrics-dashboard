const assert = require('assert');

const {
  DERIBIT_PUBLIC_API_BASE_URL,
  buildDeribitPublicUrl,
  getBtcOptionChain,
  getBtcOptionTicker,
  normalizeBookSummary,
  normalizeInstrument,
  __testUtils,
} = require('../utils/deribitOptions');

function jsonResponse(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function buildInstrument(name, overrides = {}) {
  return {
    instrument_name: name,
    expiration_timestamp: Date.UTC(2026, 5, 26, 8),
    strike: 65000,
    option_type: name.endsWith('-P') ? 'put' : 'call',
    state: 'open',
    min_trade_amount: 0.1,
    tick_size: 0.0005,
    ...overrides,
  };
}

function buildSummary(name, overrides = {}) {
  return {
    instrument_name: name,
    bid_price: 0.01,
    ask_price: 0.012,
    mid_price: 0.011,
    mark_price: 0.0115,
    mark_iv: 62.5,
    open_interest: 12,
    underlying_price: 64000,
    interest_rate: 0,
    volume_usd: 20000,
    ...overrides,
  };
}

async function run() {
  __testUtils.clearCaches();

  const url = buildDeribitPublicUrl('public/get_instruments', {
    currency: 'BTC',
    kind: 'option',
    expired: false,
  });
  assert.strictEqual(url.startsWith(`${DERIBIT_PUBLIC_API_BASE_URL}/public/get_instruments?`), true);
  assert.strictEqual(url.includes('currency=BTC'), true);
  assert.strictEqual(url.includes('kind=option'), true);
  assert.strictEqual(url.includes('expired=false'), true);

  const instrument = normalizeInstrument(buildInstrument('BTC-26JUN26-65000-C'));
  assert.deepStrictEqual({
    instrumentName: instrument.instrumentName,
    expirationTimestamp: instrument.expirationTimestamp,
    strike: instrument.strike,
    optionType: instrument.optionType,
    state: instrument.state,
    minTradeAmount: instrument.minTradeAmount,
  }, {
    instrumentName: 'BTC-26JUN26-65000-C',
    expirationTimestamp: Date.UTC(2026, 5, 26, 8),
    strike: 65000,
    optionType: 'call',
    state: 'open',
    minTradeAmount: 0.1,
  });
  assert.strictEqual(instrument.expirationDate, '2026-06-26');

  const summary = normalizeBookSummary(buildSummary('BTC-26JUN26-65000-C'));
  assert.strictEqual(summary.instrumentName, 'BTC-26JUN26-65000-C');
  assert.strictEqual(summary.markPrice, 0.0115);
  assert.strictEqual(summary.markIv, 62.5);
  assert.strictEqual(summary.underlyingPrice, 64000);

  const calls = [];
  const fetchImpl = async requestUrl => {
    calls.push(String(requestUrl));
    if (String(requestUrl).includes('get_instruments')) {
      return jsonResponse({
        jsonrpc: '2.0',
        result: [
          buildInstrument('BTC-26JUN26-65000-C'),
          buildInstrument('BTC-26JUN26-63000-P', { strike: 63000, option_type: 'put' }),
          buildInstrument('BTC-26JUN26-70000-C', { strike: 70000, state: 'inactive' }),
        ],
      });
    }
    if (String(requestUrl).includes('get_book_summary_by_currency')) {
      return jsonResponse({
        jsonrpc: '2.0',
        result: [
          buildSummary('BTC-26JUN26-65000-C'),
          buildSummary('BTC-26JUN26-63000-P', { mark_price: 0.008, mark_iv: 65.2 }),
        ],
      });
    }
    throw new Error(`Unexpected URL ${requestUrl}`);
  };

  const chain = await getBtcOptionChain({
    fetchImpl,
    now: Date.UTC(2026, 5, 8, 12),
  });

  assert.strictEqual(chain.currency, 'BTC');
  assert.strictEqual(chain.options.length, 2);
  assert.strictEqual(chain.expirations.length, 1);
  assert.strictEqual(chain.underlyingPrice, 64000);
  assert.strictEqual(chain.isStale, false);
  assert.strictEqual(chain.options[0].instrumentName, 'BTC-26JUN26-63000-P');
  assert.strictEqual(calls.length, 2);

  const cached = await getBtcOptionChain({
    fetchImpl: async () => {
      throw new Error('cache should be used');
    },
    now: Date.UTC(2026, 5, 8, 12, 0, 10),
  });
  assert.strictEqual(cached.cached, true);
  assert.strictEqual(cached.options.length, 2);

  const stale = await getBtcOptionChain({
    fetchImpl: async () => jsonResponse({ error: 'temporary' }, false, 503),
    forceRefresh: true,
    now: Date.UTC(2026, 5, 8, 12, 1),
  });
  assert.strictEqual(stale.isStale, true);
  assert.strictEqual(stale.options.length, 2);
  assert.strictEqual(stale.warnings.length, 1);

  const ticker = await getBtcOptionTicker({
    instrumentName: 'BTC-26JUN26-65000-C',
    fetchImpl: async requestUrl => {
      assert.strictEqual(String(requestUrl).includes('instrument_name=BTC-26JUN26-65000-C'), true);
      return jsonResponse({
        jsonrpc: '2.0',
        result: {
          instrument_name: 'BTC-26JUN26-65000-C',
          mark_price: 0.0114,
          bid_price: 0.011,
          ask_price: 0.012,
          mark_iv: 63.1,
          bid_iv: 62.4,
          ask_iv: 64.2,
          underlying_price: 64100,
          interest_rate: 0.01,
          timestamp: Date.UTC(2026, 5, 8, 12),
          greeks: {
            delta: 0.48,
            gamma: 0.00012,
            theta: -112.4,
            vega: 25.3,
            rho: 2.1,
          },
        },
      });
    },
    now: Date.UTC(2026, 5, 8, 12),
  });

  assert.strictEqual(ticker.instrumentName, 'BTC-26JUN26-65000-C');
  assert.strictEqual(ticker.markPrice, 0.0114);
  assert.strictEqual(ticker.greeks.delta, 0.48);
  assert.strictEqual(ticker.markIv, 63.1);

  console.log('deribitOptions.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
