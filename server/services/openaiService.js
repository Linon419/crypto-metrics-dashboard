// server/services/openaiService.js
const { OpenAI } = require('openai');
require('dotenv').config();

// 初始化OpenAI客户端
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, 
  baseURL: 'https://burn.hair/v1' // 第三方转发URL
});

/**
 * 处理原始加密货币指标数据
 * @param {string} rawText - 原始文本数据
 * @returns {Promise<Object>} - 处理后的结构化JSON数据
 */
async function processRawData(rawText) {
  try {
    console.log('============ 原始输入数据 ============');
    console.log(rawText);
    
    // 构建提示
    const prompt = `
你是一个加密货币数据处理专家。请将以下非结构化数据转换为规范的JSON格式。

数据示例:
\`\`\`
${rawText}
\`\`\`

关于日期格式的特别说明：
1. 如果原始数据的第一行包含形如"5.9"的日期，表示5月9日
2. 此时输出的date字段必须格式为"2025-05-09"（年份使用当前年份）
3. 月份和日期必须是两位数格式，如05而非5
4. 切勿将"5.9"解析为10月30日或其他错误格式

仅返回有效的JSON格式，不要包含其他文本或解释。

请按照以下格式输出JSON:
{
  "date": "YYYY-MM-DD", // 从原始数据中提取或使用当前日期
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
    "comments": "..." // 提取流动性概况中的文字描述
  },
  "trendingCoins": [
    {
      "symbol": "TRUMP", // 热点币种
      "otcIndex": 1339,
      "explosionIndex": 81,
      "entryExitType": "entry",
      "entryExitDay": 14,
      "schellingPoint": 11.2
    }
  ],
  "dailyReminder": "..." // 每日提醒部分的文字
}

日期格式应为YYYY-MM-DD，如果原始数据包含日期信息（如"5.7"表示5月7日），请使用当前年份和该日期。如果没有包含日期信息，请使用当前日期。

对于币种识别：
1. 标准币种符号应大写(BTC, ETH等)
2. 非标准命名应尽量规范为通用符号

对于进退场期识别：
1. "进场期"对应entryExitType="entry"
2. "退场期"对应entryExitType="exit"
3. 如果没有明确指出进退场，则默认为"neutral"

仅返回有效的JSON格式，不要包含其他文本或解释。
`;

    console.log('============ API请求开始 ============');
    // 调用OpenAI API
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "你是一个数据清洗专家，请将加密货币指标数据转换为结构化JSON格式。"
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" }
    });
    
    console.log('============ API响应 ============');
    console.log(JSON.stringify(response.choices[0].message, null, 2));
    
    const responseContent = response.choices[0].message.content;
    console.log('============ 响应内容 ============');
    console.log(responseContent);
    
    // 解析JSON响应
    try {
      const parsedData = JSON.parse(responseContent);
      
      console.log('============ 解析后的数据结构 ============');
      console.log(JSON.stringify(parsedData, null, 2));
      
      // 验证关键字段
      console.log('============ 数据验证 ============');
      console.log('日期存在:', !!parsedData.date);
      console.log('原始日期:', parsedData.date);
      
      // 处理日期
      const currentYear = new Date().getFullYear();
      if (!parsedData.date) {
        const today = new Date();
        parsedData.date = today.toISOString().split('T')[0];
        console.log('添加默认日期:', parsedData.date);
      } else if (parsedData.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
        // 确保使用当前年份
        const newDate = `${currentYear}-${parsedData.date.substring(5)}`;
        console.log('更新年份:', parsedData.date, '->', newDate);
        parsedData.date = newDate;
      }
      
      // 验证币种数据
      console.log('币种数组存在:', !!parsedData.coins);
      console.log('币种数量:', parsedData.coins ? parsedData.coins.length : 0);
      
      if (parsedData.coins && parsedData.coins.length > 0) {
        console.log('第一个币种示例:');
        console.log(JSON.stringify(parsedData.coins[0], null, 2));
        
        // 验证每个币种的字段
        for (let i = 0; i < parsedData.coins.length; i++) {
          const coin = parsedData.coins[i];
          console.log(`验证币种 ${i+1} (${coin.symbol}):`);
          console.log('- symbol:', typeof coin.symbol, coin.symbol);
          console.log('- otcIndex:', typeof coin.otcIndex, coin.otcIndex);
          console.log('- explosionIndex:', typeof coin.explosionIndex, coin.explosionIndex);
          console.log('- entryExitType:', typeof coin.entryExitType, coin.entryExitType);
          console.log('- entryExitDay:', typeof coin.entryExitDay, coin.entryExitDay);
          console.log('- schellingPoint:', typeof coin.schellingPoint, coin.schellingPoint);
        }
      }
      
      return parsedData;
    } catch (parseError) {
      console.error('解析JSON响应失败:', parseError);
      console.error('原始响应内容:', responseContent);
      throw new Error('Failed to parse the processed data');
    }
  } catch (error) {
    console.error('OpenAI API调用错误:', error);
    console.error('错误详情:', error.stack);
    throw new Error(`Failed to process data: ${error.message}`);
  }
}

module.exports = { processRawData };