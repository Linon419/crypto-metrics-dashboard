# 动能标识符号实现设计

## 📊 动能标识符号定义

| 符号 | 含义 | 触发条件 | 重要性 |
|------|------|----------|--------|
| $ | 向上动能，重点关注 | 根据综合指标判断有较大向上动能 | 高 |
| ※ | 高速油门期 | 爆破指数 > 200 | 高 |
| ‼ | 短期撤出信号 | 爆破指数从200+跌至200- | 极高 |
| ↑ | 上升通道指标 | 爆破指数连续2-3天上涨 | 中高 |
| w | 巨头犹豫信号 | 退场期的特殊情况 | 中 |

## 🗄️ 数据库设计

### 方案1: 添加新字段到DailyMetric
```sql
ALTER TABLE DailyMetrics ADD COLUMN momentum_indicators TEXT; -- 存储符号字符串，如"$※"
ALTER TABLE DailyMetrics ADD COLUMN momentum_details JSON;    -- 存储详细信息
```

### 方案2: 创建单独的动能标识表
```sql
CREATE TABLE MomentumIndicators (
  id INTEGER PRIMARY KEY,
  coin_id INTEGER,
  date STRING,
  indicator_type ENUM('UPWARD_MOMENTUM', 'HIGH_SPEED', 'EXIT_SIGNAL', 'UPWARD_TREND', 'HESITATION'),
  indicator_symbol VARCHAR(5), -- '$', '※', '‼', '↑', 'w'
  confidence_score FLOAT,      -- 置信度评分
  created_at TIMESTAMP
);
```

## 🤖 识别逻辑

### OpenAI Prompt增强
```
动能标识符号识别规则：
1. $（向上动能）：综合分析各项指标，判断是否有较大向上动能
2. ※（高速油门期）：爆破指数 > 200
3. ‼（短期撤出信号）：爆破指数从200以上跌至200以下
4. ↑（上升通道）：爆破指数连续2-3天持续上涨
5. w（巨头犹豫）：退场期但有特殊情况

请在coins数组的每个币种中添加：
"momentumIndicators": ["$", "※"] // 符合条件的符号数组
```

### 后端计算逻辑
```javascript
// 根据历史数据计算动能标识
function calculateMomentumIndicators(coinData, historicalData) {
  const indicators = [];
  
  // ※ 逻辑：爆破指数 > 200
  if (coinData.explosionIndex > 200) {
    indicators.push('※');
  }
  
  // ‼ 逻辑：从200+跌至200-
  if (historicalData.wasAbove200 && coinData.explosionIndex < 200) {
    indicators.push('‼');
  }
  
  // ↑ 逻辑：连续上涨
  if (isConsecutivelyRising(historicalData.explosionIndexHistory, 2)) {
    indicators.push('↑');
  }
  
  // $ 逻辑：综合判断向上动能
  if (hasUpwardMomentum(coinData, historicalData)) {
    indicators.push('$');
  }
  
  // w 逻辑：退场期的犹豫
  if (coinData.entryExitType === 'exit' && hasHesitationSignals(coinData)) {
    indicators.push('w');
  }
  
  return indicators;
}
```

## 🎨 前端显示方案

### CoinCard组件增强
```jsx
const renderMomentumIndicators = (indicators = []) => {
  if (!indicators.length) return null;
  
  const indicatorConfig = {
    '$': { color: '#52c41a', tooltip: '向上动能强劲，重点关注' },
    '※': { color: '#ff4d4f', tooltip: '高速油门期，爆破指数>200' },
    '‼': { color: '#faad14', tooltip: '短期撤出信号，爆破跌破200' },
    '↑': { color: '#1890ff', tooltip: '连续上涨，进入上升通道' },
    'w': { color: '#722ed1', tooltip: '巨头犹豫，退场期特殊情况' }
  };
  
  return (
    <div className="flex items-center mt-1">
      {indicators.map(symbol => (
        <Tooltip key={symbol} title={indicatorConfig[symbol].tooltip}>
          <span 
            className="inline-block px-1 text-sm font-bold rounded"
            style={{ color: indicatorConfig[symbol].color }}
          >
            {symbol}
          </span>
        </Tooltip>
      ))}
    </div>
  );
};
```

### 场外指数表增强
在OtcIndexTable组件中添加动能标识列：
```jsx
{
  title: '动能',
  dataIndex: 'momentumIndicators',
  key: 'momentum',
  render: (indicators) => renderMomentumIndicators(indicators),
  width: 80
}
```

## 📱 Telegram Bot监控

### 新增监控规则
```javascript
// 在scheduler.js中添加动能标识监控
async function checkMomentumIndicators() {
  const users = await getAllSubscribedUsers();
  
  for (const chatId of users) {
    const data = await getUserLatestData(chatId);
    
    // 检查高优先级动能标识
    const highPriorityCoins = data.metrics.filter(coin => 
      coin.momentumIndicators?.includes('‼') || // 撤出信号
      coin.momentumIndicators?.includes('※')    // 高速油门
    );
    
    for (const coin of highPriorityCoins) {
      await sendMomentumAlert(chatId, coin);
    }
  }
}

// 动能标识推送消息
async function sendMomentumAlert(chatId, coinData) {
  const indicators = coinData.momentumIndicators || [];
  const indicatorTexts = {
    '$': '🚀 向上动能强劲',
    '※': '💨 高速油门期',
    '‼': '⚠️ 短期撤出信号', 
    '↑': '📈 上升通道确认',
    'w': '🤔 巨头犹豫信号'
  };
  
  const alertTexts = indicators.map(symbol => indicatorTexts[symbol]).join('\n');
  
  const message = `
🎯 *动能标识提醒*

**${coinData.coin.name} (${coinData.coin.symbol})**
${alertTexts}

💥 爆破指数：${coinData.explosion_index}
📊 场外指数：${coinData.otc_index}
📈 当前状态：${getTypeDisplay(coinData.entry_exit_type)}${coinData.entry_exit_day ? `第${coinData.entry_exit_day}天` : ''}
  `;
  
  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}
```

## 🔄 实现优先级

### Phase 1: 基础实现
1. 数据库添加momentum_indicators字段
2. OpenAI prompt增加动能标识识别
3. CoinCard显示基础符号

### Phase 2: 增强显示
1. 场外指数表添加动能列
2. 符号颜色和Tooltip优化
3. 筛选功能增强

### Phase 3: 智能监控
1. Telegram Bot动能标识推送
2. 历史数据分析优化
3. 自定义动能标识规则

## 💡 建议的实现顺序

1. **先添加数据库字段** - 简单的text字段存储符号
2. **更新OpenAI prompt** - 让AI识别并输出动能标识
3. **前端显示实现** - CoinCard和表格显示符号
4. **Bot监控集成** - 特殊符号推送通知

这个方案既保持了系统的简洁性，又能满足动能标识的所有需求。你觉得这个设计如何？需要我先实现哪个部分？
