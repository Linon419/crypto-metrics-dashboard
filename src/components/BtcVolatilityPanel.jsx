import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Spin, Tag, Typography } from 'antd';
import { ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { fetchBtcVolatility } from '../services/api';

const { Text } = Typography;

function formatPercent(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'n/a';
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'n/a';
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function getComparisonTag(comparison) {
  const label = comparison?.label || '数据不足';
  if (comparison?.bias === 'iv_premium') {
    return <Tag color="purple">IV溢价</Tag>;
  }
  if (comparison?.bias === 'rv_premium') {
    return <Tag color="volcano">RV高于IV</Tag>;
  }
  if (comparison?.bias === 'balanced') {
    return <Tag color="blue">接近</Tag>;
  }
  return <Tag>{label}</Tag>;
}

function BtcVolatilityPanel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const loadVolatility = useCallback(async ({ refresh = false } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchBtcVolatility({ refresh });
      setResult(response.data);
    } catch (err) {
      setError(err.message || 'BTC波动率加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVolatility();
  }, [loadVolatility]);

  const spreadText = useMemo(() => {
    const spread = result?.comparison?.spread;
    if (spread === null || spread === undefined || Number.isNaN(Number(spread))) return 'n/a';
    const prefix = Number(spread) > 0 ? '+' : '';
    return `${prefix}${formatPercent(spread)}`;
  }, [result]);

  if (loading && !result) {
    return (
      <div className="btc-vol-panel">
        <Spin size="small" /> <Text className="ml-2">BTC RV/IV 加载中</Text>
      </div>
    );
  }

  if (error) {
    return (
      <Alert
        className="mb-4"
        type="warning"
        showIcon
        message="BTC RV/IV 加载失败"
        description={error}
        action={<Button size="small" icon={<ReloadOutlined />} onClick={() => loadVolatility({ refresh: true })}>重试</Button>}
      />
    );
  }

  if (!result) return null;

  return (
    <div className="btc-vol-panel">
      <div className="btc-vol-panel__head">
        <div className="btc-vol-panel__title">
          <ThunderboltOutlined /> BTC RV/IV
        </div>
        {getComparisonTag(result.comparison)}
      </div>

      <div className="btc-vol-panel__metrics">
        <span>RV <strong>{formatPercent(result.dailyRv)}</strong></span>
        <span>IV <strong>{formatPercent(result.dailyIv)}</strong></span>
        <span>差值 <strong>{spreadText}</strong></span>
        <span>比值 <strong>{formatNumber(result.comparison?.ratio, 2)}</strong></span>
        <span className="btc-vol-panel__muted">ATR14 {formatNumber(result.atr)}</span>
        <span className="btc-vol-panel__muted">DVOL {formatNumber(result.dvolAnnualizedPercent)}%</span>
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => loadVolatility({ refresh: true })}
        >
          刷新
        </Button>
      </div>
    </div>
  );
}

export default BtcVolatilityPanel;
