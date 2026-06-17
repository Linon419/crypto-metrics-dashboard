import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Drawer, Empty, Spin, Tag, Typography } from 'antd';
import {
  calculateBtcOptionPayoff,
  fetchBtcOptionStrategySetup,
} from '../services/api';
import OptionsLegTable from './OptionsLegTable';
import OptionsLiveSetupPanel from './OptionsLiveSetupPanel';
import OptionsPayoffChart from './OptionsPayoffChart';
import OptionsScenarioMetrics from './OptionsScenarioMetrics';

const { Paragraph, Text } = Typography;

function OptionsStrategyDrawer({ strategy, open, onClose }) {
  const [error, setError] = useState('');
  const [loadingSetup, setLoadingSetup] = useState(false);
  const [payoff, setPayoff] = useState(null);
  const [payoffLoading, setPayoffLoading] = useState(false);
  const [priceBasis, setPriceBasis] = useState('mark');
  const [quantityMultiplier, setQuantityMultiplier] = useState(1);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [setup, setSetup] = useState(null);

  useEffect(() => {
    if (!open || !strategy?.id) return undefined;

    let cancelled = false;
    setLoadingSetup(true);
    setError('');
    fetchBtcOptionStrategySetup(strategy.id, {
      priceBasis,
      refresh: refreshNonce > 0,
    })
      .then(response => {
        if (cancelled) return;
        setSetup(response.data);
        setLoadingSetup(false);
      })
      .catch(requestError => {
        if (cancelled) return;
        setError(requestError.message || '实时搭建加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoadingSetup(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, priceBasis, refreshNonce, strategy?.id]);

  const adjustedLegs = useMemo(() => {
    if (!setup?.legs) return [];
    return setup.legs.map(leg => ({
      ...leg,
      quantity: Number(((leg.quantity || 1) * quantityMultiplier).toFixed(6)),
    }));
  }, [quantityMultiplier, setup]);

  useEffect(() => {
    if (!open || !setup?.underlyingPrice || adjustedLegs.length === 0) return undefined;

    let cancelled = false;
    setPayoffLoading(true);
    calculateBtcOptionPayoff({
      legs: adjustedLegs,
      underlyingPrice: setup.underlyingPrice,
      pointCount: 81,
    })
      .then(response => {
        if (cancelled) return;
        setPayoff(response.data);
      })
      .catch(requestError => {
        if (cancelled) return;
        setError(requestError.message || '盈亏图计算失败');
      })
      .finally(() => {
        if (!cancelled) setPayoffLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [adjustedLegs, open, setup?.underlyingPrice]);

  return (
    <Drawer
      title={strategy ? `${strategy.nameZh}（${strategy.nameEn}）` : '策略详情'}
      width={1180}
      open={open}
      onClose={onClose}
    >
      {strategy ? (
        <div className="options-drawer">
          {error ? <Alert className="options-live-alert" type="warning" message={error} showIcon /> : null}

          <div className="options-drawer-grid">
            <section className="options-drawer-column">
              <h3>怎么操作</h3>
              <ol>
                {(strategy.operationSteps || []).map(step => <li key={step}>{step}</li>)}
              </ol>

              <h3>主要风险</h3>
              <div className="options-strategy-card__tags">
                {(strategy.risks || []).map(risk => <Tag key={risk} color="volcano">{risk}</Tag>)}
              </div>

              <h3>老师原文</h3>
              {(strategy.quotes || []).length > 0 ? (
                strategy.quotes.map((quote, index) => (
                  <div className="options-quote" key={`${quote.sourceFile}-${index}`}>
                    <Text strong>{quote.sourceFile}</Text>
                    <Paragraph>{quote.excerpt}</Paragraph>
                    <Button size="small" onClick={() => navigator.clipboard?.writeText(quote.excerpt)}>复制原文</Button>
                  </div>
                ))
              ) : (
                <Empty description="待补充来源" />
              )}
            </section>

            <section className="options-drawer-column options-drawer-column--wide">
              <Spin spinning={loadingSetup}>
                <OptionsLiveSetupPanel
                  loading={loadingSetup}
                  onPriceBasisChange={setPriceBasis}
                  onQuantityMultiplierChange={setQuantityMultiplier}
                  onRefresh={() => setRefreshNonce(value => value + 1)}
                  priceBasis={priceBasis}
                  quantityMultiplier={quantityMultiplier}
                  setup={setup}
                />
                <OptionsLegTable legs={adjustedLegs} />
              </Spin>
            </section>

            <section className="options-drawer-column options-drawer-column--wide">
              <div className="options-payoff-head">
                <h3>盈亏图</h3>
                {payoffLoading ? <Tag color="processing">计算中</Tag> : <Tag color="green">场景已生成</Tag>}
              </div>
              <OptionsScenarioMetrics metrics={payoff?.metrics} />
              <OptionsPayoffChart payoff={payoff} />
              <div className="options-payoff-note">
                当前估算使用 Deribit mark IV、利率和剩余时间重估，展示用途为教学演算和复盘辅助。
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}

export default OptionsStrategyDrawer;
