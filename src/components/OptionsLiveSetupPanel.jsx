import React from 'react';
import { Button, Select } from 'antd';

function formatPrice(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function OptionsLiveSetupPanel({
  onPriceBasisChange,
  onQuantityMultiplierChange,
  onRefresh,
  priceBasis,
  quantityMultiplier,
  setup,
}) {
  return (
    <section className="options-live-panel">
      <div className="options-live-panel__head">
        <div>
          <h3>实时搭建设置</h3>
          <p>Deribit BTC options · {setup?.generatedAt ? new Date(setup.generatedAt).toLocaleString() : '等待数据'}</p>
        </div>
        <Button size="small" onClick={onRefresh}>刷新腿位</Button>
      </div>

      <div className="options-live-controls">
        <label>
          <span>价格口径</span>
          <Select
            aria-label="价格口径"
            size="small"
            value={priceBasis}
            onChange={onPriceBasisChange}
            options={(setup?.controls?.priceBasisOptions || ['mark', 'mid', 'bid', 'ask']).map(value => ({
              value,
              label: value.toUpperCase(),
            }))}
          />
        </label>
        <label>
          <span>数量倍率</span>
          <input
            aria-label="数量倍率"
            min="0.1"
            step="0.1"
            type="number"
            value={quantityMultiplier}
            onChange={event => onQuantityMultiplierChange(Number(event.target.value) || 1)}
          />
        </label>
        <div>
          <span>BTC 价格</span>
          <strong>{formatPrice(setup?.underlyingPrice)}</strong>
        </div>
        <div>
          <span>到期日</span>
          <strong>{setup?.controls?.selectedExpiration || '-'}</strong>
        </div>
      </div>

      {setup?.rationale?.length ? (
        <div className="options-live-rationale">
          {setup.rationale.map(item => <span key={item}>{item}</span>)}
        </div>
      ) : null}
    </section>
  );
}

export default OptionsLiveSetupPanel;
