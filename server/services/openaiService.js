// server/services/openaiService.js - 修复日期解析问题
const { OpenAI } = require('openai');
require('dotenv').config();

// 延迟初始化OpenAI客户端
let openai = null;

const MOMENTUM_INDICATORS = ['$', '*', '※', '‼', '↑', 'w'];

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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeMomentumIndicators(value) {
  if (Array.isArray(value)) {
    return value
      .map(indicator => String(indicator).trim())
      .filter(indicator => MOMENTUM_INDICATORS.includes(indicator));
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    if (!trimmedValue) return [];

    try {
      return normalizeMomentumIndicators(JSON.parse(trimmedValue));
    } catch (error) {
      return MOMENTUM_INDICATORS.includes(trimmedValue) ? [trimmedValue] : [];
    }
  }

  return [];
}

function lineContainsCoinAnchor(line, coin) {
  const upperLine = line.toUpperCase();
  const symbol = coin.symbol ? String(coin.symbol).toUpperCase() : '';
  const name = coin.name ? String(coin.name).toUpperCase() : '';

  if (symbol && upperLine.includes(symbol)) return true;
  if (name && upperLine.includes(name)) return true;

  return false;
}

function lineContainsMetricAnchor(line, coin) {
  const hasOtcIndex = Number.isFinite(coin.otcIndex) && line.includes(String(coin.otcIndex));
  const hasExplosionIndex = Number.isFinite(coin.explosionIndex) && line.includes(String(coin.explosionIndex));

  return hasOtcIndex || hasExplosionIndex;
}

function getCoinEvidenceBlock(rawText, coin) {
  if (!rawText || !coin) return '';

  const lines = rawText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const startIndex = lines.findIndex(line => (
    line.includes('场外指数') &&
    (lineContainsCoinAnchor(line, coin) || lineContainsMetricAnchor(line, coin))
  ));

  if (startIndex === -1) {
    return '';
  }

  const blockLines = [lines[startIndex]];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (lines[index].includes('场外指数')) break;
    blockLines.push(lines[index]);
  }

  return blockLines.join('\n');
}

function hasIndicatorSource(indicator, evidenceBlock) {
  if (!indicator || !evidenceBlock) return false;

  const escapedIndicator = escapeRegExp(indicator);
  const numericPrefixPattern = new RegExp(`[-+]?\\d+(?:\\.\\d+)?\\s*${escapedIndicator}(?=$|[\\s,，。;；])`);
  if (numericPrefixPattern.test(evidenceBlock)) {
    return true;
  }

  const standalonePattern = new RegExp(`(^|[\\s,，。;；])${escapedIndicator}(?=$|[\\s,，。;；])`);
  return standalonePattern.test(evidenceBlock);
}

function filterMomentumIndicatorsByRawText(parsedData, rawText) {
  if (!parsedData || !Array.isArray(parsedData.coins)) {
    return parsedData;
  }

  parsedData.coins = parsedData.coins.map(coin => {
    const evidenceBlock = getCoinEvidenceBlock(rawText, coin);
    const sourcedIndicators = normalizeMomentumIndicators(coin.momentumIndicators)
      .filter(indicator => hasIndicatorSource(indicator, evidenceBlock));

    return {
      ...coin,
      momentumIndicators: sourcedIndicators,
    };
  });

  return parsedData;
}

/**
 * 获取默认的AI提示模板
 * @param {string} processedText - 预处理后的文本
 * @returns {string} - 完整的提示文本
 */
