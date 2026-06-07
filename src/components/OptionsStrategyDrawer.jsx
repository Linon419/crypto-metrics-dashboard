import React from 'react';
import { Button, Drawer, Empty, Tag, Typography } from 'antd';

const { Paragraph, Text } = Typography;

function OptionsStrategyDrawer({ strategy, open, onClose }) {
  return (
    <Drawer
      title={strategy ? `${strategy.nameZh}（${strategy.nameEn}）` : '策略详情'}
      width={680}
      open={open}
      onClose={onClose}
    >
      {strategy ? (
        <div className="options-drawer">
          <section>
            <h3>怎么操作</h3>
            <ol>
              {(strategy.operationSteps || []).map(step => <li key={step}>{step}</li>)}
            </ol>
          </section>

          <section>
            <h3>主要风险</h3>
            <div className="options-strategy-card__tags">
              {(strategy.risks || []).map(risk => <Tag key={risk} color="volcano">{risk}</Tag>)}
            </div>
          </section>

          <section>
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
        </div>
      ) : null}
    </Drawer>
  );
}

export default OptionsStrategyDrawer;
