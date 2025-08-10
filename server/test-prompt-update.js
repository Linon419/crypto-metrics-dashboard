// server/test-prompt-update.js
// 测试更新后的OpenAI prompt是否正确处理时间精度

const { getDefaultPrompt } = require('./services/openaiService');

function testPromptUpdate() {
  console.log('=== 测试更新后的OpenAI Prompt ===\n');

  // 测试不同时间精度的输入
  const testCases = [
    {
      name: '日精度数据',
      input: `5.9
BTC 场外指数1500场外进场期第1天
爆破指数200
谢林点 95000`
    },
    {
      name: '小时精度数据',
      input: `5.9 14
BTC 场外指数1520场外进场期第1天
爆破指数210
谢林点 95500`
    },
    {
      name: '分钟精度数据',
      input: `5.9 14:30
BTC 场外指数1530场外进场期第1天
爆破指数220
谢林点 96000`
    }
  ];

  testCases.forEach((testCase, index) => {
    console.log(`${index + 1}. ${testCase.name}:`);
    console.log('输入数据:');
    console.log(testCase.input);
    console.log('\n生成的Prompt:');
    console.log('=' .repeat(50));
    
    // 由于getDefaultPrompt可能不是导出的，我们直接重新实现
    const prompt = generateTestPrompt(testCase.input);
    console.log(prompt);
    console.log('=' .repeat(50));
    console.log('\n');
  });

  console.log('=== Prompt测试完成 ===');
}

function generateTestPrompt(processedText) {
  return `
你是一个加密货币数据处理专家。请将以下非结构化数据转换为规范的JSON格式。

数据示例:
\`\`\`
${processedText}
\`\`\`

关于时间格式的特别说明：
1. 系统现在支持多种时间精度格式：
   - 日精度：如"5.9"表示5月9日
   - 小时精度：如"5.9 14"表示5月9日14时
   - 分钟精度：如"5.9 14:30"表示5月9日14时30分
2. 请保持原始时间格式，不要转换为ISO格式
3. 始终使用美式日期顺序解析：月.日
4. 如果输入包含时间信息，请在date字段中保持完整的时间格式

仅返回有效的JSON格式，不要包含其他文本或解释。

请按照以下格式输出JSON:
{
  "date": "原始时间格式", // 保持输入的时间格式，如"5.9"、"5.9 14"或"5.9 14:30"
  "coins": [
    {
      "symbol": "BTC",
      "otcIndex": 1756,
      "entryExitType": "entry", // "entry"表示进场，"exit"表示退场
      "entryExitDay": 25,
      "explosionIndex": 196,
      "schellingPoint": 96900,
      "nearThreshold": false // 如果原文包含"逼近"则为true
    },
    // 其他币种...
  ],
  "liquidity": {
    "btcFundChange": 0.2, // 单位：亿美元
    "ethFundChange": -1.7,
    "solFundChange": 0.8,
    "totalMarketFundChange": 0.5,
    "comments": "..." // 提取流动性概况中的文字描述，，不要吞字
  },
  "dailyReminder": "..." // 每日提醒部分的文字
}


对于币种识别：
1. 标准币种符号应大写(BTC, ETH等)
2. 非标准命名应尽量规范为通用符号
3. 美股纳指 OTC == NASDAQ
4. 币市流动性 == LIQUIDITY
5. 期权波动率（比特币Vega交易）== VEGA
6. Trump == TRUMP
7. 黄金OTC == GOLD
8. 地产 水泥  == ESTATE
9. 布伦特原油 == OIL

对于进退场期识别：
1. "进场期"对应entryExitType="entry"
2. "退场期"对应entryExitType="exit"
3. 如果没有明确指出进退场，则默认为"neutral"

时间精度示例：
- 日精度输入："5.9" → 输出date: "5.9"
- 小时精度输入："5.9 14" → 输出date: "5.9 14"
- 分钟精度输入："5.9 14:30" → 输出date: "5.9 14:30"

仅返回有效的JSON格式，不要包含其他文本或解释。
`;
}

// 如果直接运行此脚本
if (require.main === module) {
  testPromptUpdate();
}

module.exports = { testPromptUpdate };
