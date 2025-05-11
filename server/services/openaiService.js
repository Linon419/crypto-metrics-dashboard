// server/services/openaiService.js - 修复日期解析问题
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
    
    // 预处理日期 - 在发送到AI前先修复常见格式问题
    const processedText = preprocessDateFormat(rawText);
    
    // 构建提示
    const prompt = `
你是一个加密货币数据处理专家。请将以下非结构化数据转换为规范的JSON格式。

数据示例:
\`\`\`
${processedText}
\`\`\`

关于日期格式的特别说明（举例）：
1. 如果原始数据的第一行包含形如"5.9"的日期，应解析为"2025-05-09"（不是10月5日）
2. 输出的date字段必须格式应为YYYY-MM-DD（年份默认当前年份）
3. 月份和日期必须是两位数格式，如05而非5
5. 始终使用美式日期顺序解析：月.日

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
      
      // 处理日期 - 确保正确解析并格式化
      const currentYear = new Date().getFullYear();
      if (!parsedData.date) {
        const today = new Date();
        parsedData.date = today.toISOString().split('T')[0];
        console.log('添加默认日期:', parsedData.date);
      } else {
        // 二次检查日期格式，确保正确解析
        parsedData.date = validateAndFixDate(parsedData.date, rawText, currentYear);
        console.log('最终日期:', parsedData.date);
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

/**
 * 预处理原始文本中的日期格式，确保AI能正确理解
 * @param {string} rawText - 原始文本
 * @returns {string} - 预处理后的文本
 */
function preprocessDateFormat(rawText) {
  if (!rawText) return rawText;
  
  // 查找类似"5.9"格式的日期（通常在第一行）
  const lines = rawText.split('\n');
  if (lines.length > 0) {
    // 尝试匹配第一行中的日期格式 x.y
    const dateMatch = lines[0].match(/^\s*(\d{1,2})\.(\d{1,2})\s*$/);
    if (dateMatch) {
      const month = parseInt(dateMatch[1], 10);
      const day = parseInt(dateMatch[2], 10);
      
      // 添加显式标记，帮助AI正确理解
      const currentYear = new Date().getFullYear();
      const formattedDate = `${month}.${day} (月.日，即 ${currentYear}年${month}月${day}日)`;
      lines[0] = formattedDate;
      
      console.log(`预处理日期: 原始"${dateMatch[0]}" -> 处理后"${formattedDate}"`);
      return lines.join('\n');
    }
  }
  
  return rawText;
}

/**
 * 验证并修复日期格式，确保正确解析日期
 * @param {string} date - 原始日期字符串
 * @param {string} rawText - 原始输入文本
 * @param {number} currentYear - 当前年份
 * @returns {string} - 修复后的日期字符串 (YYYY-MM-DD)
 */
function validateAndFixDate(date, rawText, currentYear) {
  // 如果已经是正确的YYYY-MM-DD格式，验证月份和日期的值是否合理
  if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [yearStr, monthStr, dayStr] = date.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const day = parseInt(dayStr, 10);
    
    // 提取原始输入中的日期信息，用于比较验证
    const originalDateMatch = rawText.split('\n')[0].match(/(\d{1,2})\.(\d{1,2})/);
    
    // 如果原始输入包含日期，且解析后的月/日与原始不符，则可能需要修复
    if (originalDateMatch) {
      const originalMonth = parseInt(originalDateMatch[1], 10);
      const originalDay = parseInt(originalDateMatch[2], 10);
      
      // 检查是否存在月/日颠倒的情况
      if (month !== originalMonth || day !== originalDay) {
        console.log(`日期解析可能有误: AI返回 ${month}-${day}, 原始输入为 ${originalMonth}.${originalDay}`);
        
        // 使用原始输入中解析的值构造正确日期
        const fixedMonth = originalMonth.toString().padStart(2, '0');
        const fixedDay = originalDay.toString().padStart(2, '0');
        
        return `${currentYear}-${fixedMonth}-${fixedDay}`;
      }
    }
    
    // 确保年份使用当前年份
    if (year !== currentYear) {
      return `${currentYear}-${monthStr}-${dayStr}`;
    }
    
    return date;
  }
  
  // 如果不是YYYY-MM-DD格式，尝试从原始文本解析
  const dateMatch = rawText.split('\n')[0].match(/(\d{1,2})\.(\d{1,2})/);
  if (dateMatch) {
    const month = parseInt(dateMatch[1], 10);
    const day = parseInt(dateMatch[2], 10);
    
    // 验证月份和日期在有效范围内
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${currentYear}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    }
  }
  
  // 如果无法从原始文本解析，使用当前日期
  const today = new Date();
  return today.toISOString().split('T')[0];
}

module.exports = { processRawData };