// src/components/OtcCycleChart.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  LineSeries,
  LineStyle,
  createSeriesMarkers,
} from 'lightweight-charts';
import { Alert, Button, Segmented, Spin, Switch, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { fetchCoinKlines, fetchCoinMetrics, subscribeCoinKlineStream } from '../services/api';
import {
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
  buildPriceFormat,
  buildFallbackAnnotationLabels,
  buildMetricHoverValueLabels,
  buildPositionedAnnotationLabels,
  buildTradingViewCycleModel,
  calculateDateRangeKlineLimit,
  createBaseChart,
  findNearestMetricEventForTime,
  formatChartAxisTime,
  formatMetric,
  formatPrice,
  getKlineDateRange,
  getMedianRowTimeGap,
  getReviewVisibleBars,
  mergeKlinesByOpenTime,
  mergeMetricsByVersion,
  parseLocalDateBoundaryMs,
  shouldUsePagedDateRangeKlines,
  resolveIsYahooFinanceSource,
  syncTimeRange,
  toFiniteCoordinate,
} from '../utils/otcCycleChartModel';

const { Text } = Typography;

// 切币期间用同一个空数组引用，避免下游 useMemo 因为新数组白跑一次
const EMPTY_KLINES = [];

// 图表模型构建逻辑位于 utils/otcCycleChartModel；此处再导出测试所需的纯函数
export {
  buildMetricHoverValueLabels,
  buildOtcCycleChartOption,
  buildReviewVisibleTimeRange,
  buildSynchronizedVisibleTimeRange,
  buildTradingViewCycleModel,
  calculateDateRangeKlineLimit,
  findNearestMetricEventForTime,
  formatChartAxisTime,
  mergeKlinesByOpenTime,
  mergeMetricsByVersion,
} from '../utils/otcCycleChartModel';

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
  // K 线与所属 symbol 一起保存：切币时立即作废，避免用上一个币的 market 判断数据源
  const [klineState, setKlineState] = useState({ symbol: normalizedSymbol, klines: EMPTY_KLINES });
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandingLeft, setExpandingLeft] = useState(false);
  const [error, setError] = useState(null);
  const [showMetricEvents, setShowMetricEvents] = useState(true);
  const [includePrePostState, setIncludePrePostState] = useState({
    symbol: normalizedSymbol,
    value: false,
  });
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
  const chartHandlesRef = useRef(null);
  const chartContextRef = useRef({});
  const manualVisibleRangeRef = useRef(null);
  const loadingOlderRef = useRef(false);
  const hasMoreLeftRef = useRef(true);
  const loadRequestSeqRef = useRef(0);
  const [hasMoreLeft, setHasMoreLeft] = useState(true);

  const klines = klineState.symbol === normalizedSymbol ? klineState.klines : EMPTY_KLINES;
  const setKlines = useCallback((updater) => {
    setKlineState((current) => {
      const base = current.symbol === normalizedSymbol ? current.klines : EMPTY_KLINES;
      return {
        symbol: normalizedSymbol,
        klines: typeof updater === 'function' ? updater(base) : updater,
      };
    });
  }, [normalizedSymbol]);

  const selectedPeriod = CHART_PERIODS.find(period => period.value === interval) || CHART_PERIODS[0];
  // 优先信任已加载 K 线上报的 market：映射可能已切到币安，静态表只是初始猜测
  const isYahooFinanceSource = resolveIsYahooFinanceSource(normalizedSymbol, klines);
  const includePrePost = includePrePostState.symbol === normalizedSymbol
    ? includePrePostState.value
    : false;
  const handleIncludePrePostChange = useCallback((checked) => {
    setIncludePrePostState({
      symbol: normalizedSymbol,
      value: checked,
    });
  }, [normalizedSymbol]);
  const updateHasMoreLeft = useCallback((value) => {
    hasMoreLeftRef.current = value;
    setHasMoreLeft(value);
  }, []);

  const loadChartData = useCallback(async ({ refresh = false, silent = false } = {}) => {
    // 快速切换周期/日期时，只有最后一次请求可以写入状态
    const requestSeq = loadRequestSeqRef.current + 1;
    loadRequestSeqRef.current = requestSeq;
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
      if (isYahooFinanceSource) {
        klineRequest.includePrePost = includePrePost;
        if (includePrePost) {
          klineRequest.refresh = true;
        }
      }
      // 区间按本地时区锚定，和轴刻度保持一致
      if (!useLatestKlineWindow && !shouldPageDateRange && startDate) {
        const startTime = parseLocalDateBoundaryMs(startDate, 'start');
        if (startTime !== null) klineRequest.startTime = startTime;
      }
      if (!useLatestKlineWindow && endDate) {
        const endTime = parseLocalDateBoundaryMs(endDate, 'end');
        if (endTime !== null) klineRequest.endTime = endTime;
      }
      const klineResult = await fetchCoinKlines(symbol, klineRequest);
      if (loadRequestSeqRef.current !== requestSeq) return;
      const klineRange = getKlineDateRange(klineResult?.klines || []);
      const metricResult = await fetchCoinMetrics(symbol, {
        startDate: klineRange?.startDate || startDate,
        endDate: endDate || klineRange?.endDate,
      });
      if (loadRequestSeqRef.current !== requestSeq) return;
      setKlines(klineResult?.klines || []);
      setMetrics(Array.isArray(metricResult) ? metricResult : []);
    } catch (err) {
      if (loadRequestSeqRef.current !== requestSeq) return;
      setError(err.message || '新版场外周期图加载失败');
    } finally {
      if (!silent && loadRequestSeqRef.current === requestSeq) setLoading(false);
    }
  }, [endDate, includePrePost, isYahooFinanceSource, selectedPeriod.limit, selectedPeriod.value, setKlines, startDate, symbol, updateHasMoreLeft, useLatestKlineWindow]);

  useEffect(() => {
    loadChartData();
  }, [loadChartData]);

  useEffect(() => {
    manualVisibleRangeRef.current = null;
    loadingOlderRef.current = false;
    updateHasMoreLeft(true);
  }, [includePrePost, interval, startDate, symbol, updateHasMoreLeft]);

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
    const lowerBoundary = !useLatestKlineWindow ? parseLocalDateBoundaryMs(startDate, 'start') : null;
    if (lowerBoundary !== null && earliestOpenTime <= lowerBoundary) {
      updateHasMoreLeft(false);
      return;
    }

    loadingOlderRef.current = true;
    setExpandingLeft(true);
    setError(null);
    try {
      const request = {
        interval: selectedPeriod.value,
        limit: LEFT_EXPAND_LIMIT,
        endTime: earliestOpenTime - 1,
      };
      if (isYahooFinanceSource) {
        request.includePrePost = includePrePost;
      }
      const result = await fetchCoinKlines(symbol, request);
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
  }, [endDate, expandingLeft, includePrePost, isYahooFinanceSource, klines, selectedPeriod.value, setKlines, startDate, symbol, updateHasMoreLeft, useLatestKlineWindow]);

  useEffect(() => {
    if (normalizedSymbol === 'VEGA' || isYahooFinanceSource) return () => {};

    return subscribeCoinKlineStream(symbol, {
      interval: selectedPeriod.value,
      onMessage: (message) => {
        if (
          message?.interval !== selectedPeriod.value ||
          !message?.kline?.openTime
        ) return;
        setKlines(current => mergeKlinesByOpenTime(current, [message.kline]));
      },
      onError: (event) => {
        const message = event?.message || '实时K线连接异常';
        console.warn('[OtcCycleChart] live kline stream error:', message);
      },
    });
  }, [isYahooFinanceSource, normalizedSymbol, selectedPeriod.value, setKlines, symbol]);

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
  const hasChartRows = model.rows.length > 0;

  // 图表实例只在容器/尺寸变化时创建一次；下面注册的回调统一从这个 ref 读取最新渲染值，
  // 这样实时K线每 250ms 推送一次也不会把三个图表销毁重建。
  chartContextRef.current = {
    hoverSnapSeconds,
    loadOlderKlines,
    loading,
    model,
    showMetricEvents,
    startDate,
    useLatestKlineWindow,
    visibleBars,
  };

  useEffect(() => {
    if (!priceRootRef.current || !otcRootRef.current || !explosionRootRef.current || !hasChartRows) {
      setAnnotationLabels([]);
      return undefined;
    }

    const priceChart = createBaseChart(priceRootRef.current, priceChartHeight, false, true, { top: 0.22, bottom: 0.08 });
    const otcChart = createBaseChart(otcRootRef.current, indicatorChartHeight, false);
    const explosionChart = createBaseChart(explosionRootRef.current, indicatorChartHeight, true);
    const phaseLayer = phaseLayerRef.current;
    const priceFormat = buildPriceFormat(chartContextRef.current.model.latest?.close);

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
      priceFormat,
    });

    const bollUpperSeries = priceChart.addSeries(LineSeries, {
      color: '#64748b',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat,
    });

    const bollMiddleSeries = priceChart.addSeries(LineSeries, {
      color: ORANGE,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat,
    });

    const bollLowerSeries = priceChart.addSeries(LineSeries, {
      color: '#64748b',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat,
    });

    const otcSeries = otcChart.addSeries(LineSeries, {
      color: BLUE,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const explosionSeries = explosionChart.addSeries(LineSeries, {
      color: PURPLE,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // 固定阈值线与数据无关，只创建一次
    otcSeries.createPriceLine({
      price: 1000,
      color: ORANGE,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: '1000',
    });
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

    const candleMarkers = createSeriesMarkers(candleSeries, [], { zOrder: 'top' });
    const otcMarkers = createSeriesMarkers(otcSeries, [], { zOrder: 'top' });
    const explosionMarkers = createSeriesMarkers(explosionSeries, [], { zOrder: 'top' });

    const charts = [priceChart, otcChart, explosionChart];
    chartsRef.current = charts;

    const updateMetricHover = (param) => {
      const context = chartContextRef.current;
      const axisText = formatChartAxisTime(param?.time);
      const axisX = toFiniteCoordinate(param?.point?.x);
      if (axisText && axisX !== null) {
        const axisWidth = explosionRootRef.current?.clientWidth || priceRootRef.current?.clientWidth || 800;
        const left = Math.max(54, Math.min(axisWidth - RIGHT_PRICE_SCALE_WIDTH - 56, axisX));
        setHoverAxisLabel({ text: axisText, left });
      } else {
        setHoverAxisLabel(null);
      }

      const event = findNearestMetricEventForTime(
        context.model.metricEvents,
        param?.time,
        context.hoverSnapSeconds,
      );
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
      const context = chartContextRef.current;
      rememberVisibleRange(range);
      if (
        !range ||
        context.loading ||
        loadingOlderRef.current ||
        !hasMoreLeftRef.current ||
        context.model.rows.length === 0
      ) return;

      const from = Number(range.from);
      const earliestTime = context.model.rows[0].time;
      if (!Number.isFinite(from) || !Number.isFinite(earliestTime)) return;

      const lowerBoundary = !context.useLatestKlineWindow
        ? parseLocalDateBoundaryMs(context.startDate, 'start')
        : null;
      if (lowerBoundary !== null && earliestTime * 1000 <= lowerBoundary) {
        updateHasMoreLeft(false);
        return;
      }

      const thresholdSeconds = getMedianRowTimeGap(context.model.rows) * AUTO_LEFT_PAGE_THRESHOLD_BARS;
      if (from <= earliestTime + thresholdSeconds) {
        context.loadOlderKlines();
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
      const { model: currentModel } = chartContextRef.current;
      const layer = phaseLayer;
      if (!layer) return;
      const chartWidth = priceRootRef.current?.clientWidth || 0;
      layer.innerHTML = '';
      if (chartWidth <= 0) return;

      const coordinates = currentModel.rows
        .map(row => priceChart.timeScale().timeToCoordinate(row.time))
        .filter(value => value !== null)
        .sort((left, right) => left - right);
      const gaps = coordinates
        .slice(1)
        .map((coordinate, index) => coordinate - coordinates[index])
        .filter(gap => gap > 0);
      const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 8;
      const barHalfWidth = Math.max(4, Math.min(36, medianGap / 2));

      currentModel.phaseRanges.forEach((range) => {
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
      const { model: currentModel, showMetricEvents: showEvents } = chartContextRef.current;
      const chartWidth = priceRootRef.current?.clientWidth || 800;
      if (!showEvents || chartWidth <= 0) {
        setAnnotationLabels([]);
        return;
      }

      setAnnotationLabels(buildPositionedAnnotationLabels(
        currentModel.annotationTracks,
        chartWidth,
        time => priceChart.timeScale().timeToCoordinate(time),
      ));
    };

    priceChart.timeScale().subscribeVisibleTimeRangeChange(updatePhaseLayer);
    priceChart.timeScale().subscribeVisibleTimeRangeChange(updateAnnotationLayer);

    const resize = () => {
      const context = chartContextRef.current;
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
        applyReviewRange(charts, context.model.rows, context.visibleBars, context.model.metricEvents);
      }
      updatePhaseLayer();
      updateAnnotationLayer();
    };

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    [priceRootRef.current, otcRootRef.current, explosionRootRef.current].forEach((node) => {
      if (node && observer) observer.observe(node);
    });
    window.addEventListener('resize', resize);

    chartHandlesRef.current = {
      bollLowerSeries,
      bollMiddleSeries,
      bollUpperSeries,
      candleMarkers,
      candleSeries,
      charts,
      explosionMarkers,
      explosionSeries,
      otcMarkers,
      otcSeries,
      updateAnnotationLayer,
      updatePhaseLayer,
    };

    return () => {
      chartHandlesRef.current = null;
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
  }, [hasChartRows, indicatorChartHeight, priceChartHeight, updateHasMoreLeft]);

  // 数据更新只走 setData / setMarkers，不重建图表实例
  useEffect(() => {
    const handles = chartHandlesRef.current;
    if (!handles) return undefined;

    // 六个 series 依次写入时，前一个图表会先触发可视区间事件。
    // 初始化期间暂停跨图同步，等三张图都有数据后再统一应用复盘区间。
    syncingRef.current = true;
    try {
      handles.candleSeries.setData(model.candles);
      handles.bollUpperSeries.setData(model.boll.upper);
      handles.bollMiddleSeries.setData(model.boll.middle);
      handles.bollLowerSeries.setData(model.boll.lower);
      handles.otcSeries.setData(model.otcIndex);
      handles.explosionSeries.setData(model.explosionIndex);
    } finally {
      syncingRef.current = false;
    }

    handles.candleMarkers?.setMarkers?.(showMetricEvents ? model.markers : []);
    handles.otcMarkers?.setMarkers?.(showMetricEvents ? model.otcPointMarkers : []);
    handles.explosionMarkers?.setMarkers?.(showMetricEvents ? model.explosionPointMarkers : []);

    // 最新值虚线跟着数据走，下一次更新前先撤掉旧的
    const latestPriceLines = [];
    const trackPriceLine = (series, line) => {
      if (line) latestPriceLines.push([series, line]);
    };
    if (model.latest) {
      trackPriceLine(handles.candleSeries, handles.candleSeries.createPriceLine({
        price: model.latest.close,
        color: model.candles.at(-1)?.close >= model.candles.at(-1)?.open ? GREEN : RED,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
      }));
    }
    if (model.latest?.otcIndex !== null && model.latest?.otcIndex !== undefined) {
      trackPriceLine(handles.otcSeries, handles.otcSeries.createPriceLine({
        price: model.latest.otcIndex,
        color: BLUE,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: '场外',
      }));
    }
    if (model.latest?.explosionIndex !== null && model.latest?.explosionIndex !== undefined) {
      trackPriceLine(handles.explosionSeries, handles.explosionSeries.createPriceLine({
        price: model.latest.explosionIndex,
        color: PURPLE,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: '爆破',
      }));
    }

    // 用户拖动过（或已经应用过一次复盘区间）就不再抢镜头
    if (!manualVisibleRangeRef.current) {
      applyReviewRange(handles.charts, model.rows, visibleBars, model.metricEvents);
    }
    handles.updatePhaseLayer();
    handles.updateAnnotationLayer();

    return () => {
      // 图表实例已经被创建 effect 销毁时不需要（也不能）再摘价格线
      if (chartHandlesRef.current !== handles) return;
      latestPriceLines.forEach(([series, line]) => series.removePriceLine?.(line));
    };
  }, [hasChartRows, indicatorChartHeight, model, priceChartHeight, showMetricEvents, visibleBars]);

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
          {isYahooFinanceSource && (
            <Switch
              className="otc-cycle-chart-panel__time-switch"
              size="small"
              checked={includePrePost}
              onChange={handleIncludePrePostChange}
              checkedChildren="盘前盘后"
              unCheckedChildren="盘前盘后"
              aria-label="盘前盘后"
            />
          )}
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
      ) : klines.length === 0 ? (
        // 空数组涵盖无数据与请求失败两种状态，界面提供对应说明
        <div className="otc-cycle-chart-panel__loading" data-testid="cycle-chart-empty">
          <Text type="secondary">
            {error
              ? `${symbol} K 线加载失败，请点击"刷新K线"重试`
              : `暂无 ${symbol} 的 K 线数据`}
          </Text>
        </div>
      ) : (
        <div className="tv-cycle-chart" data-testid="cycle-chart">
          <div className="tv-cycle-chart__summary">
            <span>{symbol} K线</span>
            <b>Close {formatPrice(latest?.close)}</b>
            <b><i className="tv-cycle-chart__legend-line tv-cycle-chart__legend-line--boll" />BOLL(20,2)</b>
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
