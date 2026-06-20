import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import Plotly from 'plotly.js-basic-dist-min';
import { Empty } from 'antd';
import { buildPayoffPlotlyConfig } from '../utils/optionsPayoffPlotlyConfig';

function OptionsPayoffChart({ payoff }) {
  const containerRef = useRef(null);
  const isPlotReadyRef = useRef(false);
  const resizeFrameRef = useRef(null);
  const resizeTimersRef = useRef([]);
  const plotlyConfig = useMemo(() => buildPayoffPlotlyConfig(payoff), [payoff]);

  const clearResizeTimers = useCallback(() => {
    if (resizeFrameRef.current !== null && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(resizeFrameRef.current);
    }
    resizeFrameRef.current = null;
    resizeTimersRef.current.forEach(timer => window.clearTimeout(timer));
    resizeTimersRef.current = [];
  }, []);

  const resizeChart = useCallback(() => {
    const node = containerRef.current;
    if (!node || !isPlotReadyRef.current || !node._fullLayout) return;
    Plotly.Plots.resize(node);
  }, []);

  const scheduleResize = useCallback(() => {
    clearResizeTimers();
    if (typeof window.requestAnimationFrame === 'function') {
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        resizeChart();
      });
    } else {
      resizeChart();
    }
    resizeTimersRef.current = [80, 220, 420].map(delay => window.setTimeout(resizeChart, delay));
  }, [clearResizeTimers, resizeChart]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || !payoff?.points?.length) return undefined;

    let cancelled = false;
    isPlotReadyRef.current = false;

    let renderPromise;
    try {
      renderPromise = Plotly.react(node, plotlyConfig.data, plotlyConfig.layout, plotlyConfig.config);
    } catch (error) {
      console.error('Plotly payoff chart render failed:', error);
      return undefined;
    }

    Promise.resolve(renderPromise)
      .then(() => {
        if (cancelled || containerRef.current !== node) return;
        isPlotReadyRef.current = true;
        scheduleResize();
      })
      .catch(error => {
        if (!cancelled) {
          // Keep a Plotly render failure visible without crashing the surrounding drawer.
          console.error('Plotly payoff chart render failed:', error);
        }
      });

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleResize) : null;
    observer?.observe(node);
    window.addEventListener('resize', scheduleResize);

    return () => {
      cancelled = true;
      isPlotReadyRef.current = false;
      observer?.disconnect();
      window.removeEventListener('resize', scheduleResize);
      clearResizeTimers();
      Plotly.purge(node);
    };
  }, [clearResizeTimers, payoff?.points?.length, plotlyConfig, scheduleResize]);

  if (!payoff?.points?.length) {
    return <Empty description="暂无盈亏图" />;
  }

  return (
    <div ref={containerRef} className="options-payoff-chart" aria-label="期权策略盈亏图" />
  );
}

export default OptionsPayoffChart;
