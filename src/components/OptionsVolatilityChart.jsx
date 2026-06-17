import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { Alert, Button, Spin, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { fetchBtcVolatilityHistory } from '../services/api';

const { Text } = Typography;

const VOLATILITY_PERIODS = [
  { key: '15m', label: '15min', resolution: '900', lookbackHours: 24 },
  { key: '1h', label: '1h', resolution: '3600', lookbackHours: 24 * 30 },
  { key: '4h', label: '4h', resolution: '14400', lookbackHours: 24 * 60 },
];

function formatDateLabel(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  });
}

function OptionsVolatilityChart() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState(null);
  const [periodKey, setPeriodKey] = useState('1h');

  const selectedPeriod = useMemo(
    () => VOLATILITY_PERIODS.find(period => period.key === periodKey) || VOLATILITY_PERIODS[1],
    [periodKey],
  );

  const loadHistory = useCallback(async ({ refresh = false } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchBtcVolatilityHistory({
        refresh,
        lookbackHours: selectedPeriod.lookbackHours,
        resolution: selectedPeriod.resolution,
      });
      setHistory(response.data);
    } catch (err) {
      setError(err.message || 'BTC 隐含波动率历史加载失败');
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod.lookbackHours, selectedPeriod.resolution]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const candles = useMemo(() => history?.candles || [], [history?.candles]);
  const latest = candles[candles.length - 1];

  const option = useMemo(() => ({
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
    },
    grid: { left: 42, right: 18, top: 24, bottom: 32 },
    xAxis: {
      type: 'category',
      data: candles.map(item => formatDateLabel(item.timestamp)),
      boundaryGap: true,
      axisLabel: { color: '#6f756e' },
      axisLine: { lineStyle: { color: '#ddd4c2' } },
    },
    yAxis: {
      scale: true,
      axisLabel: { color: '#6f756e', formatter: value => `${value}%` },
      splitLine: { lineStyle: { color: 'rgba(78, 68, 50, 0.14)' } },
    },
    series: [{
      name: 'BTC DVOL',
      type: 'candlestick',
      data: candles.map(item => [item.open, item.close, item.low, item.high]),
      itemStyle: {
        color: '#2f8f61',
        color0: '#c75d4d',
        borderColor: '#2f8f61',
        borderColor0: '#c75d4d',
      },
    }],
  }), [candles]);

  if (loading && !history) {
    return (
      <section className="options-vol-panel">
        <Spin size="small" /> <Text>BTC 隐含波动率加载中</Text>
      </section>
    );
  }

  if (error) {
    return (
      <Alert
        className="options-vol-panel"
        type="warning"
        showIcon
        message="BTC 隐含波动率 K 线加载失败"
        description={error}
        action={<Button size="small" icon={<ReloadOutlined />} onClick={() => loadHistory({ refresh: true })}>重试</Button>}
      />
    );
  }

  return (
    <section className="options-vol-panel">
      <div className="options-vol-panel__header">
        <div>
          <div className="options-vol-panel__eyebrow">BTC Implied Volatility</div>
          <h2>BTC 隐含波动率 K 线</h2>
        </div>
        <div className="options-vol-panel__meta">
          <div className="options-vol-periods" aria-label="K 线周期">
            {VOLATILITY_PERIODS.map(period => (
              <button
                aria-pressed={period.key === periodKey}
                className={`options-vol-period ${period.key === periodKey ? 'is-active' : ''}`}
                key={period.key}
                onClick={() => setPeriodKey(period.key)}
                type="button"
              >
                {period.label}
              </button>
            ))}
          </div>
          <span>最新 DVOL <strong>{latest ? `${latest.close.toFixed(2)}%` : 'n/a'}</strong></span>
          <span>样本 <strong>{candles.length}</strong></span>
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => loadHistory({ refresh: true })}>刷新</Button>
        </div>
      </div>
      <ReactECharts option={option} style={{ height: 320, width: '100%' }} notMerge lazyUpdate />
    </section>
  );
}

export default OptionsVolatilityChart;
