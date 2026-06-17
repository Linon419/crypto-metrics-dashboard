import React from 'react';
import { act } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createChart } from 'lightweight-charts';
import OtcCycleChart, {
  buildMetricHoverValueLabels,
  buildReviewVisibleTimeRange,
  buildSynchronizedVisibleTimeRange,
  buildTradingViewCycleModel,
  findNearestMetricEventForTime,
} from '../OtcCycleChart';
import { fetchCoinKlines, fetchCoinMetrics, subscribeCoinKlineStream } from '../../services/api';

jest.mock('lightweight-charts', () => {
  const makeSeries = () => ({
    setData: jest.fn(),
    createPriceLine: jest.fn(),
  });

  const makeChart = () => {
    const scale = {
      fitContent: jest.fn(),
      subscribeVisibleLogicalRangeChange: jest.fn(),
      unsubscribeVisibleLogicalRangeChange: jest.fn(),
      setVisibleLogicalRange: jest.fn(),
      subscribeVisibleTimeRangeChange: jest.fn(),
      unsubscribeVisibleTimeRangeChange: jest.fn(),
      setVisibleRange: jest.fn(),
      timeToCoordinate: jest.fn(() => 10),
    };
    return {
      addSeries: jest.fn(() => makeSeries()),
      applyOptions: jest.fn(),
      remove: jest.fn(),
      subscribeCrosshairMove: jest.fn(),
      unsubscribeCrosshairMove: jest.fn(),
      timeScale: jest.fn(() => scale),
    };
  };

  return {
    CandlestickSeries: 'CandlestickSeries',
    ColorType: { Solid: 'solid' },
    CrosshairMode: { Normal: 0 },
    LineSeries: 'LineSeries',
    LineStyle: { Dashed: 2, Dotted: 1 },
    createChart: jest.fn(() => makeChart()),
    createSeriesMarkers: jest.fn(),
  };
});

jest.mock('../../services/api', () => ({
  fetchCoinKlines: jest.fn(),
  fetchCoinMetrics: jest.fn(),
  subscribeCoinKlineStream: jest.fn(),
}));

const klines = [
  { openTime: '2026-01-01T00:00:00.000Z', closeTime: '2026-01-01T23:59:59.999Z', open: 100, high: 110, low: 90, close: 105, volume: 10 },
  { openTime: '2026-01-02T00:00:00.000Z', closeTime: '2026-01-02T23:59:59.999Z', open: 105, high: 120, low: 100, close: 115, volume: 12 },
  { openTime: '2026-01-03T00:00:00.000Z', closeTime: '2026-01-03T23:59:59.999Z', open: 115, high: 118, low: 95, close: 98, volume: 14 },
];

const metrics = [
  { date: '2026-01-01', otc_index: 900, explosion_index: -10, entry_exit_type: 'entry', entry_exit_day: 1 },
  { date: '2026-01-02', otc_index: 1200, explosion_index: 220, entry_exit_type: 'entry', entry_exit_day: 2 },
  { date: '2026-01-03', otc_index: 800, explosion_index: 150, entry_exit_type: 'exit', entry_exit_day: 1 },
];

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders BTC cycle chart with TradingView-style panels', async () => {
  fetchCoinKlines.mockResolvedValue({ symbol: 'BTC', interval: '4h', klines });
  fetchCoinMetrics.mockResolvedValue(metrics);

  render(<OtcCycleChart symbol="BTC" />);

  expect(await screen.findByText('量化 K 线')).toBeInTheDocument();
  expect(screen.getByText('15min')).toBeInTheDocument();
  expect(screen.getByText('1h')).toBeInTheDocument();
  expect(screen.getByText('4h')).toBeInTheDocument();
  expect(screen.getByText('日')).toBeInTheDocument();
  await waitFor(() => expect(fetchCoinKlines).toHaveBeenCalledWith('BTC', expect.objectContaining({ interval: '4h' })));
  expect(screen.getByTestId('cycle-chart')).toHaveTextContent('BTC K线');
  expect(screen.getByTestId('cycle-chart')).toHaveTextContent('BOLL(20,2)');
  expect(screen.getByTestId('cycle-chart')).toHaveTextContent('EMA10');
  expect(screen.getByTestId('cycle-chart')).toHaveTextContent('场外指数');
  expect(screen.getByTestId('cycle-chart')).toHaveTextContent('爆破指数');
  await waitFor(() => expect(createChart).toHaveBeenCalledTimes(3));
  expect(createChart.mock.calls.map(([, options]) => options.rightPriceScale.minimumWidth)).toEqual([72, 72, 72]);
});

