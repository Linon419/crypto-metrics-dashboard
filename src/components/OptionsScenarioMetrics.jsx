import React from 'react';

function formatBtc(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })} BTC`;
}

function formatUsd(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatGreek(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function OptionsScenarioMetrics({ metrics }) {
  if (!metrics) {
    return <div className="options-live-empty">等待盈亏计算</div>;
  }

  const rows = [
    ['曲线口径', metrics.payoffHorizonLabel || '到期盈亏'],
    ['净权利金', formatBtc(metrics.netPremiumBtc)],
    ['净权利金 USD', formatUsd(metrics.netPremiumUsd)],
    ['最大收益', formatBtc(metrics.maxProfitBtc)],
    ['最大亏损', formatBtc(metrics.maxLossBtc)],
    ['最大收益 USD', formatUsd(metrics.maxProfitUsd)],
    ['最大亏损 USD', formatUsd(metrics.maxLossUsd)],
    ['盈亏平衡', (metrics.breakevens || []).map(value => `$${Number(value).toLocaleString()}`).join(' / ') || '-'],
    ['Delta', formatGreek(metrics.greeks?.delta)],
    ['Gamma', formatGreek(metrics.greeks?.gamma)],
    ['Theta', formatGreek(metrics.greeks?.theta)],
    ['Vega', formatGreek(metrics.greeks?.vega)],
  ];

  return (
    <div className="options-metric-grid">
      {rows.map(([label, value]) => (
        <div className="options-metric" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

export default OptionsScenarioMetrics;
