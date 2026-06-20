import React from 'react';
import { Empty, Tag } from 'antd';

function formatNumber(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

function getUnderlyingLabel(leg) {
  if (leg.instrumentName) return leg.instrumentName;
  if (leg.role === 'delta-hedge') return 'BTC 期货/现货对冲';
  return 'BTC 底仓';
}

function OptionsLegTable({ legs = [], onQuantityChange }) {
  if (!legs.length) {
    return <Empty description="暂无实时腿位" />;
  }

  return (
    <div className="options-leg-table-wrap">
      <table className="options-leg-table">
        <thead>
          <tr>
            <th>动作</th>
            <th>合约</th>
            <th>到期日</th>
            <th>Strike</th>
            <th>数量</th>
            <th>价格</th>
            <th>IV</th>
          </tr>
        </thead>
        <tbody>
          {legs.map(leg => (
            <tr key={leg.id || leg.instrumentName}>
              <td>
                <Tag color={leg.side === 'buy' || leg.side === 'long' ? 'green' : 'volcano'}>
                  {leg.side === 'buy' || leg.side === 'long' ? 'Buy' : 'Sell'}
                </Tag>
              </td>
              <td>
                {leg.type === 'underlying' ? getUnderlyingLabel(leg) : (
                  <div>
                    <strong>{leg.instrumentName}</strong>
                    <span>{leg.optionType?.toUpperCase()}</span>
                  </div>
                )}
              </td>
              <td>{leg.expirationDate || '-'}</td>
              <td>{formatNumber(leg.strike, 0)}</td>
              <td>
                {onQuantityChange ? (
                  <input
                    aria-label={`数量 ${leg.instrumentName || leg.role || leg.id}`}
                    className="options-leg-quantity-input"
                    min="0.01"
                    step="0.1"
                    type="number"
                    value={leg.quantity}
                    onChange={event => onQuantityChange(leg, event.target.value)}
                  />
                ) : formatNumber(leg.quantity, 2)}
              </td>
              <td>{leg.type === 'underlying' ? `$${formatNumber(leg.entryPrice, 0)}` : `${formatNumber(leg.entryPrice, 5)} BTC`}</td>
              <td>{leg.entryIv ? `${formatNumber(leg.entryIv, 1)}%` : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default OptionsLegTable;
