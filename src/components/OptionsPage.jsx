import React, { useMemo, useState } from 'react';
import { Empty, Input, Tag, Typography } from 'antd';
import optionsKnowledgeIndex from '../data/optionsKnowledgeIndex.json';
import {
  MARKET_STATE_FILTERS,
  STRATEGY_TYPE_FILTERS,
  filterOptionsStrategies,
  getOptionsFilterCounts,
} from '../utils/optionsKnowledge';
import OptionsStrategyCard from './OptionsStrategyCard';
import OptionsStrategyDrawer from './OptionsStrategyDrawer';
import OptionsVolatilityChart from './OptionsVolatilityChart';

const { Text } = Typography;

function FilterButton({ active, count, label, onClick }) {
  return (
    <button className={`options-filter-chip ${active ? 'is-active' : ''}`} onClick={onClick} type="button">
      {label} <span>{count || 0}</span>
    </button>
  );
}

function OptionsPage() {
  const [marketState, setMarketState] = useState('');
  const [strategyType, setStrategyType] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStrategy, setSelectedStrategy] = useState(null);

  const counts = useMemo(() => getOptionsFilterCounts(optionsKnowledgeIndex), []);
  const filteredStrategies = useMemo(() => filterOptionsStrategies(optionsKnowledgeIndex, {
    marketState,
    strategyType,
    searchTerm,
  }), [marketState, strategyType, searchTerm]);

  return (
    <main className="options-page">
      <OptionsVolatilityChart />

      <section className="options-page__header">
        <div>
          <div className="dashboard-eyebrow">Options Playbook</div>
          <h1>期权策略库</h1>
          <Text>按市场状态和策略属性检索《魔方内参》期权原文、操作步骤和风险点。</Text>
        </div>
        <Input
          className="options-search"
          placeholder="搜索策略、Greek、课程或原文"
          value={searchTerm}
          onChange={event => setSearchTerm(event.target.value)}
        />
      </section>

      <section className="options-filter-grid">
        <div>
          <h2>市场状态</h2>
          <div className="options-filter-list">
            <FilterButton label="全部状态" active={!marketState} count={optionsKnowledgeIndex.length} onClick={() => setMarketState('')} />
            {MARKET_STATE_FILTERS.map(label => (
              <FilterButton
                key={label}
                label={label}
                active={marketState === label}
                count={counts.marketStates[label]}
                onClick={() => setMarketState(label)}
              />
            ))}
          </div>
        </div>
        <div>
          <h2>策略属性</h2>
          <div className="options-filter-list">
            <FilterButton label="全部属性" active={!strategyType} count={optionsKnowledgeIndex.length} onClick={() => setStrategyType('')} />
            {STRATEGY_TYPE_FILTERS.map(label => (
              <FilterButton
                key={label}
                label={label}
                active={strategyType === label}
                count={counts.strategyTypes[label]}
                onClick={() => setStrategyType(label)}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="options-result-meta">
        <Tag color="default">{filteredStrategies.length} 个策略</Tag>
        {marketState && <Tag color="blue">{marketState}</Tag>}
        {strategyType && <Tag color="gold">{strategyType}</Tag>}
      </section>

      {filteredStrategies.length > 0 ? (
        <section className="options-strategy-grid">
          {filteredStrategies.map(strategy => (
            <OptionsStrategyCard
              key={strategy.id}
              strategy={strategy}
              onOpen={setSelectedStrategy}
            />
          ))}
        </section>
      ) : (
        <Empty description="暂无期权策略内容" />
      )}

      <OptionsStrategyDrawer
        strategy={selectedStrategy}
        open={Boolean(selectedStrategy)}
        onClose={() => setSelectedStrategy(null)}
      />
    </main>
  );
}

export default OptionsPage;
