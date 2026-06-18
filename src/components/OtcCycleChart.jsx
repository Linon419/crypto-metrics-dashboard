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
const AUTO_LEFT_PAGE_THRESHOLD_BARS = 80;
const YAHOO_FINANCE_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const INTERVAL_SECONDS = {
  '15m': 15 * 60,
  '1h': 60 * 60,
  '4h': 4 * 60 * 60,
  '1d': 24 * 60 * 60,
};
const YAHOO_FINANCE_KLINE_SYMBOLS = new Set([
  'AAOI',
  'AAPL',
  'A_SHARES',
  'A_SHARES_INDEX',
  'AMZN',
  'AXTI',
  'BABA',
  'CIRCLE',
  'CN_AI_ETF',
  'CN_INDEX',
  'CN_ROBOT',
  'COIN',
  'ESTATE',
  'GOOG',
  'GOLD',
  'HOOD',
  'MSFT',
  'MU',
  'NASDAQ',
  'NASDAO',
  'NVDA',
  'OIL',
  'ORCL',
  'PLTR',
  'SILVER',
  'SNDK',
  'TSLA',
]);
const GREEN = '#22c55e';
const ENTRY_FIRST_DAY_MARKER = '#14b8a6';
const RED = '#ef4444';
const ORANGE = '#f59e0b';
const BLUE = '#2563eb';
const PURPLE = '#8b5cf6';
const EXPLOSION_UP = '#0891b2';
const EXPLOSION_DOWN = '#be123c';
const TEXT = '#2f3337';
const RIGHT_PRICE_SCALE_WIDTH = 72;
const ANNOTATION_TRACK_LAYOUT = [
  { key: 'otc', top: 10 },
  { key: 'explosion', top: 34 },
  { key: 'period', top: 58 },
];

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

