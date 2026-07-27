// lightweight-charts 为 ESM 包，CRA 的 Jest 不转换 node_modules，仅能以 mock 载入
jest.mock('lightweight-charts', () => ({
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Normal: 0 },
  createChart: jest.fn(),
}));

import {
  formatChartAxisTime,
  formatChartTickMark,
  resolveIsYahooFinanceSource,
  shouldUseYahooFinanceKlines,
  syncTimeRange,
} from './otcCycleChartModel';

describe('resolveIsYahooFinanceSource', () => {
  test('falls back to the static symbol set before klines arrive', () => {
    expect(shouldUseYahooFinanceKlines('TSLA')).toBe(true);
    expect(resolveIsYahooFinanceSource('TSLA', [])).toBe(true);
    expect(resolveIsYahooFinanceSource('BTC', [])).toBe(false);
    expect(resolveIsYahooFinanceSource('TSLA', null)).toBe(true);
  });

  test('trusts the market reported by loaded klines over the static set', () => {
    // 管理员手动把美股映射切到 Binance 后，静态表仍认为 TSLA 是 Yahoo，
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

  test('uses the latest market when Yahoo history is followed by Binance rows', () => {
    const rows = [
      { market: 'yahoo_finance', close: 1 },
      { market: 'binance_usdm_perpetual', close: 2 },
    ];
    expect(resolveIsYahooFinanceSource('TSLA', rows)).toBe(false);
  });
});

describe('formatChartTickMark', () => {
  // 用本地 Date 计算期望值，使断言与运行时区无关：
  // 核心要求是刻度与十字线（formatChartAxisTime）同一时区
  const unixTime = Math.floor(Date.UTC(2026, 6, 26, 2, 30) / 1000);
  const local = new Date(unixTime * 1000);

  test('formats intraday ticks in the browser local timezone', () => {
    const expected = `${String(local.getHours()).padStart(2, '0')}:30`;
    expect(formatChartTickMark(unixTime, 3)).toBe(expected);
    // 与十字线悬浮时间同时区：悬浮串应以刻度的 HH:mm 结尾
    expect(formatChartAxisTime(unixTime).endsWith(expected)).toBe(true);
  });

  test('formats year/month/day ticks from the local calendar', () => {
    expect(formatChartTickMark(unixTime, 0)).toBe(String(local.getFullYear()));
    expect(formatChartTickMark(unixTime, 1)).toBe(`${local.getMonth() + 1}月`);
    expect(formatChartTickMark(unixTime, 2)).toBe(String(local.getDate()));
  });

  test('returns empty string for invalid input', () => {
    expect(formatChartTickMark(null, 3)).toBe('');
    expect(formatChartTickMark({ }, 3)).toBe('');
  });
});

describe('syncTimeRange', () => {
  const makeChart = (logicalRange, setVisibleRange = jest.fn()) => ({
    timeScale: () => ({
      getVisibleLogicalRange: () => logicalRange,
      setVisibleRange,
    }),
  });

  test('skips empty target charts while synchronizing a visible time range', () => {
    const readySetVisibleRange = jest.fn();
    const emptySetVisibleRange = jest.fn();
    const syncingRef = { current: false };
    const onRangeChange = jest.fn();
    const synchronize = syncTimeRange([
      makeChart({ from: 0, to: 2 }, readySetVisibleRange),
      makeChart(null, emptySetVisibleRange),
    ], syncingRef, onRangeChange);
    const range = { from: 100, to: 200 };

    synchronize(range);

    expect(readySetVisibleRange).toHaveBeenCalledWith(range);
    expect(emptySetVisibleRange).not.toHaveBeenCalled();
    expect(onRangeChange).toHaveBeenCalledWith(range);
    expect(syncingRef.current).toBe(false);
  });

  test('ignores ranges with null boundaries', () => {
    const setVisibleRange = jest.fn();
    const onRangeChange = jest.fn();
    const synchronize = syncTimeRange(
      [makeChart({ from: 0, to: 2 }, setVisibleRange)],
      { current: false },
      onRangeChange,
    );

    synchronize({ from: null, to: 200 });

    expect(setVisibleRange).not.toHaveBeenCalled();
    expect(onRangeChange).not.toHaveBeenCalled();
  });

  test('releases the synchronization guard when a chart update throws', () => {
    const syncingRef = { current: false };
    const synchronize = syncTimeRange([
      makeChart({ from: 0, to: 2 }, () => { throw new Error('chart update failed'); }),
    ], syncingRef);

    expect(() => synchronize({ from: 100, to: 200 })).toThrow('chart update failed');
    expect(syncingRef.current).toBe(false);
  });
});
