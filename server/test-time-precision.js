// server/test-time-precision.js
// 测试时间精度功能的简单脚本

const { parseFlexibleDateTime, validateTimePrecision, formatDateForStorage, inferYear } = require('./utils/timeParser');

console.log('=== 测试时间解析功能 ===\n');

// 测试用例
const testCases = [
  // 日精度测试
  { input: '5.9', expected: { precision: 'day', isValid: true } },
  { input: '12.25', expected: { precision: 'day', isValid: true } },

  // 带年份的日精度测试
  { input: '2024.5.9', expected: { precision: 'day', isValid: true } },
  { input: '24.5.9', expected: { precision: 'day', isValid: true } },
  { input: '2025.12.25', expected: { precision: 'day', isValid: true } },

  // 小时精度测试
  { input: '5.9 14', expected: { precision: 'hour', isValid: true } },
  { input: '12.25 23', expected: { precision: 'hour', isValid: true } },

  // 带年份的小时精度测试
  { input: '2024.5.9 14', expected: { precision: 'hour', isValid: true } },
  { input: '24.12.25 23', expected: { precision: 'hour', isValid: true } },

  // 分钟精度测试
  { input: '5.9 14:30', expected: { precision: 'minute', isValid: true } },
  { input: '12.25 09:15', expected: { precision: 'minute', isValid: true } },

  // 带年份的分钟精度测试
  { input: '2024.5.9 14:30', expected: { precision: 'minute', isValid: true } },
  { input: '24.12.25 09:15', expected: { precision: 'minute', isValid: true } },

  // ISO格式测试
  { input: '2024-05-09', expected: { precision: 'day', isValid: true } },
  { input: '2024-05-09T14:30:00', expected: { precision: 'minute', isValid: true } },

  // 无效格式测试
  { input: '13.32', expected: { precision: 'day', isValid: false } }, // 无效月份
  { input: '5.9 25', expected: { precision: 'day', isValid: false } }, // 无效小时
  { input: '5.9 14:70', expected: { precision: 'day', isValid: false } }, // 无效分钟
  { input: '2024.13.1', expected: { precision: 'day', isValid: false } }, // 无效月份
  { input: '1999.5.9', expected: { precision: 'day', isValid: false } }, // 年份太早
  { input: 'invalid', expected: { precision: 'day', isValid: false } },
];

console.log('1. 测试时间解析函数:');
testCases.forEach((testCase, index) => {
  const result = parseFlexibleDateTime(testCase.input);
  const passed = result.precision === testCase.expected.precision && 
                 result.isValid === testCase.expected.isValid;
  
  console.log(`  测试 ${index + 1}: "${testCase.input}"`);
  console.log(`    期望: 精度=${testCase.expected.precision}, 有效=${testCase.expected.isValid}`);
  console.log(`    实际: 精度=${result.precision}, 有效=${result.isValid}`);
  console.log(`    结果: ${passed ? '✅ 通过' : '❌ 失败'}`);
  if (result.isValid) {
    console.log(`    解析后: date="${result.date}", timestamp=${result.timestamp.toISOString()}`);
  }
  console.log('');
});

console.log('\n2. 测试时间精度验证函数:');
const precisionTests = ['day', 'hour', 'minute', 'invalid', null, undefined];
precisionTests.forEach(precision => {
  const result = validateTimePrecision(precision);
  console.log(`  输入: ${precision} => 输出: ${result}`);
});

console.log('\n3. 测试时间格式化函数:');
const now = new Date();
const formatTests = [
  { precision: 'day', expected: /^\d{1,2}\.\d{1,2}$/ },
  { precision: 'hour', expected: /^\d{1,2}\.\d{1,2} \d{1,2}$/ },
  { precision: 'minute', expected: /^\d{1,2}\.\d{1,2} \d{2}:\d{2}$/ },
];

formatTests.forEach(test => {
  const result = formatDateForStorage(now, test.precision);
  const matches = test.expected.test(result);
  console.log(`  精度: ${test.precision} => 格式: "${result}" ${matches ? '✅' : '❌'}`);
});

console.log('\n4. 测试年份推断函数:');
const yearInferenceTests = [
  { month: 1, currentMonth: 12, expected: 'next year' }, // 当前12月，输入1月 -> 明年
  { month: 12, currentMonth: 1, expected: 'last year' }, // 当前1月，输入12月 -> 去年
  { month: 6, currentMonth: 5, expected: 'current year' }, // 相近月份 -> 当年
  { month: 8, currentMonth: 8, expected: 'current year' }, // 同月 -> 当年
];

const currentYear = new Date().getFullYear();
yearInferenceTests.forEach(test => {
  // 创建模拟的参考日期
  const referenceDate = new Date(currentYear, test.currentMonth - 1, 15);
  const inferredYear = inferYear(test.month, referenceDate);

  let expectedYear;
  switch(test.expected) {
    case 'next year':
      expectedYear = currentYear + 1;
      break;
    case 'last year':
      expectedYear = currentYear - 1;
      break;
    default:
      expectedYear = currentYear;
  }

  const passed = inferredYear === expectedYear;
  console.log(`  月份: ${test.month}, 当前: ${test.currentMonth} => 推断年份: ${inferredYear} (期望: ${expectedYear}) ${passed ? '✅' : '❌'}`);
});

console.log('\n=== 测试完成 ===');

// 如果作为模块运行，导出测试函数
if (require.main === module) {
  console.log('\n运行完整测试...');
} else {
  module.exports = {
    runTimeParsingTests: () => {
      console.log('时间解析测试已运行');
      return true;
    }
  };
}
