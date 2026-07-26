const assert = require('assert');

const {
  clearBinanceUsdmSymbolCache,
  fetchBinanceUsdmBaseAssets,
  isPlainEquityTicker,
  preferBinanceUsdmForEquityMappings,
  resolveBinanceCandidate,
} = require('../utils/binanceUsdmEquityPreference');

function createFetchStub(symbols, { status = 200 } = {}) {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: status === 200,
      status,
      async json() {
        return {
          symbols: symbols.map(entry => ({
            contractType: 'PERPETUAL',
            quoteAsset: 'USDT',
            status: 'TRADING',
            ...entry,
          })),
        };
      },
    };
  };
  return { fetchImpl, getCalls: () => calls };
}

function createMapping(initial) {
  const mapping = {
    ...initial,
    updates: [],
    get() {
      const { updates, get, update, ...plain } = mapping;
      return plain;
    },
    async update(values) {
      mapping.updates.push(values);
      Object.assign(mapping, values);
    },
  };
  return mapping;
}

async function run() {
  // 纯美股代码判定：特殊符号一律排除
  assert.strictEqual(isPlainEquityTicker('TSLA'), true);
  assert.strictEqual(isPlainEquityTicker('GC=F'), false);
  assert.strictEqual(isPlainEquityTicker('^IXIC'), false);
  assert.strictEqual(isPlainEquityTicker('159819.SZ'), false);
  assert.strictEqual(isPlainEquityTicker('LH0'), false);
  assert.strictEqual(isPlainEquityTicker(''), false);

  // 候选解析：coin_symbol 优先，回退 trading_symbol（CIRCLE→CRCL 场景）
  const assets = new Set(['TSLA', 'CRCL']);
  assert.strictEqual(
    resolveBinanceCandidate({ coin_symbol: 'TSLA', trading_symbol: 'TSLA' }, assets),
    'TSLA'
  );
  assert.strictEqual(
    resolveBinanceCandidate({ coin_symbol: 'CIRCLE', trading_symbol: 'CRCL' }, assets),
    'CRCL'
  );
  assert.strictEqual(
    resolveBinanceCandidate({ coin_symbol: 'HOOD', trading_symbol: 'HOOD' }, assets),
    null
  );

  // exchangeInfo 解析与 24 小时缓存
  clearBinanceUsdmSymbolCache();
  {
    const { fetchImpl, getCalls } = createFetchStub([
      { baseAsset: 'TSLA', contractType: 'TRADIFI_PERPETUAL' }, // 代币化股票，必须收录
      { baseAsset: 'BTC' },
      { baseAsset: 'DOGE', status: 'SETTLING' },          // 非 TRADING 状态，剔除
      // 模拟 ETHUSDT_260925 这类当季交割合约：有到期日、带基差，须剔除。
      // 真实 exchangeInfo 中 ETH 的永续(ETHUSDT)与交割合约并存，永续正常收录
      { baseAsset: 'ETH', contractType: 'CURRENT_QUARTER' },
      { baseAsset: 'XRP', quoteAsset: 'USDC' },           // 非 USDT，剔除
    ]);
    const set = await fetchBinanceUsdmBaseAssets({ fetchImpl, now: 1000 });
    assert.deepStrictEqual([...set].sort(), ['BTC', 'TSLA']);
    await fetchBinanceUsdmBaseAssets({ fetchImpl, now: 2000 });
    assert.strictEqual(getCalls(), 1, '缓存期内不应重复请求');
    await fetchBinanceUsdmBaseAssets({ fetchImpl, now: 1000 + 25 * 60 * 60 * 1000 });
    assert.strictEqual(getCalls(), 2, '缓存过期后应重新请求');
  }

  // 接口失败与空返回都应抛错而不是清空映射
  clearBinanceUsdmSymbolCache();
  await assert.rejects(
    () => fetchBinanceUsdmBaseAssets({ fetchImpl: createFetchStub([], { status: 502 }).fetchImpl }),
    /HTTP 502/
  );
  await assert.rejects(
    () => fetchBinanceUsdmBaseAssets({ fetchImpl: createFetchStub([]).fetchImpl }),
    /no tradable/
  );

  // 端到端翻转
  clearBinanceUsdmSymbolCache();
  {
    const mappings = [
      createMapping({ coin_symbol: 'TSLA', trading_symbol: 'TSLA', market: 'yahoo_finance', enabled: 1, notes: '' }),
      createMapping({ coin_symbol: 'CIRCLE', trading_symbol: 'CRCL', market: 'yahoo_finance', enabled: 1, notes: '手工映射' }),
      createMapping({ coin_symbol: 'HOOD', trading_symbol: 'HOOD', market: 'yahoo_finance', enabled: 1, notes: '' }),
      createMapping({ coin_symbol: 'GOLD', trading_symbol: 'GC=F', market: 'yahoo_finance', enabled: 1, notes: '' }),
      createMapping({ coin_symbol: 'NASDAQ', trading_symbol: '^IXIC', market: 'yahoo_finance', enabled: 1, notes: '' }),
    ];
    const model = {
      async findAll({ where }) {
        assert.strictEqual(where.market, 'yahoo_finance');
        assert.strictEqual(where.enabled, true);
        return mappings;
      },
    };
    const { fetchImpl } = createFetchStub([
      { baseAsset: 'TSLA' },
      { baseAsset: 'CRCL' },
      { baseAsset: 'GOLD' }, // 即使币安有同名 GOLD 代币，GC=F 也不允许被翻转
    ]);

    const result = await preferBinanceUsdmForEquityMappings({
      CoinKlineMappingModel: model,
      fetchImpl,
      now: new Date('2026-07-27T00:00:00Z'),
    });

    assert.deepStrictEqual(result.updated.map(item => item.coinSymbol).sort(), ['CIRCLE', 'TSLA']);
    assert.deepStrictEqual(result.unavailable.map(item => item.coinSymbol), ['HOOD']);
    assert.deepStrictEqual(
      result.skippedSpecial.map(item => item.coinSymbol).sort(),
      ['GOLD', 'NASDAQ']
    );

    const tsla = mappings[0];
    assert.strictEqual(tsla.market, 'binance_usdm_perpetual');
    assert.strictEqual(tsla.trading_symbol, 'TSLAUSDT');
    assert.ok(tsla.notes.includes('原 yahoo:TSLA'));

    const circle = mappings[1];
    assert.strictEqual(circle.trading_symbol, 'CRCLUSDT');
    assert.ok(circle.notes.startsWith('手工映射；'), '原备注应保留');

    // 未翻转的映射不得有任何写入
    assert.strictEqual(mappings[2].updates.length, 0);
    assert.strictEqual(mappings[3].updates.length, 0);
    assert.strictEqual(mappings[4].updates.length, 0);
  }

  clearBinanceUsdmSymbolCache();
  console.log('binanceUsdmEquityPreference.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
