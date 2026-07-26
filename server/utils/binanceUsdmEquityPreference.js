/**
 * 美股映射的币安优先同步。
 *
 * 背景：币安 U 本位陆续上线代币化股票永续（如 SAMSUNGUSDT、GLWUSDT）。
 * 同一标的在币安有 ticker 时优先用币安：24 小时行情 + WebSocket 实时流，
 * 优于 Yahoo 的 15 分钟轮询。
 *
 * 安全边界：
 * - 仅处理 trading_symbol 为纯字母美股代码的 yahoo 映射；
 *   GC=F、^IXIC、159819.SZ、LH0 等特殊符号一律不动，
 *   避免把「黄金期货」翻成某个恰好同名的代币
 * - 只在币安 exchangeInfo 确认存在 TRADING 状态的 USDT 永续时才翻转
 * - 显式停用的映射不动
 */

const { CoinKlineMapping } = require('../models');

const BINANCE_USDM_EXCHANGE_INFO_URL = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
const SYMBOL_SET_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const EQUITY_TICKER_PATTERN = /^[A-Z]{1,6}$/;
const YAHOO_FINANCE_MARKET = 'yahoo_finance';
const BINANCE_USDM_MARKET = 'binance_usdm_perpetual';

let cachedBaseAssets = null;
let cachedAt = 0;

function clearBinanceUsdmSymbolCache() {
  cachedBaseAssets = null;
  cachedAt = 0;
}

/**
 * 拉取币安 U 本位全部可交易 USDT 永续的 baseAsset 集合，24 小时缓存。
 */
async function fetchBinanceUsdmBaseAssets({ fetchImpl = fetch, now = Date.now() } = {}) {
  if (cachedBaseAssets && now - cachedAt < SYMBOL_SET_CACHE_TTL_MS) {
    return cachedBaseAssets;
  }

  const response = await fetchImpl(BINANCE_USDM_EXCHANGE_INFO_URL, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Binance exchangeInfo request failed: HTTP ${response.status}`);
  }

  const payload = await response.json();
  // 代币化股票/大宗商品的合约类型是 TRADIFI_PERPETUAL（如 SAMSUNGUSDT、GLWUSDT），
  // 与普通加密永续的 PERPETUAL 并列，两类都收
  const PERPETUAL_CONTRACT_TYPES = new Set(['PERPETUAL', 'TRADIFI_PERPETUAL']);
  const baseAssets = new Set(
    (payload.symbols || [])
      .filter(entry => PERPETUAL_CONTRACT_TYPES.has(entry.contractType)
        && entry.quoteAsset === 'USDT'
        && entry.status === 'TRADING')
      .map(entry => String(entry.baseAsset || '').toUpperCase())
      .filter(Boolean)
  );

  if (baseAssets.size === 0) {
    throw new Error('Binance exchangeInfo returned no tradable USDT perpetuals');
  }

  cachedBaseAssets = baseAssets;
  cachedAt = now;
  return baseAssets;
}

function isPlainEquityTicker(value) {
  return EQUITY_TICKER_PATTERN.test(String(value || '').trim());
}

/**
 * 对单条映射求币安侧候选 baseAsset：优先 coin_symbol，其次 trading_symbol
 * （如 CIRCLE 映射到 CRCL，两个名字都要试）。
 */
function resolveBinanceCandidate(mapping, baseAssets) {
  const candidates = [mapping.coin_symbol, mapping.trading_symbol]
    .map(value => String(value || '').trim().toUpperCase())
    .filter(value => isPlainEquityTicker(value));
  return candidates.find(candidate => baseAssets.has(candidate)) || null;
}

/**
 * 把币安已有同名永续的美股 yahoo 映射翻转为 binance_usdm_perpetual。
 *
 * @returns {{updated: Array, unavailable: Array, skippedSpecial: Array}}
 */
async function preferBinanceUsdmForEquityMappings({
  CoinKlineMappingModel = CoinKlineMapping,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  const baseAssets = await fetchBinanceUsdmBaseAssets({ fetchImpl, now: now.getTime?.() ?? Date.now() });

  const yahooMappings = await CoinKlineMappingModel.findAll({
    where: { market: YAHOO_FINANCE_MARKET, enabled: true },
  });

  const updated = [];
  const unavailable = [];
  const skippedSpecial = [];

  for (const mapping of yahooMappings) {
    const plain = typeof mapping.get === 'function' ? mapping.get({ plain: true }) : mapping;

    if (!isPlainEquityTicker(plain.trading_symbol)) {
      skippedSpecial.push({ coinSymbol: plain.coin_symbol, tradingSymbol: plain.trading_symbol });
      continue;
    }

    const candidate = resolveBinanceCandidate(plain, baseAssets);
    if (!candidate) {
      unavailable.push({ coinSymbol: plain.coin_symbol, tradingSymbol: plain.trading_symbol });
      continue;
    }

    const previousTradingSymbol = plain.trading_symbol;
    await mapping.update({
      market: BINANCE_USDM_MARKET,
      trading_symbol: `${candidate}USDT`,
      notes: `${plain.notes ? `${plain.notes}；` : ''}币安优先同步于 ${now.toISOString().slice(0, 10)}（原 yahoo:${previousTradingSymbol}）`,
    });
    updated.push({
      coinSymbol: plain.coin_symbol,
      from: `${YAHOO_FINANCE_MARKET}:${previousTradingSymbol}`,
      to: `${BINANCE_USDM_MARKET}:${candidate}USDT`,
    });
  }

  return { updated, unavailable, skippedSpecial };
}

module.exports = {
  BINANCE_USDM_EXCHANGE_INFO_URL,
  clearBinanceUsdmSymbolCache,
  fetchBinanceUsdmBaseAssets,
  isPlainEquityTicker,
  preferBinanceUsdmForEquityMappings,
  resolveBinanceCandidate,
};
