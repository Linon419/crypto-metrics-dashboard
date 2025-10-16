// server/services/openaiService.js - 修复日期解析问题
const { OpenAI } = require('openai');
require('dotenv').config();

// 延迟初始化OpenAI客户端
let openai = null;

function getOpenAIClient() {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'; // 默认使用官方API

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set. Please check your .env file.');
    }

    openai = new OpenAI({
      apiKey: apiKey,
      baseURL: baseURL
    });
  }
  return openai;
}

/**
 * 获取默认的AI提示模板
 * @param {string} processedText - 预处理后的文本
 * @returns {string} - 完整的提示文本
 */
function getDefaultPrompt(processedText) {
  return `
你是一个加密货币数据处理专家。请将以下非结构化数据转换为规范的JSON格式。

数据示例:
\`\`\`
${processedText}
\`\`\`

关于时间格式的特别说明：
1. 输入支持多种时间精度格式：
   - 日精度：如"5.9"表示5月9日，或"2024.5.9"表示2024年5月9日
   - 小时精度：如"5.9 14"表示5月9日14时，或"2024.5.9 14"表示2024年5月9日14时
   - 分钟精度：如"5.9 14:30"表示5月9日14时30分，或"2024.5.9 14:30"表示2024年5月9日14时30分
2. 年份处理：
   - 可以省略年份，系统会智能推断年份
   - 支持完整年份：2024.5.9
   - 支持简化年份：24.5.9（表示2024年）
3. **重要：输出格式要求**
   - 请将解析后的时间转换为标准ISO格式输出
   - 日精度：输出为 "YYYY-MM-DD" 格式
   - 小时精度：输出为 "YYYY-MM-DD HH:00" 格式
   - 分钟精度：输出为 "YYYY-MM-DD HH:MM" 格式
4. 始终使用美式日期顺序解析：年.月.日 或 月.日

仅返回有效的JSON格式，不要包含其他文本或解释。

动能标识符号识别规则

$: 该币种此时有较大的向上动能，可以重点关注（以前使用*，现已改为$）
※: 爆破指数高于200，处于高速油门期
‼: 爆破指数从200以上跌至200以下，短期可撤出落袋为安的信号
↑: 爆破指数连续2-3天持续上涨，最灵敏的走出阴跌行情进入上升通道指标
w: 在退场天数后标注，表示场外巨头准备撤场但可能有犹豫的特殊情况

**重要**：请仔细识别原始数据中这些特殊符号，但需要区分币种名称和动能指标：

动能指标识别规则：
- ✅ **应该识别**：出现在数值后面的符号，如"爆破指数490$"、"场外指数1200※"
- ✅ **应该识别**：单独出现在币种数据行中的符号，如"BTC ↑ 场外指数1500"  
- ❌ **不要识别**：币种名称前缀的符号，如"$Trump"、"$DOGE"中的$是币种名称一部分
- ❌ **不要识别**：作为币种符号开头的符号，这些通常是代币的标准命名

识别顺序：
1. 先确定币种名称（包括其前缀符号）
2. 再查找该币种数据中数值后面或独立出现的动能符号
3. 确保动能符号不是币种名称的组成部分

请按照以下格式输出JSON:
{
  "date": "YYYY-MM-DD HH:MM", // 标准ISO格式，根据精度调整（日精度省略时间部分）
  "coins": [
    {
      "symbol": "BTC",
      "otcIndex": 1756,
      "entryExitType": "entry", // "entry"表示进场，"exit"表示退场
      "entryExitDay": 25,
      "explosionIndex": 196,
      "schellingPoint": 96900,
      "nearThreshold": false, // 如果原文包含"逼近"则为true
      "momentumIndicators": ["$", "※"] // 根据上述动能标识规则识别的符号数组，如果没有符合条件的可以为空数组[]
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
7. $Trump == TRUMP (币种名称，$是名称的一部分，不是动能指标)
8. 黄金OTC == GOLD
9. 地产 水泥  == ESTATE
10. 布伦特原油 == OIL

**注意**：某些币种名称本身包含特殊符号（如$Trump），这些符号是币种标识的一部分，不应被识别为动能指标。

对于进退场期识别：
1. "进场期"对应entryExitType="entry"
2. "退场期"对应entryExitType="exit"
3. 如果没有明确指出进退场，则默认为"neutral"

时间精度示例：
- 日精度输入："5.9" → 输出date: "2025-05-09"
- 日精度带年份："2024.5.9" → 输出date: "2024-05-09"
- 小时精度输入："5.9 14" → 输出date: "2025-05-09 14:00"
- 小时精度带年份："2024.5.9 14" → 输出date: "2024-05-09 14:00"
- 分钟精度输入："5.9 14:30" → 输出date: "2025-05-09 14:30"
- 分钟精度带年份："2024.5.9 14:30" → 输出date: "2024-05-09 14:30"

仅返回有效的JSON格式，不要包含其他文本或解释。
`;
}

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
    
    // 构建提示 - 从环境变量获取或使用默认值
    const customPrompt = process.env.OPENAI_PROMPT;
    const prompt = customPrompt ? customPrompt.replace('{{processedText}}', processedText) : getDefaultPrompt(processedText);

    console.log('============ API请求开始 ============');
    const apiStartTime = Date.now();

    // 调用OpenAI API
    const openaiClient = getOpenAIClient();
    const model = process.env.OPENAI_MODEL || "gpt-4o"; // 默认使用gpt-4o
    const systemPrompt = process.env.OPENAI_SYSTEM_PROMPT || "你是一个数据清洗专家，请将加密货币指标数据转换为结构化JSON格式。";

    console.log('使用的模型:', model);
    console.log('数据大小:', rawText.length, '字符');

    // 设置OpenAI API调用超时（4分钟）
    const timeoutMs = 240000; // 4分钟超时
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`OpenAI API 调用超时（${timeoutMs/1000}秒）`)), timeoutMs);
    });

    const apiPromise = openaiClient.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" }
      // 注意: timeout 参数已移除,因为OpenAI API不接受此参数
      // 我们使用 Promise.race 来实现超时控制
    });

    const response = await Promise.race([apiPromise, timeoutPromise]);

    const apiEndTime = Date.now();
    const apiDuration = ((apiEndTime - apiStartTime) / 1000).toFixed(2);

    console.log('============ API响应 ============');
    console.log(`⏱️ OpenAI API 调用耗时: ${apiDuration} 秒`);
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