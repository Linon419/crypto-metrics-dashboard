import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Drawer, Spin, Tag } from 'antd';
import {
  calculateBtcOptionPayoff,
  fetchBtcOptionStrategySetup,
} from '../services/api';
import OptionsLegTable from './OptionsLegTable';
import OptionsLiveSetupPanel from './OptionsLiveSetupPanel';
import OptionsPayoffChart from './OptionsPayoffChart';
import OptionsScenarioMetrics from './OptionsScenarioMetrics';
import OptionsStrategicNotes from './OptionsStrategicNotes';

function OptionsStrategyDrawer({ strategy, open, onClose }) {
  const [error, setError] = useState('');
  const [loadingSetup, setLoadingSetup] = useState(false);
  const [payoff, setPayoff] = useState(null);
  const [payoffLoading, setPayoffLoading] = useState(false);
  const [priceBasis, setPriceBasis] = useState('mark');
  const [quantityMultiplier, setQuantityMultiplier] = useState(1);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selectedExpiration, setSelectedExpiration] = useState(null);
  const [selectedExpirationStrategyId, setSelectedExpirationStrategyId] = useState(null);
  const [legQuantityOverrides, setLegQuantityOverrides] = useState({});
  const [setup, setSetup] = useState(null);
  const setupRequestSeqRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setError('');
    setPayoff(null);
    setPriceBasis('mark');
    setQuantityMultiplier(1);
    setSelectedExpiration(null);
    setSelectedExpirationStrategyId(null);
    setLegQuantityOverrides({});
    setSetup(null);
  }, [open, strategy?.id]);

  useEffect(() => {
    if (!open || !strategy?.id) return undefined;

    let cancelled = false;
    const requestSeq = setupRequestSeqRef.current + 1;
    setupRequestSeqRef.current = requestSeq;
    const effectiveExpiration = selectedExpirationStrategyId === strategy.id
      ? selectedExpiration
      : null;
    setLoadingSetup(true);
    setError('');
    fetchBtcOptionStrategySetup(strategy.id, {
      expirationDate: effectiveExpiration,
      priceBasis,
      refresh: refreshNonce > 0,
    })
      .then(response => {
        if (cancelled || requestSeq !== setupRequestSeqRef.current) return;
        setSetup(response.data);
        setLegQuantityOverrides({});
        setLoadingSetup(false);
      })
      .catch(requestError => {
        if (cancelled || requestSeq !== setupRequestSeqRef.current) return;
        setError(requestError.message || '实时搭建加载失败');
      })
      .finally(() => {
        if (!cancelled && requestSeq === setupRequestSeqRef.current) setLoadingSetup(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, priceBasis, refreshNonce, selectedExpiration, selectedExpirationStrategyId, strategy?.id]);

  const adjustedLegs = useMemo(() => {
    if (!setup?.legs) return [];
    return setup.legs.map(leg => ({
      ...leg,
      quantity: Number((
        legQuantityOverrides[leg.id || leg.instrumentName] ??
        ((leg.quantity || 1) * quantityMultiplier)
      ).toFixed(6)),
    }));
  }, [legQuantityOverrides, quantityMultiplier, setup]);

  const handleExpirationChange = useCallback(value => {
    setSelectedExpiration(value || null);
    setSelectedExpirationStrategyId(value ? strategy?.id || null : null);
    setLegQuantityOverrides({});
  }, [strategy?.id]);

  const handleLegQuantityChange = useCallback((leg, rawValue) => {
    const nextQuantity = Number(rawValue);
    if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) return;
    const key = leg.id || leg.instrumentName;
    setLegQuantityOverrides(current => ({
      ...current,
      [key]: Number(nextQuantity.toFixed(6)),
    }));
  }, []);

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
      width="min(1440px, calc(100vw - 24px))"
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

              <OptionsStrategicNotes strategy={strategy} />

              <h3>主要风险</h3>
              <div className="options-strategy-card__tags">
                {(strategy.risks || []).map(risk => <Tag key={risk} color="volcano">{risk}</Tag>)}
              </div>

            </section>

            <section className="options-drawer-column options-drawer-column--wide">
              <Spin spinning={loadingSetup}>
                <OptionsLiveSetupPanel
                  expirationDate={selectedExpirationStrategyId === strategy.id ? selectedExpiration : null}
                  loading={loadingSetup}
                  onExpirationChange={handleExpirationChange}
                  onPriceBasisChange={setPriceBasis}
                  onQuantityMultiplierChange={setQuantityMultiplier}
                  onRefresh={() => setRefreshNonce(value => value + 1)}
                  priceBasis={priceBasis}
                  quantityMultiplier={quantityMultiplier}
                  setup={setup}
                />
                <OptionsLegTable legs={adjustedLegs} onQuantityChange={handleLegQuantityChange} />
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