test('loads 1500 older candles to the left and merges them with current candles', async () => {
  const olderKlines = [
    { openTime: '2025-12-30T00:00:00.000Z', closeTime: '2025-12-30T23:59:59.999Z', open: 90, high: 96, low: 88, close: 94, volume: 8 },
    { openTime: '2025-12-31T00:00:00.000Z', closeTime: '2025-12-31T23:59:59.999Z', open: 94, high: 102, low: 92, close: 100, volume: 9 },
    { openTime: '2026-01-01T00:00:00.000Z', closeTime: '2026-01-01T23:59:59.999Z', open: 100, high: 110, low: 90, close: 105, volume: 10 },
  ];
  const expandedMetrics = [
    { date: '2025-12-30', otc_index: 700, explosion_index: -50, entry_exit_type: 'entry', entry_exit_day: 1 },
    { date: '2025-12-31', otc_index: 820, explosion_index: -20, entry_exit_type: 'entry', entry_exit_day: 2 },
    ...metrics,
  ];
  fetchCoinKlines
    .mockResolvedValueOnce({ symbol: 'BTC', interval: '4h', klines })
    .mockResolvedValueOnce({ symbol: 'BTC', interval: '4h', klines: olderKlines });
  fetchCoinMetrics
    .mockResolvedValueOnce(metrics)
    .mockResolvedValueOnce(expandedMetrics);

  render(<OtcCycleChart symbol="BTC" />);

  expect(await screen.findByText('量化 K 线')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('最近 3 根')).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: /向左扩展 1500 根/ }));

  await waitFor(() => expect(fetchCoinKlines).toHaveBeenCalledTimes(2));
  expect(fetchCoinKlines).toHaveBeenLastCalledWith('BTC', expect.objectContaining({
    interval: '4h',
    limit: 1500,
    refresh: true,
    endTime: new Date('2026-01-01T00:00:00.000Z').getTime() - 1,
  }));
  await waitFor(() => expect(fetchCoinMetrics).toHaveBeenCalledTimes(2));
  expect(fetchCoinMetrics).toHaveBeenLastCalledWith('BTC', {
    startDate: '2025-12-30',
    endDate: '2026-01-03',
  });
  await waitFor(() => expect(screen.getByText('最近 5 根')).toBeInTheDocument());
});

test('updates the latest candle from the live kline stream', async () => {
  let handleLiveKline;
  fetchCoinKlines.mockResolvedValue({ symbol: 'BTC', interval: '4h', klines });
  fetchCoinMetrics.mockResolvedValue(metrics);
  subscribeCoinKlineStream.mockImplementation((symbol, options) => {
    handleLiveKline = options.onMessage;
    return jest.fn();
  });

  render(<OtcCycleChart symbol="BTC" />);

  await screen.findByText('量化 K 线');
  await waitFor(() => expect(subscribeCoinKlineStream).toHaveBeenCalledWith('BTC', expect.objectContaining({
    interval: '4h',
    onMessage: expect.any(Function),
  })));

  act(() => {
    handleLiveKline({
      type: 'kline',
      symbol: 'BTC',
      interval: '4h',
      isClosed: false,
      kline: {
        openTime: '2026-01-03T00:00:00.000Z',
        closeTime: '2026-01-03T00:14:59.999Z',
        open: 98,
        high: 132,
        low: 96,
        close: 128.5,
        volume: 18,
      },
    });
  });

  await waitFor(() => expect(screen.getByText('Close 128.50')).toBeInTheDocument());
});

