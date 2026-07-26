// lightweight-charts 为 ESM 包，CRA 的 Jest 不转换 node_modules，仅能以 mock 载入
jest.mock('lightweight-charts', () => ({
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Normal: 0 },
  createChart: jest.fn(),
}));

import { resolveIsYahooFinanceSource, shouldUseYahooFinanceKlines } from './otcCycleChartModel';

describe('resolveIsYahooFinanceSource', () => {
  test('falls back to the static symbol set before klines arrive', () => {
    expect(shouldUseYahooFinanceKlines('TSLA')).toBe(true);
    expect(resolveIsYahooFinanceSource('TSLA', [])).toBe(true);
    expect(resolveIsYahooFinanceSource('BTC', [])).toBe(false);
    expect(resolveIsYahooFinanceSource('TSLA', null)).toBe(true);
  });

  test('trusts the market reported by loaded klines over the static set', () => {
    // 美股映射被「美股优先币安」切换后，静态表仍认为 TSLA 是 Yahoo，
    // 必须以数据实际来源为准，否则图表会继续 15 分钟轮询而不开 WebSocket
    const binanceRows = [{ market: 'binance_usdm_perpetual', close: 1 }];
    expect(resolveIsYahooFinanceSource('TSLA', binanceRows)).toBe(false);

    const yahooRows = [{ market: 'yahoo_finance', close: 1 }];
    expect(resolveIsYahooFinanceSource('BTC', yahooRows)).toBe(true);
  });

  test('skips rows without market info when probing', () => {
    const rows = [{ close: 1 }, { market: 'binance_usdm_perpetual', close: 2 }];
    expect(resolveIsYahooFinanceSource('TSLA', rows)).toBe(false);
  });
});
