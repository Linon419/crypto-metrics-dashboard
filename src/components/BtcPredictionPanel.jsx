import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Row, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import { ReloadOutlined, RiseOutlined, FallOutlined, MinusOutlined } from '@ant-design/icons';
import { fetchBtcPredictionBacktest } from '../services/api';

const { Text, Title } = Typography;

function formatPercent(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'n/a';
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function formatProbabilityPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'n/a';
  return `${Number(value).toFixed(2)}%`;
}

function formatPrice(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'n/a';
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getDirectionTag(direction) {
  if (direction === 'up') {
    return <Tag icon={<RiseOutlined />} color="success">偏多</Tag>;
  }
  if (direction === 'down') {
    return <Tag icon={<FallOutlined />} color="error">偏空</Tag>;
  }
  return <Tag icon={<MinusOutlined />} color="default">中性</Tag>;
}

function BtcPredictionPanel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const loadPrediction = useCallback(async ({ forceRefresh = false } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBtcPredictionBacktest({ refresh: forceRefresh });
      setResult(data);
    } catch (err) {
      setError(err.message || 'BTC预测加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      loadPrediction();
    }, 1800);

    return () => window.clearTimeout(timeoutId);
  }, [loadPrediction]);

  const latestRows = useMemo(() => {
    if (!result?.latestPredictions) return [];
    return result.latestPredictions
      .filter(item => item.horizon === result.bestResult?.horizon || [1, 3, 5, 7].includes(item.horizon))
      .sort((a, b) => {
        if (a.horizon !== b.horizon) return a.horizon - b.horizon;
        return String(a.modelName).localeCompare(String(b.modelName));
      });
  }, [result]);

  const columns = [
    {
      title: '周期',
      dataIndex: 'horizon',
      key: 'horizon',
      width: 80,
      render: value => `${value}d`,
    },
    {
      title: '模型',
      dataIndex: 'modelName',
      key: 'modelName',
    },
    {
      title: '上涨概率',
      dataIndex: 'probabilityPercent',
      key: 'probabilityPercent',
      width: 110,
      render: value => formatProbabilityPercent(value),
      sorter: (a, b) => Number(a.probabilityPercent || 0) - Number(b.probabilityPercent || 0),
    },
    {
      title: '方向',
      dataIndex: 'predictedDirection',
      key: 'predictedDirection',
      width: 100,
      render: getDirectionTag,
    },
    {
      title: '训练样本',
      dataIndex: 'trainingRows',
      key: 'trainingRows',
      width: 100,
    },
    {
      title: '解释',
      dataIndex: 'explanation',
      key: 'explanation',
      render: value => value || '-',
    },
  ];

  if (loading && !result) {
    return (
      <Card className="mb-4" size="small">
        <Spin /> <Text className="ml-2">BTC预测回测加载中</Text>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert
        className="mb-4"
        type="warning"
        showIcon
        message="BTC预测回测加载失败"
        description={error}
        action={<Button size="small" icon={<ReloadOutlined />} onClick={() => loadPrediction({ forceRefresh: true })}>重试</Button>}
      />
    );
  }

  if (!result?.bestResult) return null;

  const best = result.bestResult;
  const bestPrediction = result.bestLatestPrediction;
  const latestFeature = result.latestFeature;
  const data = result.data || {};

  return (
    <Card className="mb-4" size="small">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
        <div>
          <Title level={5} className="m-0">BTC永续发布价预测回测</Title>
          <Text type="secondary">
            训练样本 {data.firstTrainingDate} 至 {data.latestTrainingFeatureDate}；
            已缓存发布价 {data.rowsWithBtcPublishPrice} 条，缺发布价 {data.rowsWithoutBtcPublishPrice} 条
          </Text>
        </div>
        <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => loadPrediction({ forceRefresh: true })}>
          刷新预测
        </Button>
      </div>

      <Row gutter={[12, 12]} className="mb-3">
        <Col xs={24} sm={12} lg={6}>
          <Statistic title="最佳模型" value={`${best.modelName} ${best.horizon}d`} />
        </Col>
        <Col xs={12} sm={6} lg={4}>
          <Statistic title="precision@60" value={formatPercent(best.metrics.precisionAtThreshold)} />
        </Col>
        <Col xs={12} sm={6} lg={4}>
          <Statistic title="信号数" value={best.metrics.signalCount} />
        </Col>
        <Col xs={12} sm={6} lg={4}>
          <Statistic title="F1" value={formatPercent(best.metrics.f1)} />
        </Col>
        <Col xs={12} sm={6} lg={4}>
          <Statistic title="信号平均收益" value={formatPercent(best.metrics.averageReturnWhenSignal)} />
        </Col>
      </Row>

      {bestPrediction && latestFeature && (
        <Alert
          className="mb-3"
          type={bestPrediction.predictedDirection === 'up' ? 'success' : bestPrediction.predictedDirection === 'down' ? 'error' : 'info'}
          showIcon
          message={
            <Space wrap>
              <Text strong>{latestFeature.date} 最新可训练样本</Text>
              <Tag color="blue">{latestFeature.periodState.period_state_label}</Tag>
              {getDirectionTag(bestPrediction.predictedDirection)}
              <Text>上涨概率 {formatProbabilityPercent(bestPrediction.probabilityPercent)}</Text>
            </Space>
          }
          description={`场外 ${latestFeature.otc_index}，爆破 ${latestFeature.explosion_index}，谢林点 ${latestFeature.schelling_point ?? 'n/a'}，Binance永续发布价 ${formatPrice(latestFeature.btc_publish_price)}`}
        />
      )}

      <Table
        size="small"
        rowKey={record => `${record.horizon}-${record.modelName}`}
        columns={columns}
        dataSource={latestRows}
        pagination={{ pageSize: 8, hideOnSinglePage: true }}
        scroll={{ x: 760 }}
      />
    </Card>
  );
}

export default BtcPredictionPanel;