test('builds TradingView model with signal markers and quant panels', () => {
  const model = buildTradingViewCycleModel({ klines, metrics, symbol: 'BTC' });

  expect(model.candles).toHaveLength(3);
  expect(model.ema10).toHaveLength(3);
  expect(model.otcIndex.map(point => point.value)).toEqual([900, 1200, 800]);
  expect(model.explosionIndex.map(point => point.value)).toEqual([-10, 220, 150]);
  expect(model.phaseRanges.length).toBeGreaterThan(0);
  expect(model.markers.map(marker => marker.text)).toEqual(expect.arrayContaining([
    '进1',
    '退1',
    '爆破上200',
    '爆破下破200',
    '爆破负转正',
  ]));
});

test('builds visible range from real candle time instead of sparse indicator logical index', () => {
  const model = buildTradingViewCycleModel({ klines, metrics });

  expect(buildReviewVisibleTimeRange(model.rows, 2)).toEqual({
    from: model.rows[1].time,
    to: model.rows[2].time,
  });
});

test('keeps review range on the candle timeline when metrics publish inside a candle', () => {
  const fourHourKlines = [
    { openTime: '2026-05-12T00:00:00.000Z', open: 100, high: 108, low: 96, close: 103, volume: 10 },
    { openTime: '2026-05-12T04:00:00.000Z', open: 103, high: 109, low: 99, close: 105, volume: 12 },
  ];
  const intrabarMetrics = [
    { date: '2026-05-12', timestamp: '2026-05-12T05:15:00.000Z', otc_index: 1200, explosion_index: -30, entry_exit_type: 'exit', entry_exit_day: 1 },
  ];
  const model = buildTradingViewCycleModel({ klines: fourHourKlines, metrics: intrabarMetrics });

  expect(buildSynchronizedVisibleTimeRange(model.rows, model.metricEvents, 2)).toEqual({
    from: model.rows[0].time,
    to: model.rows[1].time,
  });
});

test('keeps entry and exit phase backgrounds continuous across missing metric dates', () => {
  const gapKlines = [
    { openTime: '2026-01-01T00:00:00.000Z', open: 100, high: 110, low: 90, close: 105, volume: 10 },
    { openTime: '2026-01-02T00:00:00.000Z', open: 105, high: 115, low: 95, close: 108, volume: 10 },
    { openTime: '2026-01-03T00:00:00.000Z', open: 108, high: 118, low: 98, close: 112, volume: 10 },
    { openTime: '2026-01-04T00:00:00.000Z', open: 112, high: 116, low: 100, close: 104, volume: 10 },
    { openTime: '2026-01-05T00:00:00.000Z', open: 104, high: 108, low: 94, close: 98, volume: 10 },
  ];
  const sparseMetrics = [
    { date: '2026-01-01', otc_index: 900, explosion_index: -10, entry_exit_type: 'entry', entry_exit_day: 1 },
    { date: '2026-01-04', otc_index: 800, explosion_index: 100, entry_exit_type: 'exit', entry_exit_day: 1 },
  ];

  const model = buildTradingViewCycleModel({ klines: gapKlines, metrics: sparseMetrics });

  expect(model.phaseRanges).toEqual([
    { phase: 'entry', startTime: model.rows[0].time, endTime: model.rows[2].time },
    { phase: 'exit', startTime: model.rows[3].time, endTime: model.rows[4].time },
  ]);
});

