import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Segmented, Spin, Tag, Typography } from 'antd';
import { ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { fetchBtcVolatility } from '../services/api';

const { Text } = Typography;
const ANNUALIZATION_FACTOR = Math.sqrt(365);

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

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

function annualizeDaily(value) {
  const number = toFiniteNumber(value);
  return number === null ? null : number * ANNUALIZATION_FACTOR;
}

function getAnnualizedIv(result) {
  const dvol = toFiniteNumber(result?.dvolAnnualizedPercent);
  if (dvol !== null) return dvol / 100;
  return annualizeDaily(result?.dailyIv);
}

function buildDisplayMetrics(result, mode) {
  const dailyRv = toFiniteNumber(result?.dailyRv);
  const dailyIv = toFiniteNumber(result?.dailyIv);
  const annualRv = annualizeDaily(dailyRv);
  const annualIv = getAnnualizedIv(result);
  const rv = mode === 'annual' ? annualRv : dailyRv;
  const iv = mode === 'annual' ? annualIv : dailyIv;
  const spread = rv !== null && iv !== null ? iv - rv : null;
  const ratio = rv !== null && rv > 0 && iv !== null ? iv / rv : null;

  return {
    rv,
    iv,
    spread,
    ratio,
    secondaryIvLabel: mode === 'annual' ? '日化IV' : '年化IV',
    secondaryIv: mode === 'annual' ? dailyIv : annualIv,
  };
}

function BtcVolatilityPanel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [volatilityMode, setVolatilityMode] = useState('daily');

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

  const displayMetrics = useMemo(
    () => buildDisplayMetrics(result, volatilityMode),
    [result, volatilityMode]
  );

  const spreadText = useMemo(() => {
    const spread = displayMetrics.spread;
    if (spread === null || spread === undefined || Number.isNaN(Number(spread))) return 'n/a';
    const prefix = Number(spread) > 0 ? '+' : '';
    return `${prefix}${formatPercent(spread)}`;
  }, [displayMetrics.spread]);

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
        <Segmented
          className="btc-vol-panel__mode"
          size="small"
          aria-label="RV/IV口径"
          value={volatilityMode}
          onChange={setVolatilityMode}
          options={[
            { label: '日化', value: 'daily' },
            { label: '年化', value: 'annual' },
          ]}
        />
        {getComparisonTag(result.comparison)}
      </div>

      <div className="btc-vol-panel__metrics">
        <span>RV <strong>{formatPercent(displayMetrics.rv)}</strong></span>
        <span>IV <strong>{formatPercent(displayMetrics.iv)}</strong></span>
        <span>差值 <strong>{spreadText}</strong></span>
        <span>比值 <strong>{formatNumber(displayMetrics.ratio, 2)}</strong></span>
        <span className="btc-vol-panel__muted">ATR14 {formatNumber(result.atr)}</span>
        <span className="btc-vol-panel__muted">{displayMetrics.secondaryIvLabel} {formatPercent(displayMetrics.secondaryIv)}</span>
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
