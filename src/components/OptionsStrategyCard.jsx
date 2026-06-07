import React from 'react';
import { Button, Tag } from 'antd';

function OptionsStrategyCard({ strategy, onOpen }) {
  return (
    <article className="options-strategy-card">
      <div className="options-strategy-card__head">
        <div>
          <h3>{strategy.nameZh}</h3>
          <p>{strategy.nameEn}</p>
        </div>
        <Button type="primary" onClick={() => onOpen(strategy)}>查看原文</Button>
      </div>

      <div className="options-strategy-card__tags">
        {(strategy.marketStates || []).map(tag => <Tag key={tag} color="blue">{tag}</Tag>)}
        {(strategy.strategyTypes || []).map(tag => <Tag key={tag} color="gold">{tag}</Tag>)}
      </div>

      <dl className="options-strategy-card__body">
        <dt>什么时候用</dt>
        <dd>{strategy.whenToUse}</dd>
        <dt>怎么搭</dt>
        <dd>{(strategy.setup || []).join(' / ')}</dd>
        <dt>核心 Greeks</dt>
        <dd>{(strategy.coreGreeks || []).join(' / ')}</dd>
      </dl>
    </article>
  );
}

export default OptionsStrategyCard;