test('marks each explosion down-cross below 200 and negative-to-positive cross', () => {
  const signalKlines = Array.from({ length: 7 }, (_, index) => ({
    openTime: `2026-02-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    open: 100 + index,
    high: 110 + index,
    low: 90 + index,
    close: 104 + index,
    volume: 10,
  }));
  const signalMetrics = [-20, 10, 240, 180, 260, 190, -5].map((explosionIndex, index) => ({
    date: `2026-02-${String(index + 1).padStart(2, '0')}`,
    otc_index: 1000,
    explosion_index: explosionIndex,
    entry_exit_type: index < 3 ? 'entry' : 'exit',
    entry_exit_day: index + 1,
  }));

  const model = buildTradingViewCycleModel({ klines: signalKlines, metrics: signalMetrics });
  const markerTexts = model.markers.map(marker => marker.text);

  expect(markerTexts.filter(text => text === '爆破下破200')).toHaveLength(2);
  expect(markerTexts.filter(text => text === '爆破负转正')).toHaveLength(1);
});

test('aligns metric timestamps to nearest kline while keeping original publish time', () => {
  const intradayKlines = [
    { openTime: '2026-03-01T00:00:00.000Z', open: 100, high: 106, low: 96, close: 104, volume: 10 },
    { openTime: '2026-03-01T00:15:00.000Z', open: 104, high: 108, low: 101, close: 106, volume: 11 },
    { openTime: '2026-03-01T00:30:00.000Z', open: 106, high: 112, low: 103, close: 110, volume: 12 },
  ];
  const timedMetrics = [
    {
      date: '2026-03-01',
      timestamp: '2026-03-01T00:18:00.000Z',
      time_precision: 'minute',
      otc_index: 1100,
      explosion_index: -20,
      entry_exit_type: 'entry',
      entry_exit_day: 1,
    },
    {
      date: '2026-03-01',
      timestamp: '2026-03-01T00:28:00.000Z',
      time_precision: 'minute',
      otc_index: 1180,
      explosion_index: 35,
      entry_exit_type: 'entry',
      entry_exit_day: 2,
    },
  ];

  const model = buildTradingViewCycleModel({ klines: intradayKlines, metrics: timedMetrics });

  expect(model.metricEvents).toEqual([
    expect.objectContaining({
      time: Math.floor(new Date('2026-03-01T00:18:00.000Z').getTime() / 1000),
      alignedTime: model.rows[1].time,
      publishedAt: '2026-03-01T00:18:00.000Z',
      displayTime: '3/1 00:18',
      otcIndex: 1100,
      explosionIndex: -20,
    }),
    expect.objectContaining({
      time: Math.floor(new Date('2026-03-01T00:28:00.000Z').getTime() / 1000),
      alignedTime: model.rows[2].time,
      publishedAt: '2026-03-01T00:28:00.000Z',
      displayTime: '3/1 00:28',
      otcIndex: 1180,
      explosionIndex: 35,
    }),
  ]);
  expect(model.otcPointMarkers).toHaveLength(2);
  expect(model.explosionPointMarkers).toHaveLength(2);
  expect(model.markers.map(marker => marker.text)).toEqual(expect.arrayContaining(['爆破负转正']));
});

test('plots the latest intrabar metric update on the candle timeline', () => {
  const fourHourKlines = [
    { openTime: '2026-05-12T00:00:00.000Z', open: 100, high: 108, low: 96, close: 103, volume: 10 },
    { openTime: '2026-05-12T04:00:00.000Z', open: 103, high: 109, low: 99, close: 105, volume: 12 },
  ];
  const intrabarMetrics = [
    { date: '2026-05-12', timestamp: '2026-05-12T04:15:00.000Z', otc_index: 1400, explosion_index: -24, entry_exit_type: 'exit', entry_exit_day: 1 },
    { date: '2026-05-12', timestamp: '2026-05-12T04:45:00.000Z', otc_index: 1300, explosion_index: 8, entry_exit_type: 'exit', entry_exit_day: 1 },
    { date: '2026-05-12', timestamp: '2026-05-12T05:15:00.000Z', otc_index: 1200, explosion_index: -30, entry_exit_type: 'exit', entry_exit_day: 1 },
  ];

  const model = buildTradingViewCycleModel({ klines: fourHourKlines, metrics: intrabarMetrics });

  expect(model.otcPointMarkers).toEqual([
    expect.objectContaining({
      time: model.rows[1].time,
      price: 1200,
    }),
  ]);
  expect(model.explosionPointMarkers).toEqual([
    expect.objectContaining({
      time: model.rows[1].time,
      price: -30,
    }),
  ]);
  expect(model.markers.filter(marker => marker.text === '退1')).toHaveLength(1);
});

test('uses the candle timeline for price and indicator panes', () => {
  const fourHourKlines = [
    { openTime: '2026-05-12T00:00:00.000Z', open: 100, high: 108, low: 96, close: 103, volume: 10 },
    { openTime: '2026-05-12T04:00:00.000Z', open: 103, high: 109, low: 99, close: 105, volume: 12 },
  ];
  const intrabarMetrics = [
    { date: '2026-05-12', timestamp: '2026-05-12T04:15:00.000Z', otc_index: 1400, explosion_index: -24, entry_exit_type: 'exit', entry_exit_day: 1 },
    { date: '2026-05-12', timestamp: '2026-05-12T04:45:00.000Z', otc_index: 1300, explosion_index: 8, entry_exit_type: 'exit', entry_exit_day: 1 },
  ];

  const model = buildTradingViewCycleModel({ klines: fourHourKlines, metrics: intrabarMetrics });
  const timeline = [
    Math.floor(new Date('2026-05-12T00:00:00.000Z').getTime() / 1000),
    Math.floor(new Date('2026-05-12T04:00:00.000Z').getTime() / 1000),
  ];

  expect(model.timeline).toEqual(timeline);
  expect(model.candles.map(point => point.time)).toEqual(timeline);
  expect(model.otcIndex.map(point => point.time)).toEqual(timeline);
  expect(model.explosionIndex.map(point => point.time)).toEqual(timeline);
  expect(model.otcIndex[0]).toEqual({ time: timeline[0] });
  expect(model.otcIndex[1]).toEqual({ time: timeline[1], value: 1300 });
  expect(model.explosionIndex[1]).toEqual({ time: timeline[1], value: 8 });
  expect(model.markers.find(marker => marker.text === '退1')).toEqual(expect.objectContaining({ time: timeline[1] }));
  expect(model.markers.find(marker => marker.text === '爆破负转正')).toEqual(expect.objectContaining({ time: timeline[1] }));
});

test('snaps hover time to the nearest nearby metric event', () => {
  const metricEvents = [
    { time: 100, otcIndex: 900, explosionIndex: -10 },
    { time: 160, otcIndex: 1030, explosionIndex: 8 },
  ];

  expect(findNearestMetricEventForTime(metricEvents, 152, 15)).toBe(metricEvents[1]);
  expect(findNearestMetricEventForTime(metricEvents, 130, 15)).toBeNull();
});

test('builds hover labels inside both indicator panes at the same x coordinate', () => {
  const event = { time: 100, alignedTime: 90, otcIndex: 1406, explosionIndex: 176 };
  const timeScale = { timeToCoordinate: jest.fn(() => 240) };
  const otcSeries = { priceToCoordinate: jest.fn(() => 36) };
  const explosionSeries = { priceToCoordinate: jest.fn(() => 88) };

  expect(buildMetricHoverValueLabels(event, timeScale, otcSeries, explosionSeries)).toEqual({
    x: 240,
    otc: { value: 1406, top: 36, left: 240 },
    explosion: { value: 176, top: 88, left: 240 },
  });
  expect(timeScale.timeToCoordinate).toHaveBeenCalledWith(90);
});

test('builds BOLL lines after enough candles', () => {
  const longKlines = Array.from({ length: 25 }, (_, index) => ({
    openTime: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    open: 100 + index,
    high: 105 + index,
    low: 95 + index,
    close: 101 + index,
    volume: 10 + index,
  }));
  const model = buildTradingViewCycleModel({ klines: longKlines, metrics: [] });

  expect(model.boll.upper.length).toBe(6);
  expect(model.boll.middle.length).toBe(6);
  expect(model.boll.lower.length).toBe(6);
});