function getDefaultPrompt(processedText) {
  return `你是一个加密货币和美股数据解析专家。你的任务是将非结构化的加密货币/美股数据转换为规范的JSON格式。

**当前日期**: ${new Date().toISOString().split('T')[0]} (YYYY-MM-DD)

## 输入数据
\`\`\`
${processedText}
\`\`\`

## 核心解析规则

### 1. 时间格式解析与输出

#### 输入格式支持
- **日精度**：\`5.9\` 或 \`2024.5.9\`
- **小时精度**：\`5.9 14\` 或 \`2024.5.9 14\`
- **分钟精度**：\`5.9 14:30\` 或 \`2024.5.9 14:30\`

#### 年份处理逻辑
- **省略年份时**：使用当前年份（从上方"当前日期"获取）
- **完整年份**：\`2024.5.9\` → 按指定年份解析
- **简化年份**：\`24.5.9\` → 解析为 \`2024.5.9\`（前两位补20）

#### 输出格式要求（ISO标准）
- 日精度 → \`YYYY-MM-DD\`
- 小时精度 → \`YYYY-MM-DD HH:00\`
- 分钟精度 → \`YYYY-MM-DD HH:MM\`

#### 日期顺序
始终使用美式顺序：**年.月.日** 或 **月.日**

---

### 2. 动能指标识别规则

#### 指标符号定义
| 符号 | 含义 |
|------|------|
| \`$\` | 较大向上动能，重点关注 |
| \`*\` | 爆破指数>200，高速油门期 |
| \`※\` | 爆破指数>200，高速油门期 |
| \`‼\` | 爆破指数从>200跌至<200，短期撤出信号 |
| \`↑\` | 爆破指数连续2-3天上涨，进入上升通道 |
| \`w\` | 场外巨头撤场犹豫信号 |

#### 识别决策树

**✅ 应识别为动能指标**：
- 数值后紧跟的符号：\`爆破指数490$\`、\`场外指数1200※\`
- 数值后用空格分隔的星号：\`爆破指数249 *\`
- 独立出现在数据行中：\`BTC ↑ 场外指数1500\`
- momentumIndicators 只收录输入原文逐字出现的符号
- 爆破指数数值只用于 explosionIndex 字段；原文没有符号时 momentumIndicators 返回 []

#### 币种名称符号处理
- 币种名称前缀：\`$Trump\`、\`$DOGE\` 中的 \`$\` 是名称组成部分
- 标准命名里的符号归入 symbol 解析

#### 识别流程（按顺序执行）
1. **先识别币种名称**（包括其前缀符号）
2. **再查找动能符号**（数值后或独立出现的符号）
3. **验证来源**（确保符号来自同一币种的原始文本）

---

### 3. 币种符号标准化

| 原始名称 | 标准符号 |
|----------|----------|
| 标准币种 | 大写（BTC, ETH, SOL） |
| 美股纳指OTC | NASDAQ |
| 币市流动性 | LIQUIDITY |
| 期权波动率/比特币Vega交易 | VEGA |
| Trump / $Trump | TRUMP |
| 黄金OTC | GOLD |
| 地产/水泥 | ESTATE |
| 布伦特原油 | OIL |
| 美股个股 | 保持原样大写（HOOD, COIN, CIRCLE, TSLA, NVDA, AAPL, GOOG等） |
| 国内人工智能ETF | CN_AI_ETF |
| 国内机器人ETF | CN_ROBOT |
| A股指数 | CN_INDEX |

---

### 4. 进退场类型识别

| 原文描述 | entryExitType值 |
|----------|-----------------|
| 进场期 | "entry" |
| 退场期 | "exit" |
| 未明确说明 | "neutral" |

---

## 输出格式（JSON Schema）

{
  "date": "YYYY-MM-DD HH:MM",
  "coins": [
    {
      "symbol": "BTC",
      "otcIndex": 1756,
      "entryExitType": "entry",
      "entryExitDay": 25,
      "explosionIndex": 196,
      "schellingPoint": 96900,
      "nearThreshold": false,
      "momentumIndicators": ["$", "*", "※"]
    }
  ],
  "liquidity": {
    "btcFundChange": 0.2,
    "ethFundChange": -1.7,
    "solFundChange": 0.8,
    "totalMarketFundChange": 0.5,
    "comments": "..."
  },
  "dailyReminder": "..."
}

**字段说明**：
- date: 根据输入精度调整格式
- symbol: 标准化大写符号
- otcIndex: 场外指数（数值）
- entryExitType: "entry" | "exit" | "neutral"
- entryExitDay: 进/退场天数（数值）
- explosionIndex: 爆破指数（数值）
- schellingPoint: 谢林点位（数值）
- nearThreshold: 是否逼近阈值（布尔值）
- momentumIndicators: 动能指标数组，无则为[]
- liquidity.btcFundChange: 单位亿美元
- liquidity.comments: 原文描述，保持完整不遗漏
- dailyReminder: 每日提醒原文

---

## 输出要求

1. **仅返回有效JSON**，无其他文本或解释
2. **保证JSON可解析**，注意逗号、引号、括号匹配
3. **数值类型正确**：数字用number，文本用string，布尔值用boolean
4. **数组处理**：momentumIndicators即使为空也返回[]而非null

---

## 时间格式输出示例（假设当前年份为2025）

| 输入 | 输出 |
|------|------|
| \`5.9\` | \`"2025-05-09"\` |
| \`2024.5.9\` | \`"2024-05-09"\` |
| \`5.9 14\` | \`"2025-05-09 14:00"\` |
| \`2024.5.9 14\` | \`"2024-05-09 14:00"\` |
| \`5.9 14:30\` | \`"2025-05-09 14:30"\` |
| \`2024.5.9 14:30\` | \`"2024-05-09 14:30"\` |
| \`24.5.9\` | \`"2024-05-09"\` |

开始解析数据。`;
}
/**
 * 处理原始加密货币指标数据
 * @param {string} rawText - 原始文本数据
 * @param {string} [customModel] - 可选的自定义AI模型名称
 * @returns {Promise<Object>} - 处理后的结构化JSON数据
 */
async function processRawData(rawText, customModel = null) {
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
    // 优先使用传入的模型，其次使用环境变量，最后使用默认值
    const model = customModel || process.env.OPENAI_MODEL || "gpt-4o";
    const systemPrompt = process.env.OPENAI_SYSTEM_PROMPT || "你是一个数据清洗专家，请将加密货币指标数据转换为结构化JSON格式。";

    console.log('使用的模型:', model);
    if (customModel) {
      console.log('模型来源: 用户选择');
    } else if (process.env.OPENAI_MODEL) {
      console.log('模型来源: 环境变量');
    } else {
      console.log('模型来源: 默认配置');
    }
    console.log('数据大小:', rawText.length, '字符');

    // 设置OpenAI API调用超时（6分钟）
    const timeoutMs = 360000; // 6分钟超时
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
      
      filterMomentumIndicatorsByRawText(parsedData, rawText);

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

module.exports = {
  processRawData,
  __testUtils: {
    filterMomentumIndicatorsByRawText,
    getCoinEvidenceBlock,
    hasIndicatorSource,
    normalizeMomentumIndicators,
  },
};
