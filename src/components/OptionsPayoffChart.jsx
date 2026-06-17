import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Empty } from 'antd';

function buildSeries(points = [], expiryLabel = '到期盈亏') {
  return [
    [expiryLabel, 'expiryPnlBtc', '#2563eb'],
    ['当前估算', 'currentEstimateBtc', '#c47a14'],
    ['IV 回落', 'ivDownBtc', '#159947'],
    ['IV 上升', 'ivUpBtc', '#cc3d3d'],
    ['T+3', 'tPlus3Btc', '#7c3aed'],
  ]
    .filter(([, field]) => points.some(point => point[field] !== undefined))
    .map(([name, field, color]) => ({
      name,
      type: 'line',
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2, color },
      data: points.map(point => [point.spot, point[field]]),
    }));
}

function OptionsPayoffChart({ payoff }) {
  const option = useMemo(() => {
    const points = payoff?.points || [];
    const series = buildSeries(points, payoff?.metrics?.payoffHorizonLabel || '到期盈亏');
    return {
      color: series.map(item => item.lineStyle.color),
      tooltip: {
        trigger: 'axis',
        valueFormatter: value => `${Number(value).toFixed(4)} BTC`,
      },
      legend: {
        top: 0,
      },
      grid: {
        left: 54,
        right: 18,
        top: 46,
        bottom: 42,
      },
      xAxis: {
        type: 'value',
        name: 'BTC',
        axisLabel: {
          formatter: value => `$${Number(value).toLocaleString()}`,
        },
      },
      yAxis: {
        type: 'value',
        name: 'PnL (BTC)',
        axisLabel: {
          formatter: value => Number(value).toFixed(3),
        },
      },
      series,
    };
  }, [payoff]);

  if (!payoff?.points?.length) {
    return <Empty description="暂无盈亏图" />;
  }

  return (
    <div className="options-payoff-chart" aria-label="期权策略盈亏图">
      <ReactECharts option={option} style={{ height: 320, width: '100%' }} />
    </div>
  );
}

export default OptionsPayoffChart;
