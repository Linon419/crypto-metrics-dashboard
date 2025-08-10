// server/test-iso-format.js
// 测试ISO格式转换功能

const { parseFlexibleDateTime, formatToISO } = require('./utils/timeParser');

function testISOFormatConversion() {
  console.log('=== 测试ISO格式转换功能 ===\n');

  // 测试用例
  const testCases = [
    // 日精度测试
    { input: '5.9', expectedFormat: /^\d{4}-\d{2}-\d{2}$/, description: '日精度（省略年份）' },
    { input: '2024.5.9', expectedFormat: /^\d{4}-\d{2}-\d{2}$/, description: '日精度（完整年份）' },
    { input: '24.5.9', expectedFormat: /^\d{4}-\d{2}-\d{2}$/, description: '日精度（简化年份）' },
    
    // 小时精度测试
    { input: '5.9 14', expectedFormat: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, description: '小时精度（省略年份）' },
    { input: '2024.5.9 14', expectedFormat: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, description: '小时精度（完整年份）' },
    { input: '24.5.9 23', expectedFormat: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, description: '小时精度（简化年份）' },
    
    // 分钟精度测试
    { input: '5.9 14:30', expectedFormat: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, description: '分钟精度（省略年份）' },
    { input: '2024.5.9 14:30', expectedFormat: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, description: '分钟精度（完整年份）' },
    { input: '24.12.25 09:15', expectedFormat: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, description: '分钟精度（简化年份）' },
    
    // ISO格式输入测试
    { input: '2024-05-09', expectedFormat: /^\d{4}-\d{2}-\d{2}$/, description: 'ISO日期输入' },
    { input: '2024-05-09T14:30:00', expectedFormat: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, description: 'ISO时间戳输入' },
  ];

  console.log('1. 测试时间解析和ISO格式输出:');
  testCases.forEach((testCase, index) => {
    const result = parseFlexibleDateTime(testCase.input);
    const formatMatches = testCase.expectedFormat.test(result.date);
    
    console.log(`  测试 ${index + 1}: ${testCase.description}`);
    console.log(`    输入: "${testCase.input}"`);
    console.log(`    输出: "${result.date}"`);
    console.log(`    精度: ${result.precision}`);
    console.log(`    有效: ${result.isValid}`);
    console.log(`    格式正确: ${formatMatches ? '✅' : '❌'}`);
    
    if (result.isValid && formatMatches) {
      // 验证日期解析的准确性
      const parsedDate = new Date(result.timestamp);
      console.log(`    解析日期: ${parsedDate.getFullYear()}-${(parsedDate.getMonth() + 1).toString().padStart(2, '0')}-${parsedDate.getDate().toString().padStart(2, '0')}`);
    }
    console.log('');
  });

  console.log('\n2. 测试formatToISO函数:');
  const now = new Date(2024, 4, 9, 14, 30, 0); // 2024年5月9日14:30:00
  const formatTests = [
    { precision: 'day', expected: '2024-05-09' },
    { precision: 'hour', expected: '2024-05-09 14:00' },
    { precision: 'minute', expected: '2024-05-09 14:30' },
  ];

  formatTests.forEach(test => {
    const result = formatToISO(now, test.precision);
    const matches = result === test.expected;
    console.log(`  精度: ${test.precision}`);
    console.log(`    期望: "${test.expected}"`);
    console.log(`    实际: "${result}"`);
    console.log(`    结果: ${matches ? '✅ 通过' : '❌ 失败'}`);
    console.log('');
  });

  console.log('\n3. 测试特殊情况:');
  
  // 测试跨年情况
  const crossYearTests = [
    { input: '12.31', description: '年末日期' },
    { input: '1.1', description: '年初日期' },
    { input: '2023.12.31 23:59', description: '跨年时刻' },
  ];

  crossYearTests.forEach(test => {
    const result = parseFlexibleDateTime(test.input);
    console.log(`  ${test.description}:`);
    console.log(`    输入: "${test.input}"`);
    console.log(`    输出: "${result.date}"`);
    console.log(`    年份: ${result.timestamp.getFullYear()}`);
    console.log(`    有效: ${result.isValid ? '✅' : '❌'}`);
    console.log('');
  });

  console.log('=== ISO格式转换测试完成 ===');
}

// 如果直接运行此脚本
if (require.main === module) {
  testISOFormatConversion();
}

module.exports = { testISOFormatConversion };
