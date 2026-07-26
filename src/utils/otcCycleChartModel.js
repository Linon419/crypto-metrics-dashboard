// src/utils/otcCycleChartModel.js
// OtcCycleChart 的图表模型构建：K线/指标对齐、周期相位、标记与注释轨道、
// 布林带、TradingView 基础图配置。从组件文件拆出，逻辑未改动。
import { ColorType, CrosshairMode, createChart } from 'lightweight-charts';

// 15m 已停止采集：打开该周期会触发按需补库与实时流写入，是 K 线库膨胀的主因。
// 未知周期会回落到 CHART_PERIODS[0]，因此移除该项不会影响历史选择状态。
const CHART_PERIODS = [
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

/**
 * 判断当前数据源是否为 Yahoo Finance。
 *
 * 优先信任已加载 K 线上报的 market 字段：美股映射可能已被
 * 「美股优先币安」切到 binance_usdm_perpetual，静态符号表只作为
 * 数据未到达时的初始猜测。
 */
function resolveIsYahooFinanceSource(symbol, klines) {
  const market = Array.isArray(klines)
    ? klines.find(kline => kline?.market)?.market
    : null;
  if (market) return market === 'yahoo_finance';
  return shouldUseYahooFinanceKlines(symbol);
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
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
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

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/**
 * X 轴刻度按浏览器本地时区格式化。
 *
 * lightweight-charts 默认按 UTC 渲染刻度标签，而十字线悬浮
 * （localization.timeFormatter → formatChartAxisTime）是本地时区，
 * 1h/4h 图上两者会相差整个时区偏移。
 * tickMarkType（未导入枚举，避免测试 mock 缺符号）：
 * 0=年 1=月 2=日 3=时分 4=时分秒
 */
export function formatChartTickMark(time, tickMarkType) {
  const timestamp = typeof time === 'number'
    ? time * 1000
    : time?.timestamp
      ? time.timestamp * 1000
      : time?.year
        ? Date.UTC(time.year, (time.month || 1) - 1, time.day || 1)
        : null;
  const date = timestamp ? new Date(timestamp) : null;
  if (!date || Number.isNaN(date.getTime())) return '';

  if (tickMarkType === 0) return String(date.getFullYear());
  if (tickMarkType === 1) return `${date.getMonth() + 1}月`;
  if (tickMarkType === 2) return String(date.getDate());
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${hour}:${minute}`;
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
      // 刻度默认按 UTC 渲染，与十字线的本地时间不一致，按浏览器时区重写
      tickMarkFormatter: formatChartTickMark,
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


export {
  AUTO_LEFT_PAGE_THRESHOLD_BARS,
  BLUE,
  CHART_PERIODS,
  DEFAULT_CHART_INTERVAL,
  GREEN,
  LEFT_EXPAND_LIMIT,
  ORANGE,
  PURPLE,
  RED,
  RIGHT_PRICE_SCALE_WIDTH,
  YAHOO_FINANCE_REFRESH_INTERVAL_MS,
  applyReviewRange,
  buildFallbackAnnotationLabels,
  buildPositionedAnnotationLabels,
  createBaseChart,
  formatMetric,
  formatPrice,
  getKlineDateRange,
  getMedianRowTimeGap,
  getReviewVisibleBars,
  parseDateBoundaryMs,
  shouldUsePagedDateRangeKlines,
  resolveIsYahooFinanceSource,
  shouldUseYahooFinanceKlines,
  syncTimeRange,
  toFiniteCoordinate,
};