function shouldUseYahooFinanceKlines(symbol) {
  return YAHOO_FINANCE_KLINE_SYMBOLS.has(String(symbol || '').trim().toUpperCase());
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

export function formatChartAxisTime(value) {
  const timestamp = typeof value === 'number'
    ? value * 1000
    : value?.timestamp
      ? value.timestamp * 1000
      : value?.year
        ? Date.UTC(value.year, (value.month || 1) - 1, value.day || 1)
        : null;
  const date = timestamp ? new Date(timestamp) : null;
  if (!date || Number.isNaN(date.getTime())) return '';

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
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
    const candidateTimes = [event.alignedTime, event.time]
      .map(candidate => Number(candidate))
      .filter(Number.isFinite);
    if (candidateTimes.length === 0) return best;

    const distance = Math.min(...candidateTimes.map(candidate => Math.abs(candidate - targetTime)));
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
  const { dedupeKey, ...viewMarker } = marker;
  if (seen.has(key)) {
    markers[seen.get(key)] = viewMarker;
    return;
  }
  seen.set(key, markers.length);
  markers.push(viewMarker);
}

function normalizePeriodDay(day) {
  const parsed = Number(day);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function formatMarkerMetric(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (Number.isInteger(number)) return String(number);
  return number.toFixed(2).replace(/\.?0+$/, '');
}

function getMarkerVerticalOffset(event) {
  const high = Number(event?.markerPriceAbove);
  const low = Number(event?.markerPriceBelow);
  const middle = Number(event?.markerPriceMiddle);
  const range = Number.isFinite(high) && Number.isFinite(low) && high > low
    ? high - low
    : Math.abs(middle || high || low || 1) * 0.01;

  return Math.max(range * 0.28, Math.abs(middle || low || 1) * 0.001);
}

function getEntryMarkerPrice(event, day) {
  if (day !== 1) return event.markerPriceBelow;
  return event.markerPriceBelow - getMarkerVerticalOffset(event);
}

function getExplosionSignals(previousExplosion, currentExplosion) {
  if (previousExplosion === null || currentExplosion === null) return [];

  const signals = [];
  if (previousExplosion < 200 && currentExplosion >= 200) {
    signals.push({
      type: 'up200',
      text: '▲200',
      color: EXPLOSION_UP,
      position: 'atPriceTop',
      priceKey: 'markerPriceAbove',
    });
  }
  if (previousExplosion >= 200 && currentExplosion < 200) {
    signals.push({
      type: 'down200',
      text: '▼200',
      color: EXPLOSION_DOWN,
      position: 'atPriceBottom',
      priceKey: 'markerPriceBelow',
    });
  }
  if (previousExplosion < 0 && currentExplosion > 0) {
    signals.push({
      type: 'negativeToPositive',
      text: '转正',
      color: PURPLE,
      position: 'atPriceBottom',
      priceKey: 'markerPriceBelow',
    });
  }

  return signals;
}

function buildTradingViewMarkers(metricEvents) {
  const markers = [];
  const seen = new Map();

  metricEvents.forEach((event, index) => {
    const phase = event.phase;
    const day = normalizePeriodDay(event.day);
    const currentExplosion = event.explosionIndex;
    const previousEvent = metricEvents
      .slice(0, index)
      .reverse()
      .find(item => item.explosionIndex !== null);
    const previousExplosion = previousEvent?.explosionIndex ?? null;

    if (phase === 'entry' && day !== null) {
      pushUniqueTradingViewMarker(markers, seen, {
        time: event.alignedTime,
        position: 'atPriceBottom',
        price: getEntryMarkerPrice(event, day),
        color: day === 1 ? ENTRY_FIRST_DAY_MARKER : GREEN,
        shape: day === 1 ? 'arrowUp' : 'circle',
        dedupeKey: `${event.metricDate}:entry:${day}`,
      });
    }

    if (phase === 'exit' && day !== null) {
      pushUniqueTradingViewMarker(markers, seen, {
        time: event.alignedTime,
        position: 'atPriceTop',
        price: event.markerPriceAbove,
        color: RED,
        shape: day === 1 ? 'arrowDown' : 'circle',
        dedupeKey: `${event.metricDate}:exit:${day}`,
      });
    }

    getExplosionSignals(previousExplosion, currentExplosion)
      .filter(signal => signal.type === 'up200' || signal.type === 'down200')
      .forEach((signal) => {
        pushUniqueTradingViewMarker(markers, seen, {
          time: event.alignedTime,
          position: signal.position,
          price: event[signal.priceKey],
          color: signal.color,
          shape: signal.type === 'up200' ? 'arrowUp' : 'arrowDown',
          dedupeKey: `${event.alignedTime}:explosion:${signal.type}`,
        });
      });
  });

  return markers;
}

function pushTrackLabel(trackMap, label) {
  trackMap.set(label.time, label);
}

function pushExplosionTrackLabel(trackMap, label) {
  const existing = trackMap.get(label.time);
  if (!existing) {
    trackMap.set(label.time, label);
    return;
  }

  const parts = existing.text.split('/');
  if (!parts.includes(label.text)) parts.push(label.text);
  trackMap.set(label.time, {
    ...existing,
    text: parts.join('/'),
    color: parts.includes('转正') ? PURPLE : label.color,
    sourceTime: Math.max(existing.sourceTime || 0, label.sourceTime || 0),
  });
}

function pushOtcTrackLabel(trackMap, event) {
  const otcValue = formatMarkerMetric(event?.otcIndex);
  if (otcValue === null) return;

  pushTrackLabel(trackMap, {
    id: `otc-${event.alignedTime}`,
    time: event.alignedTime,
    sourceTime: event.publishedTime,
    text: `场外${otcValue}`,
    color: BLUE,
  });
}

function toSortedTrack(trackMap) {
  return Array.from(trackMap.values()).sort((left, right) => (
    left.time - right.time || (left.sourceTime || 0) - (right.sourceTime || 0)
  ));
}

function buildAnnotationTracks(metricEvents) {
  const period = new Map();
  const explosion = new Map();
  const otc = new Map();

  metricEvents.forEach((event, index) => {
    const day = normalizePeriodDay(event.day);
    const currentExplosion = event.explosionIndex;
    const previousEvent = metricEvents
      .slice(0, index)
      .reverse()
      .find(item => item.explosionIndex !== null);
    const previousExplosion = previousEvent?.explosionIndex ?? null;
    const phaseText = event.phase === 'entry' ? '进' : event.phase === 'exit' ? '退' : null;

    if (phaseText && day !== null) {
      pushTrackLabel(period, {
        id: `period-${event.alignedTime}`,
        time: event.alignedTime,
        sourceTime: event.publishedTime,
        text: `${phaseText}${day}`,
        color: event.phase === 'entry' ? GREEN : RED,
      });
      if (day === 1) pushOtcTrackLabel(otc, event);
    }

    getExplosionSignals(previousExplosion, currentExplosion).forEach((signal) => {
      pushExplosionTrackLabel(explosion, {
        id: `explosion-${event.alignedTime}-${signal.type}`,
        time: event.alignedTime,
        sourceTime: event.publishedTime,
        text: signal.text,
        color: signal.color,
      });
      pushOtcTrackLabel(otc, event);
    });
  });

  return {
    otc: toSortedTrack(otc),
    explosion: toSortedTrack(explosion),
    period: toSortedTrack(period),
  };
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
    annotationTracks: buildAnnotationTracks(metricEvents),
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

function createBaseChart(container, height, showTimeScale = false, showAttribution = false, priceScaleMargins = null) {
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
    localization: {
      timeFormatter: formatChartAxisTime,
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
      scaleMargins: priceScaleMargins || { top: 0.1, bottom: 0.12 },
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

function buildPositionedAnnotationLabels(annotationTracks = {}, chartWidth = 800, timeToX = () => null) {
  if (chartWidth <= 0) return [];

  const positioned = [];
  const maxX = Math.max(40, chartWidth - RIGHT_PRICE_SCALE_WIDTH - 24);

  ANNOTATION_TRACK_LAYOUT.forEach((track) => {
    const labels = annotationTracks?.[track.key] || [];
    let lastRight = -Infinity;

    labels.forEach((label) => {
      const coordinate = Number(timeToX(label.time));
      if (!Number.isFinite(coordinate) || coordinate < -80 || coordinate > chartWidth + 80) return;

      const safeX = Math.max(36, Math.min(maxX, coordinate));
      const estimatedWidth = Math.max(34, label.text.length * 8 + 14);
      const leftEdge = safeX - estimatedWidth / 2;
      const rightEdge = safeX + estimatedWidth / 2;
      if (leftEdge < lastRight + 6) return;
      lastRight = rightEdge;

      positioned.push({
        ...label,
        id: `${track.key}-${label.id}-${label.text}`,
        track: track.key,
        left: safeX,
        top: track.top,
      });
    });
  });

  return positioned;
}

function buildFallbackAnnotationLabels(annotationTracks = {}, rows = [], visibleBars = 0, chartWidth = 800) {
  const range = buildReviewVisibleTimeRange(rows, visibleBars);
  if (!range) return [];

  const plotWidth = Math.max(1, chartWidth - RIGHT_PRICE_SCALE_WIDTH - 72);
  const span = Math.max(1, range.to - range.from);
  return buildPositionedAnnotationLabels(annotationTracks, chartWidth, (time) => {
    if (time < range.from || time > range.to) return null;
    return 36 + ((time - range.from) / span) * plotWidth;
  });
}

function syncTimeRange(targets, syncingRef, onRangeChange) {
  return (range) => {
    if (!range) return;
    onRangeChange?.(range);
    if (syncingRef.current) return;
    syncingRef.current = true;
    targets.forEach((chart) => {
      chart.timeScale().setVisibleRange(range);
    });
    syncingRef.current = false;
  };
}

function parseDateBoundaryMs(value, boundary = 'start') {
  if (!value) return null;
  const normalizedValue = String(value);
  const dateText = normalizedValue.includes('T')
    ? normalizedValue
    : `${normalizedValue}${boundary === 'end' ? 'T23:59:59.999Z' : 'T00:00:00.000Z'}`;
  const timestamp = new Date(dateText).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function calculateDateRangeKlineLimit({
  interval,
  startDate,
  endDate,
  fallbackLimit = 365,
} = {}) {
  const baseLimit = Math.min(
    LEFT_EXPAND_LIMIT,
    Math.max(1, Math.floor(Number(fallbackLimit)) || 365),
  );
  const startMs = parseDateBoundaryMs(startDate, 'start');
  const endMs = parseDateBoundaryMs(endDate, 'end');
  if (startMs === null || endMs === null || endMs <= startMs) {
    return baseLimit;
  }

  const intervalMs = (INTERVAL_SECONDS[interval] || INTERVAL_SECONDS['1d']) * 1000;
  const estimatedBars = Math.ceil((endMs - startMs) / intervalMs) + 2;
  return Math.min(LEFT_EXPAND_LIMIT, Math.max(baseLimit, estimatedBars));
}

function shouldUsePagedDateRangeKlines({
  interval,
  startDate,
  endDate,
} = {}) {
  const startMs = parseDateBoundaryMs(startDate, 'start');
  const endMs = parseDateBoundaryMs(endDate, 'end');
  if (startMs === null || endMs === null || endMs <= startMs) return false;

  const intervalMs = (INTERVAL_SECONDS[interval] || INTERVAL_SECONDS['1d']) * 1000;
  const estimatedBars = Math.ceil((endMs - startMs) / intervalMs) + 2;
  return estimatedBars > LEFT_EXPAND_LIMIT;
}

function OtcCycleChart({
  symbol = 'BTC',
  startDate,
  endDate,
  useLatestKlineWindow = false,
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
  const [hoverAxisLabel, setHoverAxisLabel] = useState(null);
  const [annotationLabels, setAnnotationLabels] = useState([]);
  const priceRootRef = useRef(null);
  const otcRootRef = useRef(null);
  const explosionRootRef = useRef(null);
  const phaseLayerRef = useRef(null);
  const syncingRef = useRef(false);
  const chartsRef = useRef([]);
  const manualVisibleRangeRef = useRef(null);
  const loadingOlderRef = useRef(false);
  const hasMoreLeftRef = useRef(true);
  const [hasMoreLeft, setHasMoreLeft] = useState(true);

  const selectedPeriod = CHART_PERIODS.find(period => period.value === interval) || CHART_PERIODS[0];
  const isYahooFinanceSource = shouldUseYahooFinanceKlines(normalizedSymbol);
  const updateHasMoreLeft = useCallback((value) => {
    hasMoreLeftRef.current = value;
    setHasMoreLeft(value);
  }, []);

  const loadChartData = useCallback(async ({ refresh = false, silent = false } = {}) => {
    if (!silent) setLoading(true);
    if (!silent) {
      manualVisibleRangeRef.current = null;
      updateHasMoreLeft(true);
    }
    setError(null);
    try {
      const shouldPageDateRange = !useLatestKlineWindow && shouldUsePagedDateRangeKlines({
        interval: selectedPeriod.value,
        startDate,
        endDate,
      });
      const klineLimit = useLatestKlineWindow
        ? selectedPeriod.limit
        : shouldPageDateRange
          ? LEFT_EXPAND_LIMIT
          : calculateDateRangeKlineLimit({
          interval: selectedPeriod.value,
          startDate,
          endDate,
          fallbackLimit: selectedPeriod.limit,
        });
      const klineRequest = {
        interval: selectedPeriod.value,
        limit: klineLimit,
        refresh,
      };
      if (!useLatestKlineWindow && !shouldPageDateRange && startDate) {
        klineRequest.startTime = new Date(startDate).getTime();
      }
      if (!useLatestKlineWindow && endDate) {
        klineRequest.endTime = new Date(`${endDate}T23:59:59.999Z`).getTime();
      }
      const klineResult = await fetchCoinKlines(symbol, klineRequest);
      const klineRange = getKlineDateRange(klineResult?.klines || []);
      const metricResult = await fetchCoinMetrics(symbol, {
        startDate: klineRange?.startDate || startDate,
        endDate: endDate || klineRange?.endDate,
      });
      setKlines(klineResult?.klines || []);
      setMetrics(Array.isArray(metricResult) ? metricResult : []);
    } catch (err) {
      setError(err.message || '新版场外周期图加载失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [endDate, selectedPeriod.limit, selectedPeriod.value, startDate, symbol, updateHasMoreLeft, useLatestKlineWindow]);

  useEffect(() => {
    loadChartData();
  }, [loadChartData]);

  useEffect(() => {
    manualVisibleRangeRef.current = null;
    loadingOlderRef.current = false;
    updateHasMoreLeft(true);
  }, [interval, startDate, symbol, updateHasMoreLeft]);

  useEffect(() => {
    if (!isYahooFinanceSource) return () => {};

    const timer = window.setInterval(() => {
      loadChartData({ refresh: true, silent: true });
    }, YAHOO_FINANCE_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [isYahooFinanceSource, loadChartData]);

  const loadOlderKlines = useCallback(async () => {
    if (loadingOlderRef.current || expandingLeft || klines.length === 0 || !hasMoreLeftRef.current) return;

    const earliestOpenTime = klines.reduce((earliest, kline) => {
      const openTime = new Date(kline.openTime).getTime();
      return Number.isFinite(openTime) && openTime < earliest ? openTime : earliest;
    }, Infinity);

    if (!Number.isFinite(earliestOpenTime)) return;
    const lowerBoundary = !useLatestKlineWindow ? parseDateBoundaryMs(startDate, 'start') : null;
    if (lowerBoundary !== null && earliestOpenTime <= lowerBoundary) {
      updateHasMoreLeft(false);
      return;
    }

    loadingOlderRef.current = true;
    setExpandingLeft(true);
    setError(null);
    try {
      const result = await fetchCoinKlines(symbol, {
        interval: selectedPeriod.value,
        limit: LEFT_EXPAND_LIMIT,
        refresh: true,
        endTime: earliestOpenTime - 1,
      });
      const incomingKlines = (result?.klines || []).filter((kline) => {
        if (lowerBoundary === null) return true;
        const openTime = new Date(kline.openTime).getTime();
        return Number.isFinite(openTime) && openTime >= lowerBoundary;
      });
      const hasIncomingOlderKlines = incomingKlines.some((kline) => {
        const openTime = new Date(kline.openTime).getTime();
        return Number.isFinite(openTime) && openTime < earliestOpenTime;
      });
      if (!hasIncomingOlderKlines) {
        updateHasMoreLeft(false);
        return;
      }

      const expandedKlines = mergeKlinesByOpenTime(klines, incomingKlines);
      const expandedRange = getKlineDateRange(expandedKlines);
      const newEarliestOpenTime = expandedKlines.reduce((earliest, kline) => {
        const openTime = new Date(kline.openTime).getTime();
        return Number.isFinite(openTime) && openTime < earliest ? openTime : earliest;
      }, earliestOpenTime);
      if (lowerBoundary !== null && newEarliestOpenTime <= lowerBoundary) {
        updateHasMoreLeft(false);
      }
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
      loadingOlderRef.current = false;
      setExpandingLeft(false);
    }
  }, [endDate, expandingLeft, klines, selectedPeriod.value, startDate, symbol, updateHasMoreLeft, useLatestKlineWindow]);

  useEffect(() => {
    if (normalizedSymbol === 'VEGA' || isYahooFinanceSource) return () => {};

    return subscribeCoinKlineStream(symbol, {
      interval: selectedPeriod.value,
      onMessage: (message) => {
        if (
          message?.interval !== selectedPeriod.value ||
          !message?.kline?.openTime ||
          message.isClosed !== true
        ) return;
        setKlines(current => mergeKlinesByOpenTime(current, [message.kline]));
      },
      onError: (event) => {
        const message = event?.message || '实时K线连接异常';
        console.warn('[OtcCycleChart] live kline stream error:', message);
      },
    });
  }, [isYahooFinanceSource, normalizedSymbol, selectedPeriod.value, symbol]);

  const model = useMemo(
    () => buildTradingViewCycleModel({ klines, metrics }),
    [klines, metrics],
  );
  const visibleBars = getReviewVisibleBars(interval, model.rows.length);
  const priceChartHeight = Math.max(430, Math.round((height - 86) * 0.66));
  const indicatorChartHeight = Math.max(128, Math.round((height - 86) * 0.17));
  const hoverSnapSeconds = Math.max(60, Math.round(getMedianRowTimeGap(model.rows) * 1.5));
  const fallbackAnnotationLabels = useMemo(
    () => (showMetricEvents
      ? buildFallbackAnnotationLabels(model.annotationTracks, model.rows, visibleBars)
      : []),
    [model.annotationTracks, model.rows, showMetricEvents, visibleBars],
  );
  const renderedAnnotationLabels = annotationLabels.length > 0
    ? annotationLabels
    : fallbackAnnotationLabels;

  useEffect(() => {
    if (!priceRootRef.current || !otcRootRef.current || !explosionRootRef.current || model.rows.length === 0) {
      setAnnotationLabels([]);
      return undefined;
    }

    const priceChart = createBaseChart(priceRootRef.current, priceChartHeight, false, true, { top: 0.22, bottom: 0.08 });
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
    if (showMetricEvents) {
      createSeriesMarkers(candleSeries, model.markers, { zOrder: 'top' });
    }

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
    chartsRef.current = charts;
    const initialRange = manualVisibleRangeRef.current;
    if (initialRange) {
      charts.forEach((chart) => {
        chart.timeScale().setVisibleRange(initialRange);
      });
    } else {
      applyReviewRange(charts, model.rows, visibleBars, model.metricEvents);
    }

    const updateMetricHover = (param) => {
      const axisText = formatChartAxisTime(param?.time);
      const axisX = toFiniteCoordinate(param?.point?.x);
      if (axisText && axisX !== null) {
        const axisWidth = explosionRootRef.current?.clientWidth || priceRootRef.current?.clientWidth || 800;
        const left = Math.max(54, Math.min(axisWidth - RIGHT_PRICE_SCALE_WIDTH - 56, axisX));
        setHoverAxisLabel({ text: axisText, left });
      } else {
        setHoverAxisLabel(null);
      }

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

    const rememberVisibleRange = (range) => {
      if (!range) return;
      const from = Number(range.from);
      const to = Number(range.to);
      if (Number.isFinite(from) && Number.isFinite(to)) {
        manualVisibleRangeRef.current = { from, to };
      }
    };
    const maybeLoadOlderFromVisibleRange = (range) => {
      rememberVisibleRange(range);
      if (
        !range ||
        loading ||
        loadingOlderRef.current ||
        !hasMoreLeftRef.current ||
        model.rows.length === 0
      ) return;

      const from = Number(range.from);
      const earliestTime = model.rows[0].time;
      if (!Number.isFinite(from) || !Number.isFinite(earliestTime)) return;

      const lowerBoundary = !useLatestKlineWindow ? parseDateBoundaryMs(startDate, 'start') : null;
      if (lowerBoundary !== null && earliestTime * 1000 <= lowerBoundary) {
        updateHasMoreLeft(false);
        return;
      }

      const thresholdSeconds = getMedianRowTimeGap(model.rows) * AUTO_LEFT_PAGE_THRESHOLD_BARS;
      if (from <= earliestTime + thresholdSeconds) {
        loadOlderKlines();
      }
    };

    const priceSync = syncTimeRange([otcChart, explosionChart], syncingRef, rememberVisibleRange);
    const otcSync = syncTimeRange([priceChart, explosionChart], syncingRef, rememberVisibleRange);
    const explosionSync = syncTimeRange([priceChart, otcChart], syncingRef, rememberVisibleRange);
    priceChart.timeScale().subscribeVisibleTimeRangeChange(priceSync);
    priceChart.timeScale().subscribeVisibleTimeRangeChange(maybeLoadOlderFromVisibleRange);
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

    const updateAnnotationLayer = () => {
      const chartWidth = priceRootRef.current?.clientWidth || 800;
      if (!showMetricEvents || chartWidth <= 0) {
        setAnnotationLabels([]);
        return;
      }

      setAnnotationLabels(buildPositionedAnnotationLabels(
        model.annotationTracks,
        chartWidth,
        time => priceChart.timeScale().timeToCoordinate(time),
      ));
    };

    priceChart.timeScale().subscribeVisibleTimeRangeChange(updatePhaseLayer);
    priceChart.timeScale().subscribeVisibleTimeRangeChange(updateAnnotationLayer);
    updatePhaseLayer();
    updateAnnotationLayer();

    const resize = () => {
      const priceWidth = priceRootRef.current?.clientWidth || 800;
      const otcWidth = otcRootRef.current?.clientWidth || priceWidth;
      const explosionWidth = explosionRootRef.current?.clientWidth || priceWidth;
      priceChart.applyOptions({ width: priceWidth, height: priceChartHeight });
      otcChart.applyOptions({ width: otcWidth, height: indicatorChartHeight });
      explosionChart.applyOptions({ width: explosionWidth, height: indicatorChartHeight });
      const manualRange = manualVisibleRangeRef.current;
      if (manualRange) {
        charts.forEach((chart) => {
          chart.timeScale().setVisibleRange(manualRange);
        });
      } else {
        applyReviewRange(charts, model.rows, visibleBars, model.metricEvents);
      }
      updatePhaseLayer();
      updateAnnotationLayer();
    };

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    [priceRootRef.current, otcRootRef.current, explosionRootRef.current].forEach((node) => {
      if (node && observer) observer.observe(node);
    });
    window.addEventListener('resize', resize);

    return () => {
      priceChart.timeScale().unsubscribeVisibleTimeRangeChange(priceSync);
      priceChart.timeScale().unsubscribeVisibleTimeRangeChange(maybeLoadOlderFromVisibleRange);
      priceChart.timeScale().unsubscribeVisibleTimeRangeChange(updatePhaseLayer);
      priceChart.timeScale().unsubscribeVisibleTimeRangeChange(updateAnnotationLayer);
      priceChart.unsubscribeCrosshairMove(updateMetricHover);
      otcChart.timeScale().unsubscribeVisibleTimeRangeChange(otcSync);
      otcChart.unsubscribeCrosshairMove(updateMetricHover);
      explosionChart.timeScale().unsubscribeVisibleTimeRangeChange(explosionSync);
      explosionChart.unsubscribeCrosshairMove(updateMetricHover);
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      charts.forEach(chart => chart.remove());
      chartsRef.current = [];
      if (phaseLayer) phaseLayer.innerHTML = '';
      setHoverValueLabels(null);
      setHoverAxisLabel(null);
    };
  }, [hoverSnapSeconds, indicatorChartHeight, loadOlderKlines, loading, model, priceChartHeight, showMetricEvents, startDate, symbol, updateHasMoreLeft, useLatestKlineWindow, visibleBars]);

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
            disabled={loading || klines.length === 0 || !hasMoreLeft}
            onClick={loadOlderKlines}
          >
            {hasMoreLeft ? '向左扩展 1500 根' : '已到最早K线'}
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
                <div className="tv-cycle-chart__annotation-layer">
                  {renderedAnnotationLabels.map(label => (
                    <div
                      key={label.id}
                      className={`tv-cycle-chart__annotation-label tv-cycle-chart__annotation-label--${label.track}`}
                      style={{
                        left: `${label.left}px`,
                        top: `${label.top}px`,
                        color: label.color,
                        borderColor: `${label.color}33`,
                        background: `${label.color}10`,
                      }}
                    >
                      {label.text}
                    </div>
                  ))}
                </div>
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
                {hoverAxisLabel ? (
                  <div
                    className="tv-cycle-chart__axis-time-label"
                    style={{ left: `${hoverAxisLabel.left}px` }}
                  >
                    {hoverAxisLabel.text}
                  </div>
                ) : null}
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
