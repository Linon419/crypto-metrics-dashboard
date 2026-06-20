function trimTrailingZero(value) {
  return String(value).replace(/\.0$/, '');
}

export function formatCompactUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  const sign = number < 0 ? '-' : '';
  const absValue = Math.abs(number);
  if (absValue >= 1000000) {
    const scaled = absValue / 1000000;
    return `${sign}$${trimTrailingZero(scaled.toFixed(scaled >= 10 ? 0 : 1))}m`;
  }
  if (absValue >= 1000) {
    const scaled = absValue / 1000;
    return `${sign}$${trimTrailingZero(scaled.toFixed(scaled >= 100 ? 0 : 1))}k`;
  }
  return `${sign}$${Math.round(absValue).toLocaleString()}`;
}

export function formatFullUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number.toLocaleString(undefined, {
    maximumFractionDigits: 0,
    style: 'currency',
    currency: 'USD',
  });
}

const PAYOFF_SERIES = [
  ['expiry', 'expiryPnlUsd', '#2563eb'],
  ['当前估算', 'currentEstimateUsd', '#c47a14'],
  ['IV 回落', 'ivDownUsd', '#159947'],
  ['IV 上升', 'ivUpUsd', '#cc3d3d'],
  ['T+3', 'tPlus3Usd', '#7c3aed'],
];

function buildExpiryZoneTraces(points = []) {
  if (!points.some(point => Number.isFinite(Number(point.expiryPnlUsd)))) return [];
  const x = points.map(point => point.spot);
  return [
    {
      name: '盈利区',
      type: 'scatter',
      mode: 'lines',
      x,
      y: points.map(point => Math.max(Number(point.expiryPnlUsd) || 0, 0)),
      fill: 'tozeroy',
      fillcolor: 'rgba(34, 197, 94, 0.14)',
      hoverinfo: 'skip',
      line: { width: 0 },
      showlegend: false,
    },
    {
      name: '亏损区',
      type: 'scatter',
      mode: 'lines',
      x,
      y: points.map(point => Math.min(Number(point.expiryPnlUsd) || 0, 0)),
      fill: 'tozeroy',
      fillcolor: 'rgba(239, 68, 68, 0.12)',
      hoverinfo: 'skip',
      line: { width: 0 },
      showlegend: false,
    },
  ];
}

export function buildPayoffTraces(points = [], expiryLabel = '到期盈亏') {
  const lineTraces = PAYOFF_SERIES
    .map(([name, field, color]) => [name === 'expiry' ? expiryLabel : name, field, color])
    .filter(([, field]) => points.some(point => point[field] !== undefined))
    .map(([name, field, color]) => ({
      name,
      type: 'scatter',
      mode: 'lines',
      visible: ['IV 回落', 'IV 上升', 'T+3'].includes(name) ? 'legendonly' : true,
      hovertemplate: '%{x:$,.0f}<br>%{y:$,.0f}<extra>%{fullData.name}</extra>',
      line: {
        color,
        shape: 'linear',
        width: field === 'expiryPnlUsd' ? 3 : 2,
      },
      x: points.map(point => point.spot),
      y: points.map(point => point[field]),
    }));
  return [
    ...buildExpiryZoneTraces(points),
    ...lineTraces,
  ];
}

function buildPayoffShapes(metrics = {}) {
  const strikeShapes = (metrics.strikes || []).map(strike => ({
    type: 'line',
    xref: 'x',
    yref: 'paper',
    x0: strike,
    x1: strike,
    y0: 0,
    y1: 1,
    line: {
      color: 'rgba(100, 116, 139, 0.4)',
      width: 1,
      dash: 'dot',
    },
  }));
  const breakevenShapes = (metrics.breakevens || []).map(price => ({
    type: 'line',
    xref: 'x',
    yref: 'paper',
    x0: price,
    x1: price,
    y0: 0,
    y1: 1,
    line: {
      color: 'rgba(239, 68, 68, 0.62)',
      width: 1,
      dash: 'dash',
    },
  }));
  return [
    ...strikeShapes,
    ...breakevenShapes,
  ];
}

export function buildPayoffPlotlyConfig(payoff) {
  const points = payoff?.points || [];
  const data = buildPayoffTraces(points, payoff?.metrics?.payoffHorizonLabel || '到期盈亏');

  return {
    data,
    layout: {
      autosize: true,
      height: 320,
      margin: { l: 72, r: 24, t: 46, b: 52 },
      paper_bgcolor: '#fffdf8',
      plot_bgcolor: '#fffdf8',
      hovermode: 'x unified',
      shapes: buildPayoffShapes(payoff?.metrics),
      legend: {
        orientation: 'h',
        x: 0,
        y: 1.12,
        xanchor: 'left',
        yanchor: 'bottom',
        font: { size: 12 },
      },
      xaxis: {
        title: { text: 'BTC' },
        automargin: true,
        fixedrange: false,
        gridcolor: 'rgba(55, 82, 103, 0.12)',
        linecolor: 'rgba(55, 82, 103, 0.32)',
        tickformat: '$~s',
        zeroline: false,
      },
      yaxis: {
        title: { text: 'PnL (USD)' },
        automargin: true,
        fixedrange: false,
        gridcolor: 'rgba(55, 82, 103, 0.12)',
        linecolor: 'rgba(55, 82, 103, 0.32)',
        tickformat: '$~s',
        zeroline: true,
        zerolinecolor: 'rgba(32, 38, 50, 0.55)',
        zerolinewidth: 1,
      },
    },
    config: {
      displaylogo: false,
      responsive: true,
      scrollZoom: true,
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    },
  };
}
