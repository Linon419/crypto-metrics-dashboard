import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
} from 'lightweight-charts';
import { Alert, Button, Segmented, Spin, Switch, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { fetchCoinKlines, fetchCoinMetrics, subscribeCoinKlineStream } from '../services/api';

const { Text } = Typography;

const CHART_PERIODS = [
  { label: '15min', value: '15m', limit: 500 },
  { label: '1h', value: '1h', limit: 500 },
  { label: '4h', value: '4h', limit: 500 },
  { label: '日', value: '1d', limit: 365 },
];

const DEFAULT_CHART_INTERVAL = '4h';
const LEFT_EXPAND_LIMIT = 1500;
const GREEN = '#22c55e';
const RED = '#ef4444';
const ORANGE = '#f59e0b';
const BLUE = '#2563eb';
const PURPLE = '#8b5cf6';
const TEXT = '#2f3337';
const RIGHT_PRICE_SCALE_WIDTH = 72;

function formatMetricDateKey(value) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toChartTime(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.floor(timestamp / 1000);
}

function getMetricValue(metric, camelKey, snakeKey) {
  return toNumber(metric?.[camelKey] ?? metric?.[snakeKey]);
}

function getMetricDate(metric) {
  return metric?.date || formatMetricDateKey(metric?.timestamp);
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return number.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMetric(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return number.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPublishTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${month}/${day} ${hour}:${minute}`;
}

function getMetricPublishedAt(metric) {
  const timestamp = metric?.timestamp || metric?.timeStamp;
  const parsedTimestamp = timestamp ? new Date(timestamp) : null;
  if (parsedTimestamp && !Number.isNaN(parsedTimestamp.getTime())) {
    return parsedTimestamp.toISOString();
  }

  const date = getMetricDate(metric);
  const parsedDate = date ? new Date(`${date}T00:00:00.000Z`) : null;
  if (parsedDate && !Number.isNaN(parsedDate.getTime())) {
    return parsedDate.toISOString();
  }

  return null;
}

function findNearestRow(rows, timestamp) {
  if (!rows.length || timestamp === null) return null;
  return rows.reduce((nearest, row) => {
    const distance = Math.abs(row.time - timestamp);
    const nearestDistance = Math.abs(nearest.time - timestamp);
    return distance < nearestDistance ? row : nearest;
  }, rows[0]);
}

export function findNearestMetricEventForTime(metricEvents, time, maxDistanceSeconds) {
  if (!Array.isArray(metricEvents) || metricEvents.length === 0 || time === undefined || time === null) {
    return null;
  }

  const targetTime = Number(time);
  if (!Number.isFinite(targetTime)) return null;

  const nearest = metricEvents.reduce((best, event) => {
    const eventTime = Number(event.time);
    if (!Number.isFinite(eventTime)) return best;
    const distance = Math.abs(eventTime - targetTime);
    if (!best || distance < best.distance) {
      return { event, distance };
    }
    return best;
  }, null);

  if (!nearest || nearest.distance > maxDistanceSeconds) return null;
  return nearest.event;
}

function toFiniteCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getSeriesPriceCoordinate(series, value) {
  if (value === null || value === undefined) return null;
  return toFiniteCoordinate(series?.priceToCoordinate?.(value));
}

export function buildMetricHoverValueLabels(event, timeScale, otcSeries, explosionSeries) {
  if (!event) return null;

  const x = toFiniteCoordinate(timeScale?.timeToCoordinate?.(event.alignedTime ?? event.time));
  if (x === null) return null;

  return {
    x,
    otc: {
      value: event.otcIndex,
      top: getSeriesPriceCoordinate(otcSeries, event.otcIndex),
      left: x,
    },
    explosion: {
      value: event.explosionIndex,
      top: getSeriesPriceCoordinate(explosionSeries, event.explosionIndex),
      left: x,
    },
  };
}

function getMedianRowTimeGap(rows) {
  const gaps = rows
    .slice(1)
    .map((row, index) => row.time - rows[index].time)
    .filter(gap => Number.isFinite(gap) && gap > 0)
    .sort((left, right) => left - right);
  return gaps.length ? gaps[Math.floor(gaps.length / 2)] : 60;
}

function buildKlineRows(klines = []) {
  return klines.map((kline) => {
    const open = toNumber(kline.open);
    const high = toNumber(kline.high);
    const low = toNumber(kline.low);
    const close = toNumber(kline.close);
    const volume = toNumber(kline.volume) ?? 0;
    const time = toChartTime(kline.openTime);
    const metricDate = formatMetricDateKey(kline.openTime);

    if ([open, high, low, close, time].some(value => value === null)) return null;

    return {
      time,
      metricDate,
      open,
      high,
      low,
      close,
      volume,
      otcIndex: null,
      explosionIndex: null,
      metric: null,
      metricEvent: null,
    };
  }).filter(Boolean).sort((a, b) => a.time - b.time);
}

export function mergeKlinesByOpenTime(currentKlines = [], incomingKlines = []) {
  const byOpenTime = new Map();

  [...currentKlines, ...incomingKlines].forEach((kline) => {
    if (!kline?.openTime) return;
    byOpenTime.set(kline.openTime, kline);
  });

  return Array.from(byOpenTime.values()).sort((left, right) => (
    new Date(left.openTime).getTime() - new Date(right.openTime).getTime()
  ));
}

function getMetricVersionKey(metric = {}) {
  const timestamp = metric.timestamp || metric.timeStamp;
  return timestamp || `${metric.date || ''}:${metric.time_precision || metric.timePrecision || 'day'}`;
}

function getMetricSortTime(metric = {}) {
  const timestamp = metric.timestamp || metric.timeStamp;
  const value = timestamp || (metric.date ? `${metric.date}T00:00:00.000Z` : null);
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mergeMetricsByVersion(currentMetrics = [], incomingMetrics = []) {
  const byVersion = new Map();

  [...currentMetrics, ...incomingMetrics].forEach((metric) => {
    const key = getMetricVersionKey(metric);
    if (!key) return;
    byVersion.set(key, metric);
  });

  return Array.from(byVersion.values()).sort((left, right) => (
    getMetricSortTime(left) - getMetricSortTime(right)
  ));
}

function getKlineDateRange(klines = []) {
  const validDates = klines
    .map(kline => formatMetricDateKey(kline.openTime))
    .filter(Boolean)
    .sort();

  if (validDates.length === 0) return null;
  return {
    startDate: validDates[0],
    endDate: validDates[validDates.length - 1],
  };
}

function buildMetricEvents(metrics = [], rows = []) {
  return metrics.map((metric) => {
    const publishedAt = getMetricPublishedAt(metric);
    const publishedTime = toChartTime(publishedAt);
    const nearestRow = findNearestRow(rows, publishedTime);
    if (!publishedAt || publishedTime === null || !nearestRow) return null;

    return {
      time: publishedTime,
      alignedTime: nearestRow.time,
      publishedTime,
      publishedAt,
      displayTime: formatPublishTime(publishedAt),
      metricDate: getMetricDate(metric),
      timePrecision: metric?.time_precision || metric?.timePrecision || 'day',
      otcIndex: getMetricValue(metric, 'otcIndex', 'otc_index'),
      explosionIndex: getMetricValue(metric, 'explosionIndex', 'explosion_index'),
      phase: metric?.entry_exit_type || metric?.entryExitType || 'neutral',
      day: metric?.entry_exit_day ?? metric?.entryExitDay,
      periodQuality: metric?.period_quality || metric?.periodQuality || null,
      markerPriceAbove: nearestRow.high,
      markerPriceMiddle: nearestRow.close,
      markerPriceBelow: nearestRow.low,
      metric,
    };
  }).filter(Boolean).sort((left, right) => (
    left.publishedTime - right.publishedTime || left.time - right.time
  ));
}

function getLatestEventsByAlignedTime(metricEvents = []) {
  const byTime = new Map();
  metricEvents.forEach((event) => {
    byTime.set(event.alignedTime, event);
  });
  return Array.from(byTime.values()).sort((left, right) => left.alignedTime - right.alignedTime);
}

function buildAlignedRows(klines = [], metrics = []) {
  const baseRows = buildKlineRows(klines);
  const metricEvents = buildMetricEvents(metrics, baseRows);
  const latestEvents = getLatestEventsByAlignedTime(metricEvents);
  const eventsByTime = new Map(latestEvents.map(event => [event.alignedTime, event]));
  const rows = baseRows.map((row) => {
    const event = eventsByTime.get(row.time);
    if (!event) return row;

    return {
      ...row,
      otcIndex: event.otcIndex,
      explosionIndex: event.explosionIndex,
      metric: event.metric,
      metricEvent: event,
    };
  });

  return { rows, metricEvents, latestEvents };
}

function buildPhaseRanges(rows) {
  const ranges = [];
  let current = null;
  let activePhase = null;

  rows.forEach((row, index) => {
    const phase = row.metric?.entry_exit_type || row.metric?.entryExitType;
    const normalizedPhase = phase === 'entry' || phase === 'exit' ? phase : null;

    if (normalizedPhase) {
      activePhase = normalizedPhase;
    }

    if (!activePhase) return;

    if (!current || current.phase !== activePhase) {
      if (current) {
        current.endTime = rows[index - 1]?.time || current.startTime;
        ranges.push(current);
      }
      current = {
        phase: activePhase,
        startTime: row.time,
        endTime: row.time,
      };
    } else {
      current.endTime = row.time;
    }
  });

  if (current) ranges.push(current);
  return ranges;
}

function pushUniqueTradingViewMarker(markers, seen, marker) {
  const key = marker.dedupeKey || `${marker.time}:${marker.text}`;
  if (seen.has(key)) return;
  seen.add(key);
  const { dedupeKey, ...viewMarker } = marker;
  markers.push(viewMarker);
}

function buildTradingViewMarkers(metricEvents) {
  const markers = [];
  const seen = new Set();

  metricEvents.forEach((event, index) => {
    const phase = event.phase;
    const day = event.day;
    const currentExplosion = event.explosionIndex;
    const previousEvent = metricEvents
      .slice(0, index)
      .reverse()
      .find(item => item.explosionIndex !== null);
    const previousExplosion = previousEvent?.explosionIndex ?? null;

    if (phase === 'entry' && Number(day) === 1) {
      pushUniqueTradingViewMarker(markers, seen, {
        time: event.alignedTime,
        position: 'atPriceBottom',
        price: event.markerPriceBelow,
        color: GREEN,
        shape: 'arrowUp',
        text: '进1',
        dedupeKey: `${event.metricDate}:entry:1`,
      });
    }

    if (phase === 'exit' && Number(day) === 1) {
      pushUniqueTradingViewMarker(markers, seen, {
        time: event.alignedTime,
        position: 'atPriceTop',
        price: event.markerPriceAbove,
        color: RED,
        shape: 'arrowDown',
        text: '退1',
        dedupeKey: `${event.metricDate}:exit:1`,
      });
    }

    if (previousExplosion !== null && currentExplosion !== null && previousExplosion < 200 && currentExplosion >= 200) {
      pushUniqueTradingViewMarker(markers, seen, {
        time: event.alignedTime,
        position: 'atPriceTop',
        price: event.markerPriceAbove,
        color: ORANGE,
        shape: 'circle',
        text: '爆破上200',
      });
    }

    if (previousExplosion !== null && currentExplosion !== null && previousExplosion >= 200 && currentExplosion < 200) {
      pushUniqueTradingViewMarker(markers, seen, {
        time: event.alignedTime,
        position: 'atPriceBottom',
        price: event.markerPriceBelow,
        color: RED,
        shape: 'circle',
        text: '爆破下破200',
      });
    }

    if (previousExplosion !== null && currentExplosion !== null && previousExplosion < 0 && currentExplosion > 0) {
      pushUniqueTradingViewMarker(markers, seen, {
        time: event.alignedTime,
        position: 'atPriceBottom',
        price: event.markerPriceBelow,
        color: PURPLE,
        shape: 'circle',
        text: '爆破负转正',
      });
    }
  });

  return markers;
}

function buildMetricPointMarkers(metricEvents, valueKey, color) {
  return metricEvents
    .filter(event => event[valueKey] !== null)
    .map(event => ({
      id: `${valueKey}-${event.publishedAt}`,
      time: event.alignedTime,
      position: 'atPriceMiddle',
      price: event[valueKey],
      color,
      shape: 'circle',
      size: 0.65,
    }));
}

function buildCandleTimeline(rows) {
  return rows.map(row => row.time);
}

function buildTimelineCandles(rows) {
  return rows.map(row => ({
    time: row.time,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
  }));
}

function buildAlignedMetricSeries(rows, metricEvents, valueKey) {
  const valuesByTime = new Map();
  metricEvents.forEach((event) => {
    if (event[valueKey] !== null) {
      valuesByTime.set(event.alignedTime, event[valueKey]);
    }
  });

  return rows.map(row => (
    valuesByTime.has(row.time)
      ? { time: row.time, value: valuesByTime.get(row.time) }
      : { time: row.time }
  ));
}

function buildEma(rows, period = 10) {
  const alpha = 2 / (period + 1);
  let previous = null;

  return rows.map((row) => {
    previous = previous === null ? row.close : row.close * alpha + previous * (1 - alpha);
    return {
      time: row.time,
      value: previous,
    };
  });
}

function buildBollingerBands(rows, period = 20, multiplier = 2) {
  const upper = [];
  const middle = [];
  const lower = [];

  rows.forEach((row, index) => {
    if (index + 1 < period) return;

    const windowRows = rows.slice(index + 1 - period, index + 1);
    const closes = windowRows.map(item => item.close);
    const mean = closes.reduce((sum, value) => sum + value, 0) / period;
    const variance = closes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
    const deviation = Math.sqrt(variance);

    middle.push({ time: row.time, value: mean });
    upper.push({ time: row.time, value: mean + deviation * multiplier });
    lower.push({ time: row.time, value: mean - deviation * multiplier });
  });

  return { upper, middle, lower };
}

export function buildTradingViewCycleModel({ klines = [], metrics = [] }) {
  const { rows, metricEvents, latestEvents } = buildAlignedRows(klines, metrics);
  const latest = rows.at(-1) || null;
  const latestMetricEvent = metricEvents.at(-1) || null;
  const boll = buildBollingerBands(rows);
  const timeline = buildCandleTimeline(rows);

  return {
    rows,
    timeline,
    metricEvents,
    candles: buildTimelineCandles(rows),
    ema10: buildEma(rows, 10),
    boll,
    otcIndex: buildAlignedMetricSeries(rows, latestEvents, 'otcIndex'),
    explosionIndex: buildAlignedMetricSeries(rows, latestEvents, 'explosionIndex'),
    otcPointMarkers: buildMetricPointMarkers(latestEvents, 'otcIndex', BLUE),
    explosionPointMarkers: buildMetricPointMarkers(latestEvents, 'explosionIndex', PURPLE),
    markers: buildTradingViewMarkers(metricEvents),
    phaseRanges: buildPhaseRanges(rows),
    latest: latest ? {
      close: latest.close,
      otcIndex: latestMetricEvent?.otcIndex ?? null,
      explosionIndex: latestMetricEvent?.explosionIndex ?? null,
    } : null,
  };
}

export function buildOtcCycleChartOption(args) {
  return buildTradingViewCycleModel(args);
}

function createBaseChart(container, height, showTimeScale = false, showAttribution = false) {
  return createChart(container, {
    width: container.clientWidth || 800,
    height,
    layout: {
      background: { type: ColorType.Solid, color: '#ffffff' },
      textColor: TEXT,
      fontSize: 12,
      fontFamily: '"DIN Alternate", "Avenir Next", sans-serif',
      attributionLogo: showAttribution,
    },
    grid: {
      vertLines: { color: 'rgba(226, 232, 240, 0.74)' },
      horzLines: { color: 'rgba(226, 232, 240, 0.86)' },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
    },
    rightPriceScale: {
      visible: true,
      borderColor: '#d1d5db',
      minimumWidth: RIGHT_PRICE_SCALE_WIDTH,
    },
    leftPriceScale: {
      visible: false,
    },
    timeScale: {
      visible: showTimeScale,
      borderColor: '#d1d5db',
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 2,
      minBarSpacing: 3,
      lockVisibleTimeRangeOnResize: true,
      rightBarStaysOnScroll: true,
    },
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: false,
    },
    handleScale: {
      axisPressedMouseMove: true,
      mouseWheel: true,
      pinch: true,
    },
  });
}

function getReviewVisibleBars(interval, rowCount) {
  if (rowCount <= 0) return 0;
  const byInterval = {
    '15m': 180,
    '1h': 168,
    '4h': 120,
    '1d': 120,
  };
  return Math.min(rowCount, byInterval[interval] || 120);
}

export function buildReviewVisibleTimeRange(rows, visibleBars) {
  if (!Array.isArray(rows) || rows.length === 0 || visibleBars <= 0) return null;
  const fromIndex = Math.max(0, rows.length - visibleBars);
  return {
    from: rows[fromIndex].time,
    to: rows[rows.length - 1].time,
  };
}

export function buildSynchronizedVisibleTimeRange(rows, metricEvents = [], visibleBars) {
  return buildReviewVisibleTimeRange(rows, visibleBars);
}

function applyReviewRange(charts, rows, visibleBars, metricEvents = []) {
  const range = buildSynchronizedVisibleTimeRange(rows, metricEvents, visibleBars);
  if (!range) return;
  charts.forEach((chart) => {
    chart.timeScale().setVisibleRange(range);
  });
}

function syncTimeRange(targets, syncingRef) {
  return (range) => {
    if (!range || syncingRef.current) return;
    syncingRef.current = true;
    targets.forEach((chart) => {
      chart.timeScale().setVisibleRange(range);
    });
    syncingRef.current = false;
  };
}

function OtcCycleChart({
  symbol = 'BTC',
  startDate,
  endDate,
  embedded = false,
  height = 640,
}) {
  const normalizedSymbol = String(symbol || '').toUpperCase();
  const [interval, setInterval] = useState(DEFAULT_CHART_INTERVAL);
  const [klines, setKlines] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandingLeft, setExpandingLeft] = useState(false);
  const [error, setError] = useState(null);
  const [showMetricEvents, setShowMetricEvents] = useState(true);
  const [hoveredMetricEvent, setHoveredMetricEvent] = useState(null);
  const [hoverValueLabels, setHoverValueLabels] = useState(null);
  const priceRootRef = useRef(null);
  const otcRootRef = useRef(null);
  const explosionRootRef = useRef(null);
  const phaseLayerRef = useRef(null);
  const syncingRef = useRef(false);

  const selectedPeriod = CHART_PERIODS.find(period => period.value === interval) || CHART_PERIODS[0];

  const loadChartData = useCallback(async ({ refresh = false } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const [klineResult, metricResult] = await Promise.all([
        fetchCoinKlines(symbol, {
          interval: selectedPeriod.value,
          limit: selectedPeriod.limit,
          refresh,
          startTime: startDate ? new Date(startDate).getTime() : undefined,
          endTime: endDate ? new Date(`${endDate}T23:59:59.999Z`).getTime() : undefined,
        }),
        fetchCoinMetrics(symbol, {
          startDate,
          endDate,
        }),
      ]);
      setKlines(klineResult?.klines || []);
      setMetrics(Array.isArray(metricResult) ? metricResult : []);
    } catch (err) {
      setError(err.message || '新版场外周期图加载失败');
    } finally {
      setLoading(false);
    }
  }, [endDate, selectedPeriod.limit, selectedPeriod.value, startDate, symbol]);

  useEffect(() => {
    loadChartData();
  }, [loadChartData]);

  const loadOlderKlines = useCallback(async () => {
    if (expandingLeft || klines.length === 0) return;

    const earliestOpenTime = klines.reduce((earliest, kline) => {
      const openTime = new Date(kline.openTime).getTime();
      return Number.isFinite(openTime) && openTime < earliest ? openTime : earliest;
    }, Infinity);

    if (!Number.isFinite(earliestOpenTime)) return;

    setExpandingLeft(true);
    setError(null);
    try {
      const result = await fetchCoinKlines(symbol, {
        interval: selectedPeriod.value,
        limit: LEFT_EXPAND_LIMIT,
        refresh: true,
        endTime: earliestOpenTime - 1,
      });
      const expandedKlines = mergeKlinesByOpenTime(klines, result?.klines || []);
      const expandedRange = getKlineDateRange(expandedKlines);
      if (expandedRange) {
        const metricResult = await fetchCoinMetrics(symbol, {
          startDate: expandedRange.startDate,
          endDate: endDate || expandedRange.endDate,
        });
        setMetrics(current => mergeMetricsByVersion(
          current,
          Array.isArray(metricResult) ? metricResult : [],
        ));
      }
      setKlines(expandedKlines);
    } catch (err) {
      setError(err.message || '向左扩展K线失败');
    } finally {
      setExpandingLeft(false);
    }
  }, [endDate, expandingLeft, klines, selectedPeriod.value, symbol]);

  useEffect(() => {
    if (normalizedSymbol === 'VEGA') return () => {};

    return subscribeCoinKlineStream(symbol, {
      interval: selectedPeriod.value,
      onMessage: (message) => {
        if (message?.interval !== selectedPeriod.value || !message?.kline?.openTime) return;
        setKlines(current => mergeKlinesByOpenTime(current, [message.kline]));
      },
      onError: (event) => {
        const message = event?.message || '实时K线连接异常';
        console.warn('[OtcCycleChart] live kline stream error:', message);
      },
    });
  }, [normalizedSymbol, selectedPeriod.value, symbol]);

  const model = useMemo(
    () => buildTradingViewCycleModel({ klines, metrics }),
    [klines, metrics],
  );
  const visibleBars = getReviewVisibleBars(interval, model.rows.length);
  const priceChartHeight = Math.max(430, Math.round((height - 86) * 0.66));
  const indicatorChartHeight = Math.max(128, Math.round((height - 86) * 0.17));
  const hoverSnapSeconds = Math.max(60, Math.round(getMedianRowTimeGap(model.rows) * 1.5));

  useEffect(() => {
    if (!priceRootRef.current || !otcRootRef.current || !explosionRootRef.current || model.rows.length === 0) {
      return undefined;
    }

    const priceChart = createBaseChart(priceRootRef.current, priceChartHeight, false, true);
    const otcChart = createBaseChart(otcRootRef.current, indicatorChartHeight, false);
    const explosionChart = createBaseChart(explosionRootRef.current, indicatorChartHeight, true);
    const phaseLayer = phaseLayerRef.current;

    if (!priceChart || !otcChart || !explosionChart) {
      return undefined;
    }

    const candleSeries = priceChart.addSeries(CandlestickSeries, {
      upColor: GREEN,
      downColor: RED,
      borderUpColor: GREEN,
      borderDownColor: RED,
      wickUpColor: GREEN,
      wickDownColor: RED,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    candleSeries.setData(model.candles);
    createSeriesMarkers(candleSeries, model.markers, { zOrder: 'top' });

    const emaSeries = priceChart.addSeries(LineSeries, {
      color: BLUE,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    emaSeries.setData(model.ema10);

    const bollUpperSeries = priceChart.addSeries(LineSeries, {
      color: '#64748b',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    bollUpperSeries.setData(model.boll.upper);

    const bollMiddleSeries = priceChart.addSeries(LineSeries, {
      color: ORANGE,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    bollMiddleSeries.setData(model.boll.middle);

    const bollLowerSeries = priceChart.addSeries(LineSeries, {
      color: '#64748b',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    bollLowerSeries.setData(model.boll.lower);

    if (model.latest) {
      candleSeries.createPriceLine({
        price: model.latest.close,
        color: model.candles.at(-1)?.close >= model.candles.at(-1)?.open ? GREEN : RED,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: symbol,
      });
    }

    const otcSeries = otcChart.addSeries(LineSeries, {
      color: BLUE,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    otcSeries.setData(model.otcIndex);
    if (showMetricEvents) {
      createSeriesMarkers(otcSeries, model.otcPointMarkers, { zOrder: 'top' });
    }
    otcSeries.createPriceLine({
      price: 1000,
      color: ORANGE,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: '1000',
    });
    if (model.latest?.otcIndex !== null && model.latest?.otcIndex !== undefined) {
      otcSeries.createPriceLine({
        price: model.latest.otcIndex,
        color: BLUE,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: '场外',
      });
    }

    const explosionSeries = explosionChart.addSeries(LineSeries, {
      color: PURPLE,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    explosionSeries.setData(model.explosionIndex);
    if (showMetricEvents) {
      createSeriesMarkers(explosionSeries, model.explosionPointMarkers, { zOrder: 'top' });
    }
    explosionSeries.createPriceLine({
      price: 200,
      color: ORANGE,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: '200',
    });
    explosionSeries.createPriceLine({
      price: 0,
      color: '#64748b',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: true,
      title: '0',
    });
    if (model.latest?.explosionIndex !== null && model.latest?.explosionIndex !== undefined) {
      explosionSeries.createPriceLine({
        price: model.latest.explosionIndex,
        color: PURPLE,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: '爆破',
      });
    }

    const charts = [priceChart, otcChart, explosionChart];
    applyReviewRange(charts, model.rows, visibleBars, model.metricEvents);

    const updateMetricHover = (param) => {
      const event = findNearestMetricEventForTime(model.metricEvents, param?.time, hoverSnapSeconds);
      setHoveredMetricEvent(event || null);
      if (!event) {
        setHoverValueLabels(null);
        return;
      }

      setHoverValueLabels(buildMetricHoverValueLabels(
        event,
        otcChart.timeScale(),
        otcSeries,
        explosionSeries,
      ));
    };

    priceChart.subscribeCrosshairMove(updateMetricHover);
    otcChart.subscribeCrosshairMove(updateMetricHover);
    explosionChart.subscribeCrosshairMove(updateMetricHover);

    const priceSync = syncTimeRange([otcChart, explosionChart], syncingRef);
    const otcSync = syncTimeRange([priceChart, explosionChart], syncingRef);
    const explosionSync = syncTimeRange([priceChart, otcChart], syncingRef);
    priceChart.timeScale().subscribeVisibleTimeRangeChange(priceSync);
    otcChart.timeScale().subscribeVisibleTimeRangeChange(otcSync);
    explosionChart.timeScale().subscribeVisibleTimeRangeChange(explosionSync);

    const updatePhaseLayer = () => {
      const layer = phaseLayer;
      if (!layer) return;
      const chartWidth = priceRootRef.current?.clientWidth || 0;
      layer.innerHTML = '';
      if (chartWidth <= 0) return;

      const coordinates = model.rows
        .map(row => priceChart.timeScale().timeToCoordinate(row.time))
        .filter(value => value !== null)
        .sort((left, right) => left - right);
      const gaps = coordinates
        .slice(1)
        .map((coordinate, index) => coordinate - coordinates[index])
        .filter(gap => gap > 0);
      const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 8;
      const barHalfWidth = Math.max(4, Math.min(36, medianGap / 2));

      model.phaseRanges.forEach((range) => {
        const startX = priceChart.timeScale().timeToCoordinate(range.startTime);
        const endX = priceChart.timeScale().timeToCoordinate(range.endTime);
        if (startX === null || endX === null) return;
        const left = Math.max(0, Math.min(startX, endX) - barHalfWidth);
        const right = Math.min(chartWidth, Math.max(startX, endX) + barHalfWidth);
        const band = document.createElement('div');
        band.className = `tv-cycle-chart__phase-band tv-cycle-chart__phase-band--${range.phase}`;
        band.style.left = `${left}px`;
        band.style.width = `${Math.max(2, right - left)}px`;
        layer.appendChild(band);
      });
    };

    priceChart.timeScale().subscribeVisibleTimeRangeChange(updatePhaseLayer);
    updatePhaseLayer();

    const resize = () => {
      const priceWidth = priceRootRef.current?.clientWidth || 800;
      const otcWidth = otcRootRef.current?.clientWidth || priceWidth;
      const explosionWidth = explosionRootRef.current?.clientWidth || priceWidth;
      priceChart.applyOptions({ width: priceWidth, height: priceChartHeight });
      otcChart.applyOptions({ width: otcWidth, height: indicatorChartHeight });
      explosionChart.applyOptions({ width: explosionWidth, height: indicatorChartHeight });
      applyReviewRange(charts, model.rows, visibleBars, model.metricEvents);
      updatePhaseLayer();
    };

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    [priceRootRef.current, otcRootRef.current, explosionRootRef.current].forEach((node) => {
      if (node && observer) observer.observe(node);
    });
    window.addEventListener('resize', resize);

    return () => {
      priceChart.timeScale().unsubscribeVisibleTimeRangeChange(priceSync);
      priceChart.timeScale().unsubscribeVisibleTimeRangeChange(updatePhaseLayer);
      priceChart.unsubscribeCrosshairMove(updateMetricHover);
      otcChart.timeScale().unsubscribeVisibleTimeRangeChange(otcSync);
      otcChart.unsubscribeCrosshairMove(updateMetricHover);
      explosionChart.timeScale().unsubscribeVisibleTimeRangeChange(explosionSync);
      explosionChart.unsubscribeCrosshairMove(updateMetricHover);
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      charts.forEach(chart => chart.remove());
      if (phaseLayer) phaseLayer.innerHTML = '';
      setHoverValueLabels(null);
    };
  }, [hoverSnapSeconds, indicatorChartHeight, model, priceChartHeight, showMetricEvents, symbol, visibleBars]);

  const latest = model.latest;
  const metricStatusText = showMetricEvents
    ? '指标时间点 开'
    : '指标时间点 关';

  return (
    <section className={`otc-cycle-chart-panel${embedded ? ' otc-cycle-chart-panel--embedded' : ''}`}>
      <div className="otc-cycle-chart-panel__header">
        <div>
          <div className="otc-cycle-chart-panel__eyebrow">TradingView Quant Kline</div>
          <h2>量化 K 线</h2>
        </div>
        <div className="otc-cycle-chart-panel__actions">
          <Segmented
            options={CHART_PERIODS.map(period => ({ label: period.label, value: period.value }))}
            value={interval}
            onChange={setInterval}
          />
          <Switch
            className="otc-cycle-chart-panel__time-switch"
            size="small"
            checked={showMetricEvents}
            onChange={setShowMetricEvents}
            checkedChildren="指标点"
            unCheckedChildren="指标点"
            aria-label="指标时间点"
          />
          <Button
            size="small"
            loading={expandingLeft}
            disabled={loading || klines.length === 0}
            onClick={loadOlderKlines}
          >
            向左扩展 1500 根
          </Button>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => loadChartData({ refresh: true })}
          >
            刷新K线
          </Button>
        </div>
      </div>

      {error && (
        <Alert
          type="warning"
          showIcon
          className="mb-3"
          message="新版场外周期图加载失败"
          description={error}
        />
      )}

      {loading && klines.length === 0 ? (
        <div className="otc-cycle-chart-panel__loading">
          <Spin size="small" />
          <Text>正在加载 {symbol} K 线与场外指标</Text>
        </div>
      ) : (
        <div className="tv-cycle-chart" data-testid="cycle-chart">
          <div className="tv-cycle-chart__summary">
            <span>{symbol} K线</span>
            <b>Close {formatPrice(latest?.close)}</b>
            <b><i className="tv-cycle-chart__legend-line tv-cycle-chart__legend-line--boll" />BOLL(20,2)</b>
            <b><i className="tv-cycle-chart__legend-line tv-cycle-chart__legend-line--ema" />EMA10</b>
            <b><i className="tv-cycle-chart__legend-line tv-cycle-chart__legend-line--otc" />场外 {formatMetric(latest?.otcIndex)}</b>
            <b><i className="tv-cycle-chart__legend-line tv-cycle-chart__legend-line--explosion" />爆破 {formatMetric(latest?.explosionIndex)}</b>
            <b>最近 {visibleBars || 0} 根</b>
            {hoveredMetricEvent ? (
              <b className="tv-cycle-chart__metric-time">
                指标时间 {hoveredMetricEvent.displayTime} · 场外 {formatMetric(hoveredMetricEvent.otcIndex)} · 爆破 {formatMetric(hoveredMetricEvent.explosionIndex)}
              </b>
            ) : (
              <b className="tv-cycle-chart__metric-time">{metricStatusText}</b>
            )}
          </div>
          <div className="tv-cycle-chart__workspace">
            <div className="tv-cycle-chart__plots">
              <div className="tv-cycle-chart__plot tv-cycle-chart__plot--price" ref={priceRootRef} style={{ height: priceChartHeight }}>
                <div className="tv-cycle-chart__phase-layer" ref={phaseLayerRef} />
                <div className="tv-cycle-chart__pane-label">Price / BOLL / EMA10</div>
              </div>
              <div className="tv-cycle-chart__plot tv-cycle-chart__plot--otc" ref={otcRootRef} style={{ height: indicatorChartHeight }}>
                <div className="tv-cycle-chart__pane-label">场外指数 / 1000</div>
                {showMetricEvents && hoveredMetricEvent && Number.isFinite(hoverValueLabels?.otc?.top) ? (
                  <div
                    className="tv-cycle-chart__hover-value tv-cycle-chart__hover-value--otc"
                    style={{
                      top: `${hoverValueLabels.otc.top}px`,
                      left: `${hoverValueLabels.otc.left}px`,
                    }}
                  >
                    场外 {formatMetric(hoverValueLabels.otc.value)}
                  </div>
                ) : null}
              </div>
              <div className="tv-cycle-chart__plot tv-cycle-chart__plot--explosion" ref={explosionRootRef} style={{ height: indicatorChartHeight }}>
                <div className="tv-cycle-chart__pane-label">爆破指数 / 200 / 0</div>
                {showMetricEvents && hoveredMetricEvent && Number.isFinite(hoverValueLabels?.explosion?.top) ? (
                  <div
                    className="tv-cycle-chart__hover-value tv-cycle-chart__hover-value--explosion"
                    style={{
                      top: `${hoverValueLabels.explosion.top}px`,
                      left: `${hoverValueLabels.explosion.left}px`,
                    }}
                  >
                    爆破 {formatMetric(hoverValueLabels.explosion.value)}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default OtcCycleChart;
